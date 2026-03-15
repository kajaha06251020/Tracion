import { test, expect } from '@playwright/test'

// Runs with auth-state.json applied (created by globalSetup)
test.describe('DAG graph', () => {
  test('graph tab renders React Flow canvas with nodes', async ({ page }) => {
    await page.goto('/traces')
    await expect(page.locator('table tbody tr').first()).toBeVisible()

    // Navigate to the first trace's detail page
    await page.locator('table tbody tr').first().locator('a').click()

    // Click the Graph tab
    await page.getByRole('link', { name: 'Graph' }).click()

    // React Flow canvas renders
    await expect(page.locator('.react-flow')).toBeVisible()

    // At least one node is visible
    const nodeCount = await page.locator('.react-flow__node').count()
    expect(nodeCount).toBeGreaterThan(0)
  })
})
