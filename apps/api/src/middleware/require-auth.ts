import { createMiddleware } from 'hono/factory'
import { auth } from '../auth/index'

/**
 * requireAuth — accepts either:
 *  1. A valid Better Auth session cookie  (web dashboard)
 *  2. A valid X-Traceforge-Api-Key header (MCP server / SDK / CLI)
 *
 * When the API key is absent from the environment (dev mode), all requests
 * are allowed through and user is set to null — matching the behaviour of
 * the existing apiKeyMiddleware on the ingest route.
 */
export const requireAuth = createMiddleware(async (c, next) => {
  // ── Path 1: API key (machine-to-machine) ──────────────────────────────
  const requiredKey = process.env.TRACEFORGE_API_KEY
  const providedKey = c.req.header('X-Traceforge-Api-Key')

  if (providedKey !== undefined) {
    // A key was sent — validate it (or allow through in dev mode)
    if (!requiredKey || providedKey === requiredKey) {
      c.set('user', null)
      return next()
    }
    return c.json({ error: 'Unauthorized' }, 401)
  }

  // ── Path 2: session cookie (web dashboard) ────────────────────────────
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (session) {
    c.set('user', session.user)
    return next()
  }

  // ── Dev mode: no key set, no session — allow through ─────────────────
  if (!requiredKey) {
    c.set('user', null)
    return next()
  }

  return c.json({ error: 'Unauthorized' }, 401)
})
