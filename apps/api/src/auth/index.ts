import { betterAuth } from 'better-auth'
import { Pool } from 'pg'

// Better Auth uses its own Pool connection (separate from Drizzle)
const pool = new Pool({
  connectionString: process.env.TRACION_DATABASE_URL,
})

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET as string,
  database: {
    provider: 'pg',
    pool,
  },
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID as string,
      clientSecret: process.env.GITHUB_CLIENT_SECRET as string,
    },
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
    },
  },
  trustedOrigins: [process.env.TRACION_WEB_URL ?? 'http://localhost:3000'],
})

export type Auth = typeof auth
