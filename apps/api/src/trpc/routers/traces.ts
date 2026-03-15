import { z } from 'zod'
import { router, publicProcedure } from '../init'
import {
  getTrace,
  listTraces,
  deleteTrace,
  searchTraces,
  getTraceStats,
  getAnalytics,
} from '../../services/trace'
import { TRPCError } from '@trpc/server'

function traceErrorToTRPC(code: string): TRPCError {
  if (code === 'NOT_FOUND') return new TRPCError({ code: 'NOT_FOUND' })
  return new TRPCError({ code: 'INTERNAL_SERVER_ERROR' })
}

export const tracesRouter = router({
  list: publicProcedure
    .input(
      z.object({
        cursor: z.string().optional(),
        limit: z.number().min(1).max(100).default(20),
        agentId: z.string().optional(),
        status: z.enum(['running', 'success', 'error']).optional(),
        search: z.string().optional(),
        since: z.string().datetime().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const result = await listTraces(ctx.db, input)
      if (!result.ok) throw traceErrorToTRPC(result.error.code)
      return result.data
    }),

  get: publicProcedure
    .input(z.string())
    .query(async ({ ctx, input }) => {
      const result = await getTrace(ctx.db, input)
      if (!result.ok) throw traceErrorToTRPC(result.error.code)
      return result.data
    }),

  delete: publicProcedure
    .input(z.string())
    .mutation(async ({ ctx, input }) => {
      const result = await deleteTrace(ctx.db, input)
      if (!result.ok) throw traceErrorToTRPC(result.error.code)
    }),

  search: publicProcedure
    .input(z.object({
      query: z.string(),
      limit: z.number().default(20),
      since: z.string().datetime().optional(),
      until: z.string().datetime().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const result = await searchTraces(ctx.db, input.query, input.limit, input.since, input.until)
      if (!result.ok) throw traceErrorToTRPC(result.error.code)
      return result.data
    }),

  stats: publicProcedure
    .query(async ({ ctx }) => {
      const result = await getTraceStats(ctx.db)
      if (!result.ok) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' })
      return result.data
    }),

  analytics: publicProcedure
    .input(z.object({ days: z.number().min(1).max(365).default(30) }))
    .query(async ({ ctx, input }) => {
      const result = await getAnalytics(ctx.db, input.days)
      if (!result.ok) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' })
      return result.data
    }),
})
