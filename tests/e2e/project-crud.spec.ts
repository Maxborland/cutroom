import { test, expect } from '@playwright/test'

test.describe('Project CRUD', () => {
  test('should create a new project or show existing', async ({ page }) => {
    await page.goto('/')

    // Wait for app to load
    await page.waitForTimeout(3000)

    // If no projects, create one
    const nameInput = page.locator('input[placeholder="Название проекта..."]')
    if (await nameInput.isVisible().catch(() => false)) {
      await nameInput.fill('E2E Test Project')
      await page.locator('text=Создать проект').click()
      await expect(page.getByRole('button', { name: 'Бриф' })).toBeVisible({ timeout: 10000 })
    } else {
      // Projects exist, we should see the sidebar with navigation buttons
      await expect(page.getByRole('button', { name: 'Бриф' })).toBeVisible({ timeout: 10000 })
    }
  })

  test('should display sidebar navigation', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(3000)

    const nameInput = page.locator('input[placeholder="Название проекта..."]')
    if (await nameInput.isVisible().catch(() => false)) {
      await nameInput.fill('Nav Test')
      await page.locator('text=Создать проект').click()
    }

    // Check sidebar navigation buttons (exact: true to avoid substring matches)
    await expect(page.getByRole('button', { name: 'Бриф', exact: true })).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('button', { name: 'Сценарий', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Шоты', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Ревью', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Экспорт', exact: true })).toBeVisible()
  })

  test('should navigate between views', async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(3000)

    const nameInput = page.locator('input[placeholder="Название проекта..."]')
    if (await nameInput.isVisible().catch(() => false)) {
      await nameInput.fill('Navigate Test')
      await page.locator('text=Создать проект').click()
      await page.waitForTimeout(1000)
    }

    // Click on Настройки
    await page.getByRole('button', { name: 'Настройки' }).click()
    await expect(page.locator('text=OpenRouter API')).toBeVisible({ timeout: 5000 })
  })
})
