import { env } from '../config/env.js'

/**
 * The role an account gets from `ADMIN_EMAILS` on every login (PRO-1271).
 * Exact match on the stored email: `ADMIN_EMAILS` is lowercased and new
 * accounts are stored lowercased, so an account whose email differs from a
 * listed one only in its capitals never becomes admin.
 */
export function roleForEmail(email: string, admins: readonly string[] = env.ADMIN_EMAILS): 'admin' | 'user' {
  return admins.includes(email) ? 'admin' : 'user'
}
