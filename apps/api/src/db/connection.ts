import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { env } from '../config/env.js'
import * as schema from './schema.js'

const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
})

export const db = drizzle(pool, { schema })
export { pool }
