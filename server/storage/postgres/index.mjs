import { createContactProtectorFromEnv } from '../contact-crypto.mjs';
import { createAdminAuthRepository } from './admin-auth.mjs';
import { createAdminRbacRepository } from './admin-rbac.mjs';
import { createCatalogRepository } from './catalog.mjs';
import { createCdkRepository } from './cdk.mjs';
import { createAuthAuditRepository, createInboundEmailRepository } from './messaging.mjs';
import { createLearningStateRepository, createUserFileRepository } from './content.mjs';
import { createCustomContentRepository } from './custom-content.mjs';
import { createFeatureRepository } from './features.mjs';
import { createPointRepository } from './points.mjs';
import { createSubscriptionRepository } from './subscriptions.mjs';
import { createUserAccessRepository } from './user-access.mjs';
import { createContactRepository, createUserRepository } from './users.mjs';
import {
  createPostgresPoolFromEnv,
  postgresHealthCheck,
  runPostgresMigrations,
} from './core.mjs';

function dataLayer(queryable, options) {
  return Object.freeze({
    users: createUserRepository(queryable, options),
    contacts: createContactRepository(queryable, options.contactProtector, options),
    learningStates: createLearningStateRepository(queryable),
    userFiles: createUserFileRepository(queryable, options),
    inboundEmails: createInboundEmailRepository(queryable, options),
    authAuditEvents: createAuthAuditRepository(queryable, options),
    adminAuth: createAdminAuthRepository(queryable, options),
    adminRbac: createAdminRbacRepository(queryable, options),
    catalog: createCatalogRepository(queryable, options),
    cdk: createCdkRepository(queryable, options),
    features: createFeatureRepository(queryable, options),
    points: createPointRepository(queryable, options),
    subscriptions: createSubscriptionRepository(queryable, options),
    userAccess: createUserAccessRepository(queryable, options),
    customContent: createCustomContentRepository(queryable, options),
  });
}

export function createPostgresStore({ pool, contactProtector, uuid } = {}) {
  if (!pool?.query || !pool?.connect || !pool?.end) throw new Error('postgres-pool-required');
  if (!contactProtector) throw new Error('contact-protector-required');
  const options = { contactProtector, ...(uuid ? { uuid } : {}) };
  const repositories = dataLayer(pool, options);

  return Object.freeze({
    ...repositories,
    async connect() {
      return postgresHealthCheck(pool);
    },
    async healthCheck() {
      return postgresHealthCheck(pool);
    },
    async migrate() {
      return runPostgresMigrations(pool);
    },
    async withTransaction(work) {
      if (typeof work !== 'function') throw new Error('transaction-callback-required');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await work(dataLayer(client, options));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  });
}

export function createPostgresStoreFromEnv(env = process.env, options = {}) {
  const contactProtector = options.contactProtector ?? createContactProtectorFromEnv(env);
  const pool = options.pool ?? createPostgresPoolFromEnv(env);
  return createPostgresStore({ pool, contactProtector, uuid: options.uuid });
}

export {
  createPostgresPoolFromEnv,
  postgresHealthCheck,
  runPostgresMigrations,
};
