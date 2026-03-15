import { createAuthClient } from 'better-auth/react'

export const authClient = createAuthClient({
  baseURL: typeof window !== 'undefined'
    ? '/api/auth'
    : (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001') + '/api/auth',
})

export const { signIn, signOut, useSession } = authClient
