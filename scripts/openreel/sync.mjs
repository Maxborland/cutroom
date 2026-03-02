import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..', '..')
const submodulePath = path.join('vendor', 'openreel-video')

const result = spawnSync('git', ['submodule', 'update', '--init', '--recursive', submodulePath], {
  cwd: repoRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

if (result.error) {
  console.error('Failed to sync OpenReel submodule:', result.error.message)
  process.exit(1)
}

if (result.status !== 0) {
  process.exit(result.status ?? 1)
}

console.log('OpenReel submodule is up to date.')
