import { chromium } from '@playwright/test'

async function globalSetup() {
  // Request a test session token from the API
  const res = await fetch('http://localhost:3001/api/test/session', { method: 'POST' })
  if (!res.ok) {
    throw new Error(`Failed to create test session: ${res.status}`)
  }
  const { sessionToken } = await res.json() as { sessionToken: string }

  // Store the session cookie in the shared auth state file
  const browser = await chromium.launch()
  const context = await browser.newContext()
  await context.addCookies([
    {
      name: 'better-auth.session_token',
      value: sessionToken,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ])
  await context.storageState({ path: 'e2e/setup/auth-state.json' })
  await browser.close()
}

export default globalSetup
