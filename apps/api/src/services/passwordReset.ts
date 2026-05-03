/**
 * Password-reset token mint + consume helpers.
 *
 * Tokens are opaque random strings (32 bytes hex). The admin generates one
 * via `POST /admin/users/:id/reset-password-token` and pastes the resulting
 * relative link to the user out-of-band. The user trades it in at
 * `/reset?token=...` (consumed by `POST /auth/reset`).
 *
 * Both helpers accept an optional Drizzle transaction client so the caller
 * can wrap the audit-log insert in the same tx.
 *
 * Spec: ../../../../specs/user-management.md
 */
import { randomBytes } from 'crypto'
import bcrypt from 'bcryptjs'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { db } from '../db/connection.js'
import { passwordResetTokens, users } from '../db/schema.js'

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000 // 24h

type DbOrTx = Pick<typeof db, 'insert' | 'select' | 'update'>

export interface MintedToken {
  /** Row id of the token (NOT the secret). Safe to log. */
  id: string
  /** The opaque secret; never logged in the audit payload. */
  token: string
  /** Relative link the admin pastes to the user. */
  link: string
  expiresAt: Date
}

export async function mintToken(
  userId: string,
  client: DbOrTx = db,
): Promise<MintedToken> {
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS)
  const [row] = await client
    .insert(passwordResetTokens)
    .values({ userId, token, expiresAt })
    .returning({ id: passwordResetTokens.id })
  if (!row?.id) {
    throw new Error('password_reset_tokens insert returned no id')
  }
  return {
    id: row.id,
    token,
    link: `/reset?token=${token}`,
    expiresAt,
  }
}

export interface ConsumedToken {
  userId: string
}

/**
 * Validate a token and update the target user's password. Throws an Error
 * with `code === 'TOKEN_INVALID'` if the token is missing, used, or expired.
 */
export async function consumeToken(
  token: string,
  newPassword: string,
  client: DbOrTx = db,
): Promise<ConsumedToken> {
  const now = new Date()
  const [row] = await client
    .select({
      id: passwordResetTokens.id,
      userId: passwordResetTokens.userId,
    })
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.token, token),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, now),
      ),
    )
    .limit(1)

  if (!row) {
    const err = new Error('Token inválido o caducado.') as Error & { code?: string }
    err.code = 'TOKEN_INVALID'
    throw err
  }

  const passwordHash = await bcrypt.hash(newPassword, 10)
  await client
    .update(users)
    .set({ passwordHash })
    .where(eq(users.id, row.userId))

  await client
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(eq(passwordResetTokens.id, row.id))

  return { userId: row.userId }
}
