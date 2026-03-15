import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

// Mock the auth module before importing the middleware
vi.mock('./index', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}))

import { auth } from './index'
import { requireSession } from '../middleware/session'

function buildApp() {
  const app = new Hono()
  app.use('/protected/*', requireSession)
  app.get('/protected/hello', (c) => c.json({ ok: true }))
  return app
}

describe('requireSession', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns 401 when no session exists', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null)
    const app = buildApp()
    const res = await app.request('/protected/hello')
    expect(res.status).toBe(401)
  })

  it('proceeds to handler when session exists', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      session: { id: 'sess_1', userId: 'user_1', expiresAt: new Date() },
      user: { id: 'user_1', email: 'test@example.com', name: 'Test User', emailVerified: false, createdAt: new Date(), updatedAt: new Date() },
    })
    const app = buildApp()
    const res = await app.request('/protected/hello')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })
})
