import { describe, expect, it } from 'vitest'
import { mapWithConcurrency } from '../../src/lib/async-pool'

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

describe('mapWithConcurrency', () => {
  it('runs tasks with bounded concurrency', async () => {
    let active = 0
    let maxActive = 0

    const items = [1, 2, 3, 4, 5, 6]
    const results = await mapWithConcurrency(items, 2, async (item) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await sleep(15)
      active -= 1
      return item * 2
    })

    expect(maxActive).toBeLessThanOrEqual(2)
    expect(results).toHaveLength(6)
    expect(results.map((r) => (r.status === 'fulfilled' ? r.value : null))).toEqual([2, 4, 6, 8, 10, 12])
  })

  it('keeps processing after individual task failures', async () => {
    const items = [1, 2, 3]
    const results = await mapWithConcurrency(items, 2, async (item) => {
      if (item === 2) {
        throw new Error('boom')
      }
      return item
    })

    expect(results[0].status).toBe('fulfilled')
    expect(results[1].status).toBe('rejected')
    expect(results[2].status).toBe('fulfilled')
  })
})
