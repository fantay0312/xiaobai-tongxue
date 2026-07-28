import crypto from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { requireUrl, positiveInteger } from '../config.mjs';

const { Pool } = pg;
const MIGRATION_LOCK_ID = 2_041_160_001;
const migrationsDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'migrations',
);

function postgresSsl(env) {
  const mode = env.DATABASE_SSL_MODE || 'verify-full';
  if (mode === 'disable') {
    const configuredUrl = new URL(requireUrl(
      env,
      'DATABASE_URL',
      ['postgres:', 'postgresql:'],
    ));
    const privateAddress = configuredUrl.hostname === 'localhost'
      || configuredUrl.hostname === '127.0.0.1'
      || configuredUrl.hostname === '::1'
      || /^10\./.test(configuredUrl.hostname)
      || /^192\.168\./.test(configuredUrl.hostname)
      || /^172\.(1[6-9]|2\d|3[01])\./.test(configuredUrl.hostname);
    if (env.NODE_ENV !== 'test'
      && (env.DATABASE_ALLOW_PRIVATE_PLAINTEXT !== 'true' || !privateAddress)) {
      throw new Error('insecure-config:DATABASE_SSL_MODE');
    }
    return false;
  }
  if (mode !== 'verify-full') throw new Error('invalid-config:DATABASE_SSL_MODE');
  return {
    rejectUnauthorized: true,
    ...(env.DATABASE_SSL_CA ? { ca: env.DATABASE_SSL_CA.replace(/\\n/g, '\n') } : {}),
  };
}

export function createPostgresPoolFromEnv(env = process.env) {
  const connectionString = requireUrl(env, 'DATABASE_URL', ['postgres:', 'postgresql:']);
  return new Pool({
    connectionString,
    ssl: postgresSsl(env),
    max: positiveInteger(env.DATABASE_POOL_MAX, 10, 'DATABASE_POOL_MAX', 50),
    connectionTimeoutMillis: positiveInteger(
      env.DATABASE_CONNECT_TIMEOUT_MS,
      10_000,
      'DATABASE_CONNECT_TIMEOUT_MS',
      60_000,
    ),
    idleTimeoutMillis: positiveInteger(
      env.DATABASE_IDLE_TIMEOUT_MS,
      30_000,
      'DATABASE_IDLE_TIMEOUT_MS',
      300_000,
    ),
    application_name: 'xiaobai-gateway',
  });
}

export async function postgresHealthCheck(pool) {
  if (!pool?.query) throw new Error('postgres-pool-required');
  const startedAt = Date.now();
  const result = await pool.query('SELECT 1 AS healthy');
  if (result.rows?.[0]?.healthy !== 1) throw new Error('postgres-health-check-failed');
  return { healthy: true, latencyMs: Date.now() - startedAt };
}

export async function runPostgresMigrations(pool, directory = migrationsDirectory) {
  if (!pool?.connect) throw new Error('postgres-pool-required');
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS xiaobai_schema_migrations (
        name TEXT PRIMARY KEY,
        checksum CHAR(64) NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    const names = (await readdir(directory))
      .filter((name) => /^\d+_[a-z0-9_-]+\.sql$/i.test(name))
      .sort();
    let appliedCount = 0;
    for (const name of names) {
      const sql = await readFile(path.join(directory, name), 'utf8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');
      const applied = await client.query(
        'SELECT checksum FROM xiaobai_schema_migrations WHERE name = $1',
        [name],
      );
      if (applied.rows[0]) {
        if (applied.rows[0].checksum !== checksum) {
          throw new Error(`migration-checksum-mismatch:${name}`);
        }
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO xiaobai_schema_migrations (name, checksum) VALUES ($1, $2)',
          [name, checksum],
        );
        await client.query('COMMIT');
        appliedCount += 1;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    return { applied: appliedCount, total: names.length };
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => {});
    client.release();
  }
}
