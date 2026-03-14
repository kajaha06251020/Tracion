import { router } from './init'
import { tracesRouter } from './routers/traces'
import { spansRouter } from './routers/spans'

export { router, publicProcedure } from './init'

export const appRouter = router({
  traces: tracesRouter,
  spans: spansRouter,
})

export type AppRouter = typeof appRouter
