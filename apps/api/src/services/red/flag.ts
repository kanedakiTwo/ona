/** The Red's switch (RED_TIENDAS_EMAILS): for everyone else nothing changes. */
import { eq } from 'drizzle-orm'
import { db as defaultDb } from '../../db/connection.js'
import { users } from '../../db/schema.js'
import { env } from '../../config/env.js'
import { isEmailAllowed } from '../emailAllowList.js'

type Db = typeof defaultDb

export function isRedAllowed(email: string | null | undefined, allowed: readonly string[] = env.RED_TIENDAS_EMAILS): boolean {
  return isEmailAllowed(email, allowed)
}

export async function redEnabledFor(userId: string, db: Pick<Db, 'select'> = defaultDb): Promise<boolean> {
  if (env.RED_TIENDAS_EMAILS.length === 0) return false
  const [row] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1)
  return isRedAllowed(row?.email)
}
