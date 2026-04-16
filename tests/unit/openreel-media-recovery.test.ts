import { describe, expect, it, vi } from 'vitest'
import { restoreMediaItem } from '../../vendor/openreel-video/apps/web/src/utils/media-recovery'

describe('openreel media recovery', () => {
  it('ignores non-Blob media payloads restored from serialized auto-saves', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL')

    const item = {
      id: 'media-1',
      name: 'broken.mp4',
      type: 'video',
      blob: {} as Blob,
      thumbnailUrl: null,
    }

    const restored = await restoreMediaItem(item as never, undefined)

    expect(createObjectURL).not.toHaveBeenCalled()
    expect(restored.blob).toBeNull()
  })
})
