import { db } from '../db/index'
import type { DB } from '../db/index'

export type Context = {
  db: DB
}

export function createContext(): Context {
  return { db }
}
