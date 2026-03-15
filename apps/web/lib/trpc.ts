import { createTRPCReact } from '@trpc/react-query'
import type { AppRouter } from '@tracion/api/src/trpc/router'

export const trpc = createTRPCReact<AppRouter>()
