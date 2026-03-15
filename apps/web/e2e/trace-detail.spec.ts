import { test, expect } from '@playwright/test'

// Runs with auth-state.json applied (created by globalSetup)
test.describe('Trace detail', () => {
  test('waterfall renders and span click shows attributes panel', async ({ page }) => {
    await page.goto('/traces')
    // Wait for the table to load
    await expect(page.locator('table tbody tr').first()).toBeVisible()

    // Click the first trace name link
    await page.locator('table tbody tr').first().locator('a').click()

    // Waterfall table is visible
    await expect(page.locator('table thead')).toContainText('Span')

    // Click the first span row to open the attributes panel
    await page.locator('table tbody tr').first().click()

    // Attributes panel appears
    await expect(page.locator('[data-testid="span-attributes"]')).toBeVisible()
  })
})
