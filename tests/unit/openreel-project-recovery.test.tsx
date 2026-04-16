import { describe, expect, it } from 'vitest'
import { isEmbeddedOpenReel } from '../../vendor/openreel-video/apps/web/src/utils/embedded-mode'

describe('openreel embedded mode helper', () => {
  it('detects iframe-hosted OpenReel instances as embedded', () => {
    const embeddedWindow = {
      self: {},
      top: {},
    } as Window

    expect(isEmbeddedOpenReel(embeddedWindow)).toBe(true)
  })
})
