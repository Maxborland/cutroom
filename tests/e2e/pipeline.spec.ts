import { test, expect } from '@playwright/test'

test.describe('Pipeline Flow', () => {
  test('should load the app and show brief editor', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(3000)

    const nameInput = page.locator('input[placeholder="Название проекта..."]')
    if (await nameInput.isVisible().catch(() => false)) {
      await nameInput.fill('Pipeline Test')
      await page.locator('text=Создать проект').click()
      await page.waitForTimeout(1000)
    }

    await expect(page.locator('textarea').first()).toBeVisible({ timeout: 10000 })
  })

  test('should write brief text', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(3000)

    const nameInput = page.locator('input[placeholder="Название проекта..."]')
    if (await nameInput.isVisible().catch(() => false)) {
      await nameInput.fill('Brief Text Test')
      await page.locator('text=Создать проект').click()
      await page.waitForTimeout(1000)
    }

    const textarea = page.locator('textarea').first()
    await textarea.fill('This is a test brief')
    await page.waitForTimeout(1000)
    await expect(textarea).toHaveValue('This is a test brief')
  })

  test('should open settings and show model configuration', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(3000)

    const nameInput = page.locator('input[placeholder="Название проекта..."]')
    if (await nameInput.isVisible().catch(() => false)) {
      await nameInput.fill('Settings Test')
      await page.locator('text=Создать проект').click()
      await page.waitForTimeout(1000)
    }

    await page.getByRole('button', { name: 'Настройки' }).click()
    await expect(page.locator('text=OpenRouter API')).toBeVisible({ timeout: 5000 })
    await expect(page.locator('text=Модели')).toBeVisible()
    await expect(page.locator('text=Мастер-промпты')).toBeVisible()
  })

  test('health check endpoint should work', async ({ request }) => {
    const res = await request.get('http://localhost:3001/api/health')
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(body.status).toBe('ok')
  })
})
