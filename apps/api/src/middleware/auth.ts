import { createMiddleware } from 'hono/factory'
import { apiErr } from '../types'

export const apiKeyMiddleware = createMiddleware(async (c, next) => {
  const requiredKey = process.env.TRACION_API_KEY
  // Dev mode: no auth if key is unset or empty
  if (!requiredKey) {
    return next()
  }
  const providedKey = c.req.header('X-Tracion-Api-Key')
  if (providedKey !== requiredKey) {
    return c.json(apiErr('UNAUTHORIZED', 'Invalid or missing API key'), 401)
  }
  return next()
})
