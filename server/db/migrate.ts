import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { createDb, healthcheckDb } from './index.js';

type Migration = {
  version: string;
  sql: string;
};

const migrationsTableName = 'schema_migrations';
const dbDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(dbDir, 'migrations');

async function ensureMigrationsTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${migrationsTableName} (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function loadMigrations(): Promise<Migration[]> {
  const entries = await readdir(migrationsDir, { withFileTypes: true });

  const migrations = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(async (entry) => ({
        version: entry.name.replace(/\.sql$/i, ''),
        sql: await readFile(path.join(migrationsDir, entry.name), 'utf8'),
      })),
  );

  return migrations;
}

async function getAppliedVersions(pool: Pool): Promise<Set<string>> {
  const result = await pool.query<{ version: string }>(
    `SELECT version FROM ${migrationsTableName} ORDER BY version ASC`,
  );

  return new Set(result.rows.map((row) => row.version));
}

async function applyMigration(pool: Pool, migration: Migration): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(migration.sql);
    await client.query(
      `INSERT INTO ${migrationsTableName} (version) VALUES ($1) ON CONFLICT (version) DO NOTHING`,
      [migration.version],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function run(): Promise<void> {
  const checkOnly = process.argv.includes('--check');
  const connectionString = process.env.DATABASE_URL ?? '';
  const pool = createDb(connectionString);

  try {
    const healthy = await healthcheckDb(pool);
    if (!healthy) {
      throw new Error('database healthcheck failed');
    }

    await ensureMigrationsTable(pool);

    const migrations = await loadMigrations();
    const appliedVersions = await getAppliedVersions(pool);
    const pendingMigrations = migrations.filter((migration) => !appliedVersions.has(migration.version));

    if (checkOnly) {
      if (pendingMigrations.length === 0) {
        console.log(`[db] Migration status: ok (${migrations.length} applied, 0 pending).`);
        return;
      }

      throw new Error(
        `pending migrations detected (${pendingMigrations.length}): ${pendingMigrations.map((migration) => migration.version).join(', ')}`,
      );
    }

    if (pendingMigrations.length === 0) {
      console.log('[db] No pending migrations.');
      return;
    }

    for (const migration of pendingMigrations) {
      console.log(`[db] Applying migration ${migration.version}`);
      await applyMigration(pool, migration);
    }

    console.log(`[db] Applied ${pendingMigrations.length} migration(s).`);
  } finally {
    await pool.end();
  }
}

void run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[db] Migration command failed: ${message}`);
  process.exitCode = 1;
});
