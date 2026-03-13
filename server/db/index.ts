import { Pool } from 'pg';

export function createDb(connectionString = process.env.DATABASE_URL ?? ''): Pool {
  if (!connectionString) {
    throw new Error('DATABASE_URL is not configured');
  }

  return new Pool({ connectionString });
}

export async function healthcheckDb(pool: Pool): Promise<boolean> {
  const result = await pool.query<{ ok: number }>('select 1 as ok');
  return result.rows[0]?.ok === 1;
}
