import { test, expect, type APIRequestContext, type Page } from '@playwright/test'

async function createProject(request: APIRequestContext, namePrefix: string) {
  const res = await request.post('http://localhost:3001/api/projects', {
    data: { name: `${namePrefix}-${Date.now()}` },
  })
  expect(res.ok()).toBe(true)
  const body = await res.json()
  return body.id as string
}

async function openProjectView(page: Page, request: APIRequestContext, view: 'brief' | 'settings', namePrefix: string) {
  const id = await createProject(request, namePrefix)
  await page.goto(`/projects/${id}/${view}`)
  return id
}

test.describe('Pipeline Flow', () => {
  test('should load the app and show brief editor', async ({ page, request }) => {
    await openProjectView(page, request, 'brief', 'Pipeline Test')
    await expect(page.locator('textarea').first()).toBeVisible({ timeout: 10000 })
  })

  test('should write brief text', async ({ page, request }) => {
    await openProjectView(page, request, 'brief', 'Brief Text Test')

    const textarea = page.locator('textarea').first()
    await textarea.fill('This is a test brief')
    await expect(textarea).toHaveValue('This is a test brief')
  })

  test('should open settings and show model configuration', async ({ page, request }) => {
    await openProjectView(page, request, 'settings', 'Settings Test')

    await expect(page.getByLabel(/OpenRouter API Key/i)).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('heading', { name: 'Ключи и текстовые модели' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Мастер-промпты' })).toBeVisible()
  })

  test('health check endpoint should work', async ({ request }) => {
    const res = await request.get('http://localhost:3001/api/health')
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(body.status).toBe('ok')
  })
})
