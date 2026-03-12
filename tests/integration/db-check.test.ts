import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('db:check', () => {
  it('fails when DATABASE_URL is not configured', () => {
    const tsxCliPath = path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs')
    const result = spawnSync(process.execPath, [tsxCliPath, 'server/db/migrate.ts', '--check'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: '',
      },
      encoding: 'utf8',
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('[db] Migration command failed: DATABASE_URL is not configured')
  })
})
