import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { requireSession } from '../middleware/session'

vi.mock('./index', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}))

import { auth } from './index'

describe('tRPC auth guard integration', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('rejects tRPC requests without session', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null)

    const app = new Hono()
    app.use('/trpc/*', requireSession)
    app.all('/trpc/*', (c) => c.json({ ok: true }))

    const res = await app.request('/trpc/traces.list')
    expect(res.status).toBe(401)
  })

  it('allows tRPC requests with valid session', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      session: { id: 's1', userId: 'u1', expiresAt: new Date() },
      user: { id: 'u1', email: 'a@b.com', name: 'A', emailVerified: false, createdAt: new Date(), updatedAt: new Date() },
    })

    const app = new Hono()
    app.use('/trpc/*', requireSession)
    app.all('/trpc/*', (c) => c.json({ ok: true }))

    const res = await app.request('/trpc/traces.list')
    expect(res.status).toBe(200)
  })
})
