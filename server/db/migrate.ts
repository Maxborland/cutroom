import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb as createDbDefault, healthcheckDb as healthcheckDbDefault } from './index.js';

type Migration = {
  version: string;
  sql: string;
};

type QueryResult<Row> = {
  rows: Row[];
};

type MigrationClient = {
  query: <Row>(sql: string, params?: unknown[]) => Promise<QueryResult<Row>>;
  release: () => void;
};

type MigrationPool = {
  connect: () => Promise<MigrationClient>;
  end: () => Promise<void>;
  query: <Row>(sql: string, params?: unknown[]) => Promise<QueryResult<Row>>;
};

type RunMigrationCommandOptions = {
  checkOnly?: boolean;
  connectionString?: string;
  createDb?: (connectionString: string) => MigrationPool;
  healthcheckDb?: (pool: MigrationPool) => Promise<boolean>;
  loadMigrations?: () => Promise<Migration[]>;
  log?: (message: string) => void;
  errorLog?: (message: string) => void;
};

const migrationsTableName = 'schema_migrations';
const dbDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(dbDir, 'migrations');

async function ensureMigrationsTable(pool: MigrationPool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${migrationsTableName} (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function loadMigrationsFromDisk(): Promise<Migration[]> {
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

async function getAppliedVersions(pool: MigrationPool): Promise<Set<string>> {
  const result = await pool.query<{ version: string }>(
    `SELECT version FROM ${migrationsTableName} ORDER BY version ASC`,
  );

  return new Set(result.rows.map((row) => row.version));
}

async function applyMigration(pool: MigrationPool, migration: Migration): Promise<void> {
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

export async function runMigrationCommand({
  checkOnly = process.argv.includes('--check'),
  connectionString = process.env.DATABASE_URL ?? '',
  createDb = createDbDefault,
  healthcheckDb = healthcheckDbDefault,
  loadMigrations = loadMigrationsFromDisk,
  log = console.log,
  errorLog = console.error,
}: RunMigrationCommandOptions = {}): Promise<number> {
  if (!connectionString) {
    errorLog('[db] Migration command failed: DATABASE_URL is not configured');
    return 1;
  }

  const pool = createDb(connectionString);

  try {
    const healthy = await healthcheckDb(pool);
    if (!healthy) {
      throw new Error('database healthcheck failed');
    }

    if (checkOnly) {
      const migrations = await loadMigrations();
      const appliedVersions = await getAppliedVersions(pool);
      const pendingMigrations = migrations.filter((migration) => !appliedVersions.has(migration.version));

      if (pendingMigrations.length === 0) {
        log(`[db] Migration status: ok (${migrations.length} applied, 0 pending).`);
        return 0;
      }

      errorLog(
        `[db] Migration command failed: pending migrations detected (${pendingMigrations.length}): ${pendingMigrations.map((migration) => migration.version).join(', ')}`,
      );
      return 1;
    }

    await ensureMigrationsTable(pool);

    const migrations = await loadMigrations();
    const appliedVersions = await getAppliedVersions(pool);
    const pendingMigrations = migrations.filter((migration) => !appliedVersions.has(migration.version));

    if (pendingMigrations.length === 0) {
      log('[db] No pending migrations.');
      return 0;
    }

    for (const migration of pendingMigrations) {
      log(`[db] Applying migration ${migration.version}`);
      await applyMigration(pool, migration);
    }

    log(`[db] Applied ${pendingMigrations.length} migration(s).`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errorLog(`[db] Migration command failed: ${message}`);
    return 1;
  } finally {
    await pool.end();
  }
}

function isExecutedDirectly(): boolean {
  const entryPath = process.argv[1];
  if (!entryPath) {
    return false;
  }

  return path.resolve(entryPath) === path.resolve(fileURLToPath(import.meta.url));
}

if (isExecutedDirectly()) {
  void runMigrationCommand().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
