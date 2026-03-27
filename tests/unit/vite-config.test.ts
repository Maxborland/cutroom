// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { resolveDevProxyTarget, resolveDevProxyTargetFromMode } from '../../vite.config'

describe('vite dev proxy config', () => {
  it('uses configured app port for local API proxy target', () => {
    expect(resolveDevProxyTarget({ PORT: '3003' })).toBe('http://localhost:3003')
  })

  it('falls back to port 3001 when PORT is missing or invalid', () => {
    expect(resolveDevProxyTarget({})).toBe('http://localhost:3001')
    expect(resolveDevProxyTarget({ PORT: 'abc' })).toBe('http://localhost:3001')
  })

  it('reads PORT from vite env files for the current mode', () => {
    expect(resolveDevProxyTargetFromMode('development')).toBe('http://localhost:3003')
  })
})
