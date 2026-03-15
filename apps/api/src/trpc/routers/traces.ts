import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { router, publicProcedure } from '../init'
import {
  getTrace,
  listTraces,
  deleteTrace,
  searchTraces,
  getTraceStats,
  getAnalytics,
  getTeamStats,
  getPrCosts,
} from '../../services/trace'
import { TRPCError } from '@trpc/server'
import { traces } from '../../db/schema'

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

  teamStats: publicProcedure
    .input(z.object({ days: z.number().min(1).max(365).default(30) }))
    .query(async ({ ctx, input }) => {
      const result = await getTeamStats(ctx.db, input.days)
      if (!result.ok) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' })
      return result.data
    }),

  prCosts: publicProcedure
    .input(z.object({ days: z.number().min(1).max(365).default(30) }))
    .query(async ({ ctx, input }) => {
      const result = await getPrCosts(ctx.db, input.days)
      if (!result.ok) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' })
      return result.data
    }),

  createShareLink: publicProcedure
    .input(z.object({ traceId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user) {
        throw new TRPCError({ code: 'UNAUTHORIZED' })
      }

      // Access check: verify trace exists
      const [trace] = await ctx.db
        .select({ id: traces.id })
        .from(traces)
        .where(eq(traces.id, input.traceId))
        .limit(1)

      if (!trace) {
        throw new TRPCError({ code: 'NOT_FOUND' })
      }

      // Generate cryptographically random 32-char base64url token (~143 bits)
      const bytes = new Uint8Array(24)
      crypto.getRandomValues(bytes)
      const token = btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '')

      await ctx.db
        .update(traces)
        .set({ shareToken: token })
        .where(eq(traces.id, input.traceId))

      const webUrl = process.env.TRACEFORGE_WEB_URL ?? 'http://localhost:3000'
      return { token, shareUrl: `${webUrl}/share/${token}` }
    }),

  revokeShareLink: publicProcedure
    .input(z.object({ traceId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user) {
        throw new TRPCError({ code: 'UNAUTHORIZED' })
      }

      // Access check: verify trace exists
      const [trace] = await ctx.db
        .select({ id: traces.id })
        .from(traces)
        .where(eq(traces.id, input.traceId))
        .limit(1)

      if (!trace) {
        throw new TRPCError({ code: 'NOT_FOUND' })
      }

      await ctx.db
        .update(traces)
        .set({ shareToken: null })
        .where(eq(traces.id, input.traceId))
    }),
})
