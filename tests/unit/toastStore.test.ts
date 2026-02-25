import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('toastStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('deduplicates identical toasts inside the dedupe window', async () => {
    const { useToastStore } = await import('../../src/stores/toastStore')
    const { addToast } = useToastStore.getState()

    addToast('error', 'Ошибка генерации', 'Проверьте сеть')
    addToast('error', 'Ошибка генерации', 'Проверьте сеть')
    expect(useToastStore.getState().toasts).toHaveLength(1)

    vi.advanceTimersByTime(2600)
    addToast('error', 'Ошибка генерации', 'Проверьте сеть')
    expect(useToastStore.getState().toasts).toHaveLength(2)
  })

  it('auto-removes toast after timeout', async () => {
    const { useToastStore } = await import('../../src/stores/toastStore')
    const { addToast } = useToastStore.getState()

    addToast('info', 'Сохранено')
    expect(useToastStore.getState().toasts).toHaveLength(1)

    vi.advanceTimersByTime(5000)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })
})

