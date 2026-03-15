import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'

vi.mock('../auth/index', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}))

import { auth } from '../auth/index'
import { requireAuth } from './require-auth'

function buildApp() {
  const app = new Hono()
  app.use('/trpc/*', requireAuth)
  app.get('/trpc/test', (c) => c.json({ ok: true, user: c.get('user') }))
  return app
}

describe('requireAuth', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    delete process.env.TRACION_API_KEY
  })

  describe('API key auth (machine-to-machine)', () => {
    it('allows request when API key matches', async () => {
      process.env.TRACION_API_KEY = 'secret-key'
      const app = buildApp()
      const res = await app.request('/trpc/test', {
        headers: { 'X-Tracion-Api-Key': 'secret-key' },
      })
      expect(res.status).toBe(200)
    })

    it('rejects request when API key is wrong', async () => {
      process.env.TRACION_API_KEY = 'secret-key'
      const app = buildApp()
      const res = await app.request('/trpc/test', {
        headers: { 'X-Tracion-Api-Key': 'wrong-key' },
      })
      expect(res.status).toBe(401)
    })

    it('allows request with any key when TRACION_API_KEY is unset (dev mode)', async () => {
      const app = buildApp()
      const res = await app.request('/trpc/test', {
        headers: { 'X-Tracion-Api-Key': 'any-key' },
      })
      expect(res.status).toBe(200)
    })
  })

  describe('session auth (web dashboard)', () => {
    it('allows request when valid session exists', async () => {
      vi.mocked(auth.api.getSession).mockResolvedValue({
        session: { id: 's1', userId: 'u1', expiresAt: new Date() },
        user: { id: 'u1', email: 'a@b.com', name: 'A', emailVerified: false, createdAt: new Date(), updatedAt: new Date() },
      })
      const app = buildApp()
      const res = await app.request('/trpc/test')
      expect(res.status).toBe(200)
    })

    it('rejects when no session and API key is required', async () => {
      process.env.TRACION_API_KEY = 'secret-key'
      vi.mocked(auth.api.getSession).mockResolvedValue(null)
      const app = buildApp()
      const res = await app.request('/trpc/test')
      expect(res.status).toBe(401)
    })
  })

  describe('dev mode (no API key configured, no session)', () => {
    it('allows all requests through', async () => {
      vi.mocked(auth.api.getSession).mockResolvedValue(null)
      const app = buildApp()
      const res = await app.request('/trpc/test')
      expect(res.status).toBe(200)
    })
  })
})
