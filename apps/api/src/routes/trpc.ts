import { Hono } from 'hono'
import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { appRouter } from '../trpc/router'
import { createContext } from '../trpc/context'
import { apiKeyMiddleware } from '../middleware/auth'

export const trpcRoute = new Hono()

trpcRoute.use('/trpc/*', apiKeyMiddleware)

trpcRoute.all('/trpc/*', (c) =>
  fetchRequestHandler({
    endpoint: '/trpc',
    req: c.req.raw,
    router: appRouter,
    createContext,
  })
)
