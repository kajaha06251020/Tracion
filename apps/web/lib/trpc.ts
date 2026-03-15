import { createTRPCReact } from '@trpc/react-query'
import type { AppRouter } from '@traceforge/api/src/trpc/router'

export const trpc = createTRPCReact<AppRouter>()
