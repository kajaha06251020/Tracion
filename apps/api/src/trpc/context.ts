import type { DB } from '../db/index'
import type { auth } from '../auth/index'

type AuthUser = typeof auth.$Infer.Session.user

export type Context = {
  db: DB
  user: AuthUser | null
}
