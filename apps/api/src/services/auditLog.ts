/**
 * Append-only admin audit log.
 *
 * Every successful admin mutation calls `record(...)`. The insert is
 * synchronous and throws on failure — callers wrap their work in a
 * transaction so an audit failure rolls back the mutation. Per spec
 * (`admin-audit-log.md`): "we'd rather refuse a mutation than silently
 * lose its trail."
 */
import { db } from '../db/connection.js'
import { adminAuditLog } from '../db/schema.js'

/**
 * Stable action codes. Add new codes; never rename old ones (renames break
 * filter URLs and existing rows).
 */
export type AdminAction =
  | 'ingredient.create'
  | 'ingredient.update'
  | 'ingredient.remap'
  | 'ingredient.estimate_nutrition'
  | 'recipe.update'
  | 'recipe.delete'
  | 'user.suspend'
  | 'user.unsuspend'
  | 'user.reset_password.generate'

export type AuditTargetType = 'ingredient' | 'recipe' | 'user'

export interface AuditRecord {
  adminId: string
  action: AdminAction
  targetType: AuditTargetType
  /** Row id of the target. Null for cross-cutting actions. */
  targetId?: string | null
  /** Free-form JSONB. By convention: `{ before, after }` for updates,
   *  `{ created }` for creates, `{ deleted }` for deletes,
   *  `{ token_id, expires_at }` for token issuance. Never the secret itself. */
  payload?: Record<string, unknown>
}

/**
 * Insert a row into `admin_audit_log`. Returns the inserted id.
 *
 * Throws on insert failure. Callers MUST be inside a DB transaction so an
 * audit failure rolls back the mutation it was tracking.
 */
export async function record(input: AuditRecord): Promise<string> {
  const [row] = await db
    .insert(adminAuditLog)
    .values({
      adminId: input.adminId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      payload: input.payload ?? {},
    })
    .returning({ id: adminAuditLog.id })
  if (!row?.id) {
    throw new Error('admin_audit_log insert returned no id')
  }
  return row.id
}

/**
 * Diff helper: given before/after objects of arbitrary shape, return only the
 * keys that changed, with both sides for the audit payload. Useful when only
 * a couple of columns moved on a PATCH and we don't want the full row in the
 * log.
 */
export function diff<T extends Record<string, unknown>>(
  before: T,
  after: T,
): { before: Partial<T>; after: Partial<T> } {
  const b: Partial<T> = {}
  const a: Partial<T> = {}
  const keys = new Set<keyof T>([
    ...(Object.keys(before) as (keyof T)[]),
    ...(Object.keys(after) as (keyof T)[]),
  ])
  for (const k of keys) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
      b[k] = before[k]
      a[k] = after[k]
    }
  }
  return { before: b, after: a }
}
