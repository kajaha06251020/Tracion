import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger as honoLogger } from 'hono/logger'
import { ingestRoute } from './routes/ingest'
import { trpcRoute } from './routes/trpc'

const app = new Hono()

app.use('*', honoLogger())
app.use('*', cors({ origin: '*' }))

app.route('/', ingestRoute)
app.route('/', trpcRoute)

app.get('/health', (c) => c.json({ status: 'ok' }))

const port = parseInt(process.env.PORT ?? '3001', 10)
console.log(`API running on http://localhost:${port}`)

export default {
  port,
  fetch: app.fetch,
}
