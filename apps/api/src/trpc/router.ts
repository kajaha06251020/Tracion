import { initTRPC } from '@trpc/server'
import type { Context } from './context'
import { tracesRouter } from './routers/traces'
import { spansRouter } from './routers/spans'

const t = initTRPC.context<Context>().create()

export const router = t.router
export const publicProcedure = t.procedure

export const appRouter = router({
  traces: tracesRouter,
  spans: spansRouter,
})

export type AppRouter = typeof appRouter
