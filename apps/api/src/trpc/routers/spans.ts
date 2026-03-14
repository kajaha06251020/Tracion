import { z } from 'zod'
import { router, publicProcedure } from '../init'
import { getSpan, listSpansByTrace } from '../../services/span'
import { TRPCError } from '@trpc/server'

export const spansRouter = router({
  get: publicProcedure
    .input(z.string())
    .query(async ({ ctx, input }) => {
      const result = await getSpan(ctx.db, input)
      if (!result.ok) throw new TRPCError({ code: 'NOT_FOUND' })
      return result.data
    }),

  listByTrace: publicProcedure
    .input(z.string())
    .query(async ({ ctx, input }) => {
      const result = await listSpansByTrace(ctx.db, input)
      if (!result.ok) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' })
      return result.data
    }),
})
