import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const testFileDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(testFileDir, '..', '..')

function assertValidJavaScript(filePath: string) {
  execFileSync(process.execPath, ['--check', filePath], {
    cwd: repoRoot,
    stdio: 'pipe',
  })
}

describe('OpenReel submodule setup', () => {
  it('adds .gitmodules with openreel-video entry', () => {
    const gitmodulesPath = path.join(repoRoot, '.gitmodules')
    expect(existsSync(gitmodulesPath)).toBe(true)

    const gitmodules = readFileSync(gitmodulesPath, 'utf8')
    expect(gitmodules).toContain('vendor/openreel-video')
    expect(gitmodules).toContain('https://github.com/Augani/openreel-video.git')
  })

  it('includes a valid sync script', () => {
    const syncScriptPath = path.join(repoRoot, 'scripts', 'openreel', 'sync.mjs')
    expect(existsSync(syncScriptPath)).toBe(true)
    expect(() => assertValidJavaScript(syncScriptPath)).not.toThrow()
  })

  it('includes a valid build script', () => {
    const buildScriptPath = path.join(repoRoot, 'scripts', 'openreel', 'build.mjs')
    expect(existsSync(buildScriptPath)).toBe(true)
    expect(() => assertValidJavaScript(buildScriptPath)).not.toThrow()
  })

  it('adds npm scripts for openreel sync/build/update', () => {
    const packageJsonPath = path.join(repoRoot, 'package.json')
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))

    expect(packageJson.scripts).toMatchObject({
      'openreel:sync': 'node scripts/openreel/sync.mjs',
      'openreel:build': 'node scripts/openreel/build.mjs',
      'openreel:update': 'node scripts/openreel/sync.mjs && node scripts/openreel/build.mjs',
    })
  })
})
