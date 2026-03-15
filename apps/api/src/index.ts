import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger as honoLogger } from 'hono/logger'
import { ingestRoute } from './routes/ingest'
import { trpcRoute } from './routes/trpc'
import { auth } from './auth/index'

const app = new Hono()

app.use('*', honoLogger())
app.use('*', cors({
  origin: process.env.TRACEFORGE_WEB_URL ?? 'http://localhost:3000',
  credentials: true,
}))

// Better Auth handles all /api/auth/* routes
app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw))

app.route('/', ingestRoute)
app.route('/', trpcRoute)

app.get('/health', (c) => c.json({ status: 'ok' }))

const port = parseInt(process.env.PORT ?? '3001', 10)
console.log(`API running on http://localhost:${port}`)

export default {
  port,
  fetch: app.fetch,
}
