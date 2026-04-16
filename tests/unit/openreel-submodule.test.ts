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

    const buildScript = readFileSync(buildScriptPath, 'utf8')
    expect(buildScript).toContain('OPENREEL_BASE')
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

  it('exposes the OpenReel project store for the CutRoom bridge loader', () => {
    const entryPath = path.join(repoRoot, 'vendor', 'openreel-video', 'apps', 'web', 'src', 'main.tsx')
    expect(existsSync(entryPath)).toBe(true)

    const entrySource = readFileSync(entryPath, 'utf8')
    expect(entrySource).toContain('__OPENREEL_STORE__')
  })

  it('configures the OpenReel web app to build under /openreel/app/', () => {
    const viteConfigPath = path.join(repoRoot, 'vendor', 'openreel-video', 'apps', 'web', 'vite.config.ts')
    expect(existsSync(viteConfigPath)).toBe(true)

    const viteConfig = readFileSync(viteConfigPath, 'utf8')
    expect(viteConfig).toContain('OPENREEL_BASE')
  })

  it('keeps CutRoom immersive branding hooks in the OpenReel editor shell', () => {
    const editorPath = path.join(repoRoot, 'vendor', 'openreel-video', 'apps', 'web', 'src', 'components', 'editor', 'EditorInterface.tsx')
    const toolbarPath = path.join(repoRoot, 'vendor', 'openreel-video', 'apps', 'web', 'src', 'components', 'editor', 'Toolbar.tsx')
    const cssPath = path.join(repoRoot, 'vendor', 'openreel-video', 'apps', 'web', 'src', 'index.css')

    expect(readFileSync(editorPath, 'utf8')).toContain('cutroom-editor-shell')
    expect(readFileSync(toolbarPath, 'utf8')).toContain('cutroom-toolbar')

    const css = readFileSync(cssPath, 'utf8')
    expect(css).toContain('.cutroom-editor-shell')
    expect(css).toContain('.cutroom-toolbar')
    expect(css).toContain('255, 107, 53')
  })
})
