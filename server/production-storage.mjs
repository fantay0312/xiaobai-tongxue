import crypto from 'node:crypto';
import { passwordSchemeOf } from './credential-format.mjs';

const PRIMARY_STATE_KEY = 'primary';

function asIso(value) {
  if (typeof value === 'string') return new Date(value).toISOString();
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

function storedUser(row, contacts) {
  const result = {
    id: row.id,
    source: row.source,
    name: row.username,
    salt: row.passwordSalt,
    hash: row.passwordHash,
    passwordScheme: row.passwordScheme,
    createdAt: asIso(row.createdAt),
  };
  for (const contact of contacts) {
    if (contact.kind === 'email') {
      result.email = contact.value;
      result.emailVerifiedAt = asIso(contact.verifiedAt);
    } else if (contact.kind === 'phone') {
      result.phone = contact.value;
      result.phoneVerifiedAt = asIso(contact.verifiedAt);
    }
  }
  return result;
}

function credentialInput(user) {
  return {
    passwordHash: user.hash,
    passwordSalt: user.salt,
    passwordScheme: passwordSchemeOf(user),
  };
}

function postgresConflict(error) {
  return error?.code === '23505';
}

async function loadUsers(postgres) {
  const rows = await postgres.users.list();
  const users = await Promise.all(rows.map(async (row) => storedUser(
    row,
    await postgres.contacts.listForUser(row.id),
  )));
  return {
    configured: users.filter((user) => user.source === 'configured'),
    registered: users.filter((user) => user.source === 'registered'),
  };
}

async function importUser(postgres, source, user) {
  let row = await postgres.users.findByUsername(user.name);
  if (!row) {
    row = await postgres.users.create({
      source,
      username: user.name,
      displayName: user.name,
      ...credentialInput(user),
    });
  }
  const contacts = await postgres.contacts.listForUser(row.id);
  const kinds = new Set(contacts.map((contact) => contact.kind));
  if (user.email && !kinds.has('email')) {
    await postgres.contacts.upsert({
      userId: row.id,
      kind: 'email',
      value: user.email,
      verifiedAt: user.emailVerifiedAt,
    });
  }
  if (user.phone && !kinds.has('phone')) {
    await postgres.contacts.upsert({
      userId: row.id,
      kind: 'phone',
      value: user.phone,
      verifiedAt: user.phoneVerifiedAt,
    });
  }
}

function publicTranscript(file) {
  if (!file) return null;
  return {
    id: file.id,
    name: file.originalName,
    type: file.contentType,
    size: Number(file.byteSize),
    updatedAt: asIso(file.createdAt),
    sha256: file.sha256,
    cosKey: file.cosKey,
  };
}

function storageConfigured(env) {
  return env.STORAGE_REQUIRED === 'true'
    || Boolean(env.DATABASE_URL || env.REDIS_URL || env.COS_SECRET_ID || env.COS_SECRET_KEY);
}

export async function createProductionStorage(env = process.env) {
  if (!storageConfigured(env)) return null;
  const {
    createPostgresStoreFromEnv,
    createPrivateCosStoreFromEnv,
    createRedisOtpStoreFromEnv,
    createResendInboundProcessorFromEnv,
  } = await import('./storage/index.mjs');
  let postgres;
  let redisOtp;
  try {
    postgres = createPostgresStoreFromEnv(env);
    redisOtp = createRedisOtpStoreFromEnv(env);
    const cos = createPrivateCosStoreFromEnv(env);
    await postgres.connect();
    await postgres.migrate();
    await redisOtp.connect();
    await cos.healthCheck();

    return Object.freeze({
      postgres,
      redisOtp,
      cos,

      async bootstrapUsers({ configured, registered }) {
        for (const user of configured) await importUser(postgres, 'configured', user);
        for (const user of registered) await importUser(postgres, 'registered', user);
        return loadUsers(postgres);
      },

      async reloadUsers() {
        return loadUsers(postgres);
      },

      async createRegisteredUser(user) {
        try {
          return await postgres.withTransaction(async (transaction) => {
            const created = await transaction.users.create({
              source: 'registered',
              username: user.name,
              displayName: user.name,
              ...credentialInput(user),
            });
            await transaction.contacts.upsert({
              userId: created.id,
              kind: 'email',
              value: user.email,
              verifiedAt: user.emailVerifiedAt,
            });
            return created;
          });
        } catch (error) {
          if (postgresConflict(error)) throw new Error('user-unavailable');
          throw error;
        }
      },

      async updateContact(user, kind, value, verifiedAt) {
        try {
          await postgres.contacts.upsert({
            userId: user.id,
            kind,
            value,
            verifiedAt,
          });
        } catch (error) {
          if (postgresConflict(error)) throw new Error(`${kind}-taken`);
          throw error;
        }
      },

      async updatePassword(user, credentials) {
        const updated = await postgres.users.updatePassword(user.id, {
          passwordHash: credentials.hash,
          passwordSalt: credentials.salt,
          passwordScheme: credentials.passwordScheme,
        });
        if (!updated) throw new Error('user-not-found');
      },

      async getState(user) {
        return postgres.learningStates.get(user.id, PRIMARY_STATE_KEY);
      },

      async putState(user, state, expectedRevision) {
        return postgres.learningStates.put({
          userId: user.id,
          key: PRIMARY_STATE_KEY,
          state,
          expectedRevision,
        });
      },

      async importStateIfMissing(user, state) {
        const current = await postgres.learningStates.get(user.id, PRIMARY_STATE_KEY);
        if (current) return false;
        await postgres.learningStates.put({
          userId: user.id,
          key: PRIMARY_STATE_KEY,
          state,
        });
        return true;
      },

      async getTranscript(user, includeBody = false) {
        const files = await postgres.userFiles.list(user.id, 'transcript');
        const meta = publicTranscript(files[0]);
        if (!meta || !includeBody) return meta ? { meta, body: null } : null;
        const stored = await cos.read({ userId: user.id, key: meta.cosKey });
        const body = Buffer.from(stored.body);
        const digest = crypto.createHash('sha256').update(body).digest('hex');
        if (body.length !== meta.size || digest !== meta.sha256) {
          throw new Error('stored-file-invalid');
        }
        return { meta, body };
      },

      async putTranscript(user, { body, name, type }) {
        const sha256 = crypto.createHash('sha256').update(body).digest('hex');
        const upload = await cos.uploadTranscript({
          userId: user.id,
          body,
          contentType: type,
        });
        let previous = [];
        try {
          previous = await postgres.userFiles.list(user.id, 'transcript');
          const created = await postgres.withTransaction(async (transaction) => {
            for (const file of previous) {
              await transaction.userFiles.markDeleted(user.id, file.id);
            }
            return transaction.userFiles.create({
              userId: user.id,
              purpose: 'transcript',
              cosKey: upload.key,
              originalName: name,
              contentType: type,
              byteSize: upload.byteSize,
              sha256,
            });
          });
          await Promise.allSettled(previous.map(
            (file) => cos.delete({ userId: user.id, key: file.cosKey }),
          ));
          return publicTranscript(created);
        } catch (error) {
          await cos.delete({ userId: user.id, key: upload.key }).catch(() => {});
          throw error;
        }
      },

      async deleteTranscript(user) {
        const files = await postgres.userFiles.list(user.id, 'transcript');
        if (files.length === 0) return false;
        await postgres.withTransaction(async (transaction) => {
          for (const file of files) {
            await transaction.userFiles.markDeleted(user.id, file.id);
          }
        });
        await Promise.allSettled(files.map(
          (file) => cos.delete({ userId: user.id, key: file.cosKey }),
        ));
        return true;
      },

      createInboundProcessor(resolveUserId) {
        return createResendInboundProcessorFromEnv({
          postgres,
          cos,
          resolveUserId,
          quotaStore: redisOtp,
        }, env);
      },

      async close() {
        await Promise.allSettled([postgres.close(), redisOtp.close()]);
      },
    });
  } catch (error) {
    await Promise.allSettled([
      postgres?.close?.(),
      redisOtp?.close?.(),
    ]);
    throw error;
  }
}
