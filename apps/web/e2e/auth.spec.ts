import { test, expect } from '@playwright/test'

// Runs in the 'unauthenticated' project (no storageState)
test.describe('Authentication', () => {
  test('unauthenticated visit to /traces redirects to /login', async ({ page }) => {
    await page.goto('/traces')
    await expect(page).toHaveURL(/\/login/)
    await expect(page.getByText('Sign in with GitHub')).toBeVisible()
    await expect(page.getByText('Sign in with Google')).toBeVisible()
  })
})
