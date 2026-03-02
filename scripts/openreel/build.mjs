import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..', '..')
const openreelDir = path.join(repoRoot, 'vendor', 'openreel-video')

if (!existsSync(openreelDir)) {
  console.error('OpenReel submodule not found at', openreelDir)
  console.error('Run "npm run openreel:sync" first.')
  process.exit(1)
}

function runStep(command, args, label) {
  const result = spawnSync(command, args, {
    cwd: openreelDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })

  if (result.error) {
    console.error(`OpenReel ${label} failed:`, result.error.message)
    process.exit(1)
  }

  if (result.status !== 0) {
    console.error(`OpenReel ${label} failed with exit code ${result.status ?? 'unknown'}.`)
    process.exit(result.status ?? 1)
  }
}

runStep('pnpm', ['install'], 'dependency install')
runStep('pnpm', ['build'], 'build')

console.log('OpenReel build completed successfully.')
