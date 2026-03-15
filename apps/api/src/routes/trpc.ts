import { Hono } from 'hono'
import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { appRouter } from '../trpc/router'
import { requireSession } from '../middleware/session'
import { db } from '../db/index'

export const trpcRoute = new Hono()

// All tRPC routes require a valid session.
// src/middleware/auth.ts (apiKeyMiddleware) is unchanged — still used by the ingest route.
trpcRoute.use('/trpc/*', requireSession)

trpcRoute.all('/trpc/*', (c) =>
  fetchRequestHandler({
    endpoint: '/trpc',
    req: c.req.raw,
    router: appRouter,
    createContext: () => ({ db, user: c.get('user') }),
  })
)
