/**
 * El editor de la newsletter en Admin (PRO-1123, D-176; specs/newsletter.md →
 * «Editor en Admin»).
 *
 *   - Marketing deja su recomendación de la semana (`PUT
 *     /admin/newsletter/drafts/:issueId/recommendation`, el mismo cuerpo que el
 *     envío: `{ subject, preheader?, content }`).
 *   - Miguel la corrige y la guarda como plantilla. Guardar borra la prueba y
 *     la programación anteriores: lo que se prueba es lo que sale.
 *   - «Enviarme la prueba» la manda al correo de su propia cuenta de admin,
 *     con su caso (su receta, su truco, su carta).
 *   - «Programar» la deja para el viernes a las 9:00 (Madrid) solo con la
 *     plantilla guardada esa semana y la prueba de esa plantilla. El programador
 *     (`runScheduledNewsletterIfDue`, cada tick) la envía una vez.
 *
 * Lo puro arriba (`draftReadiness`, `nextFridayNine`), Postgres en
 * `createDbNewsletterDraftsRepo`.
 */
import { and, eq, isNotNull, isNull, lte, sql } from 'drizzle-orm'
import { z } from 'zod'
import { env } from '../config/env.js'
import { db as defaultDb } from '../db/connection.js'
import { newsletterDrafts } from '../db/schema.js'
import { record as recordAudit } from './auditLog.js'
import { addDays, madridParts, madridWallTimeUtc } from './madridTime.js'
import {
  defaultNewsletterDeps,
  newsletterContentSchema,
  sendNewsletter,
  type NewsletterContent,
  type NewsletterDeps,
} from './newsletter.js'

type Db = typeof defaultDb

const DAY_MS = 24 * 60 * 60 * 1000

export const newsletterTemplateSchema = z.object({
  subject: z.string().trim().min(1).max(160),
  preheader: z.string().trim().max(200).optional(),
  content: newsletterContentSchema,
})
export type NewsletterTemplate = z.infer<typeof newsletterTemplateSchema>

export interface NewsletterDraft {
  issueId: string
  recommendation: NewsletterTemplate | null
  recommendedAt: Date | null
  template: NewsletterTemplate | null
  savedBy: string | null
  savedAt: Date | null
  proofSentAt: Date | null
  scheduledFor: Date | null
  scheduledBy: string | null
  apiUrl: string | null
  sentAt: Date | null
  sendResult: Record<string, number> | null
}

// ─── Reglas ──────────────────────────────────────────────────────

/** El viernes a las 9:00 de Madrid que toca: hoy si es viernes antes de las 9, si no el siguiente. */
export function nextFridayNine(now: Date): Date {
  const p = madridParts(now)
  const FRIDAY = 4
  let days = (FRIDAY - p.weekday + 7) % 7
  if (days === 0 && (p.hour > 9 || (p.hour === 9 && p.minute > 0))) days = 7
  return madridWallTimeUtc(addDays(p.isoDate, days), 9, 0)
}

export type NotReadyReason = 'sin_plantilla' | 'plantilla_antigua' | 'sin_prueba' | 'ya_enviada'

export const NOT_READY_MESSAGE: Record<NotReadyReason, string> = {
  sin_plantilla: 'Guarda antes la plantilla de este número.',
  plantilla_antigua: 'La plantilla es de hace más de una semana: revísala y guárdala otra vez.',
  sin_prueba: 'Mándate antes la prueba de la plantilla guardada.',
  ya_enviada: 'Este número ya ha salido.',
}

/**
 * Puro: ¿se puede programar (o enviar) para `at`? Hace falta la plantilla
 * guardada en los 7 días anteriores y la prueba de esa plantilla (después de
 * guardarla); y que no haya salido ya.
 */
export function draftReadiness(d: NewsletterDraft | null, at: Date): { ok: true } | { ok: false; reason: NotReadyReason } {
  if (d?.sentAt) return { ok: false, reason: 'ya_enviada' }
  if (!d?.template || !d.savedAt) return { ok: false, reason: 'sin_plantilla' }
  if (at.getTime() - d.savedAt.getTime() > 7 * DAY_MS) return { ok: false, reason: 'plantilla_antigua' }
  if (!d.proofSentAt || d.proofSentAt.getTime() < d.savedAt.getTime()) return { ok: false, reason: 'sin_prueba' }
  return { ok: true }
}

/** Puro: ¿es este contenido la plantilla guardada? (el envío a mano solo manda lo probado). */
export function sameTemplate(a: NewsletterTemplate, b: { subject: string; preheader?: string; content: NewsletterContent }): boolean {
  const norm = (t: { subject: string; preheader?: string; content: NewsletterContent }) =>
    JSON.stringify(newsletterTemplateSchema.parse({ subject: t.subject, preheader: t.preheader, content: t.content }))
  return norm(a) === norm(b)
}

// ─── Repo ────────────────────────────────────────────────────────

export interface NewsletterDraftsRepo {
  get(issueId: string): Promise<NewsletterDraft | null>
  /** Los últimos números, el más reciente primero. */
  list(limit: number): Promise<NewsletterDraft[]>
  saveRecommendation(issueId: string, rec: NewsletterTemplate, now: Date): Promise<NewsletterDraft>
  /** Guarda la plantilla; borra la prueba y la programación. null si ya salió. */
  saveTemplate(issueId: string, tpl: NewsletterTemplate, adminId: string, now: Date): Promise<NewsletterDraft | null>
  /** La prueba de la plantilla guardada en `savedAt` (si se guardó otra entre medias, no cuenta). */
  markProof(issueId: string, savedAt: Date, now: Date): Promise<void>
  schedule(issueId: string, at: Date, adminId: string, apiUrl: string): Promise<NewsletterDraft | null>
  unschedule(issueId: string): Promise<NewsletterDraft | null>
  /** Los programados que ya tocan y no han salido. */
  due(now: Date): Promise<NewsletterDraft[]>
  /** Reclama el envío (una vez): true si esta llamada lo ha reclamado. */
  claimSend(issueId: string, now: Date): Promise<boolean>
  /** Suelta el reclamo de un envío que ha fallado. */
  releaseSend(issueId: string): Promise<void>
  recordResult(issueId: string, result: Record<string, number>): Promise<void>
}

type Row = typeof newsletterDrafts.$inferSelect

function fromRow(r: Row): NewsletterDraft {
  return {
    issueId: r.issueId,
    recommendation: (r.recommendation as NewsletterTemplate | null) ?? null,
    recommendedAt: r.recommendedAt,
    template: (r.template as NewsletterTemplate | null) ?? null,
    savedBy: r.savedBy,
    savedAt: r.savedAt,
    proofSentAt: r.proofSentAt,
    scheduledFor: r.scheduledFor,
    scheduledBy: r.scheduledBy,
    apiUrl: r.apiUrl,
    sentAt: r.sentAt,
    sendResult: (r.sendResult as Record<string, number> | null) ?? null,
  }
}

export function createDbNewsletterDraftsRepo(db: Db = defaultDb): NewsletterDraftsRepo {
  const get = async (issueId: string) => {
    const [r] = await db.select().from(newsletterDrafts).where(eq(newsletterDrafts.issueId, issueId)).limit(1)
    return r ? fromRow(r) : null
  }
  return {
    get,
    async list(limit) {
      const rows = await db.select().from(newsletterDrafts).orderBy(sql`${newsletterDrafts.issueId} desc`).limit(limit)
      return rows.map(fromRow)
    },
    async saveRecommendation(issueId, rec, now) {
      const [r] = await db
        .insert(newsletterDrafts)
        .values({ issueId, recommendation: rec, recommendedAt: now })
        .onConflictDoUpdate({ target: newsletterDrafts.issueId, set: { recommendation: rec, recommendedAt: now, updatedAt: now } })
        .returning()
      return fromRow(r)
    },
    async saveTemplate(issueId, tpl, adminId, now) {
      const current = await get(issueId)
      if (current?.sentAt) return null
      const set = { template: tpl, savedBy: adminId, savedAt: now, proofSentAt: null, scheduledFor: null, scheduledBy: null, updatedAt: now }
      const [r] = await db
        .insert(newsletterDrafts)
        .values({ issueId, ...set })
        .onConflictDoUpdate({ target: newsletterDrafts.issueId, set, where: isNull(newsletterDrafts.sentAt) })
        .returning()
      return r ? fromRow(r) : null
    },
    async markProof(issueId, savedAt, now) {
      await db
        .update(newsletterDrafts)
        .set({ proofSentAt: now, updatedAt: now })
        .where(and(eq(newsletterDrafts.issueId, issueId), eq(newsletterDrafts.savedAt, savedAt)))
    },
    async schedule(issueId, at, adminId, apiUrl) {
      const [r] = await db
        .update(newsletterDrafts)
        .set({ scheduledFor: at, scheduledBy: adminId, apiUrl, updatedAt: new Date() })
        .where(and(eq(newsletterDrafts.issueId, issueId), isNull(newsletterDrafts.sentAt)))
        .returning()
      return r ? fromRow(r) : null
    },
    async unschedule(issueId) {
      const [r] = await db
        .update(newsletterDrafts)
        .set({ scheduledFor: null, scheduledBy: null, updatedAt: new Date() })
        .where(and(eq(newsletterDrafts.issueId, issueId), isNull(newsletterDrafts.sentAt)))
        .returning()
      return r ? fromRow(r) : null
    },
    async due(now) {
      const rows = await db
        .select()
        .from(newsletterDrafts)
        .where(and(isNotNull(newsletterDrafts.scheduledFor), lte(newsletterDrafts.scheduledFor, now), isNull(newsletterDrafts.sentAt)))
      return rows.map(fromRow)
    },
    async claimSend(issueId, now) {
      const rows = await db
        .update(newsletterDrafts)
        .set({ sentAt: now, updatedAt: now })
        .where(and(eq(newsletterDrafts.issueId, issueId), isNull(newsletterDrafts.sentAt)))
        .returning({ id: newsletterDrafts.issueId })
      return rows.length > 0
    },
    async releaseSend(issueId) {
      await db.update(newsletterDrafts).set({ sentAt: null, updatedAt: new Date() }).where(eq(newsletterDrafts.issueId, issueId))
    },
    async recordResult(issueId, result) {
      await db.update(newsletterDrafts).set({ sendResult: result, updatedAt: new Date() }).where(eq(newsletterDrafts.issueId, issueId))
    },
  }
}

// ─── El envío programado ─────────────────────────────────────────

export interface ScheduledSendDeps {
  drafts: NewsletterDraftsRepo
  send: typeof sendNewsletter
  makeDeps: (urls: { publicUrl: string; apiUrl: string }) => NewsletterDeps
  audit: typeof recordAudit
  publicUrl: string
}

function defaultScheduledDeps(): ScheduledSendDeps {
  return {
    drafts: createDbNewsletterDraftsRepo(),
    send: sendNewsletter,
    makeDeps: defaultNewsletterDeps,
    audit: recordAudit,
    publicUrl: env.WEB_PUBLIC_URL,
  }
}

/**
 * Cada tick del programador: los números programados que ya tocan salen una
 * vez (reclamados en `sent_at`). Uno que ya no cumple (la plantilla cambió sin
 * prueba, o es antigua) no sale y se desprograma. Si el envío falla, se suelta
 * para el siguiente tick: el envío no repite a nadie (`newsletter_sends`).
 */
export async function runScheduledNewsletterIfDue(now: Date, deps: ScheduledSendDeps = defaultScheduledDeps()): Promise<Array<{ issueId: string; sent?: number; skipped?: NotReadyReason }>> {
  const out: Array<{ issueId: string; sent?: number; skipped?: NotReadyReason }> = []
  for (const d of await deps.drafts.due(now)) {
    const ready = draftReadiness(d, d.scheduledFor ?? now)
    if (!ready.ok) {
      await deps.drafts.unschedule(d.issueId)
      console.warn(`[newsletter] ${d.issueId} not sent at its time: ${ready.reason}`)
      out.push({ issueId: d.issueId, skipped: ready.reason })
      continue
    }
    if (!(await deps.drafts.claimSend(d.issueId, now))) continue
    try {
      const outcome = await deps.send(
        { issueId: d.issueId, ...d.template! },
        deps.makeDeps({ publicUrl: deps.publicUrl, apiUrl: d.apiUrl ?? deps.publicUrl }),
      )
      if (outcome.mode !== 'send') continue
      const result = { sent: outcome.sent, failed: outcome.failed, skipped: outcome.skipped, alreadySent: outcome.alreadySent }
      await deps.drafts.recordResult(d.issueId, result)
      if (d.scheduledBy) {
        await deps.audit({
          adminId: d.scheduledBy,
          action: 'newsletter.send',
          targetType: 'newsletter_issue',
          payload: { issueId: d.issueId, sent: outcome.sent, failed: outcome.failed, skipped: outcome.skipped, scheduled: true },
        })
      }
      out.push({ issueId: d.issueId, sent: outcome.sent })
    } catch (err: any) {
      console.error(`[newsletter] scheduled ${d.issueId} failed (retried next tick):`, err?.message ?? err)
      await deps.drafts.releaseSend(d.issueId)
    }
  }
  return out
}
