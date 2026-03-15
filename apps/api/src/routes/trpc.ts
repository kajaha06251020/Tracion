import { Hono } from 'hono'
import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { appRouter } from '../trpc/router'
import { requireAuth } from '../middleware/require-auth'
import { db } from '../db/index'

export const trpcRoute = new Hono()

// tRPC routes accept either a session cookie (web dashboard) or an API key (MCP server / SDK).
// src/middleware/auth.ts (apiKeyMiddleware) is unchanged — still used by the ingest route.
trpcRoute.use('/trpc/*', requireAuth)

trpcRoute.all('/trpc/*', (c) =>
  fetchRequestHandler({
    endpoint: '/trpc',
    req: c.req.raw,
    router: appRouter,
    createContext: () => ({ db, user: c.get('user') }),
  })
)
