/**
 * PRO-205: the one-off notice to the households «Afina tu menú» may have
 * shown a dish that broke their allergies or diet (PRO-197; Miguel,
 * `/ona-dia` 2026-10-18: «aviso por WhatsApp automático a los que lo usen y a
 * los que no, por la app; nada de aviso manual»). Spec: specs/taste.md →
 * «Aviso a los hogares afectados».
 *
 * - **Who**: households with a verdict given before the fix (`recipe_verdicts.created_at`
 *   earlier than the scan) and allergies, intolerances or a diet on some
 *   member (profile `users.restrictions` or memory `restrictions`). Computed
 *   once, on the server, the first time this version runs against a database
 *   (the scan marker: a `household_notices` row with no household, whose
 *   `created_at` is the cutoff). Ships in the same version as the fix, so it
 *   goes out where the fix is live: staging when it reaches staging (where it
 *   can be checked), production when it's published; each database once.
 * - **How**: a member with WhatsApp connected gets it from Mimo, only inside
 *   the 24 h window (no approved template for it): if the window is closed it
 *   goes the next time they write. After 3 days without it going out, it also
 *   shows in the app. Without WhatsApp, straight to the app: a card on /menu
 *   until someone in the household closes it.
 * - Never twice: one row per (key, household); WhatsApp claimed before sending.
 * - Runs by itself only on a deployed API (`isDeployedRuntime`: staging and
 *   production), never in CI or locally; `AFINA_NOTICE=off` stops it (nothing
 *   needs setting for it to run).
 */
import { and, eq, isNull, isNotNull, sql } from 'drizzle-orm'
import { db as defaultDb } from '../db/connection.js'
import { householdNotices, users } from '../db/schema.js'
import type { ChannelOutcome } from './whatsapp/proactive.js'
import { isDeployedRuntime } from '../config/jwtSecret.js'

type Db = typeof defaultDb

export const AFINA_NOTICE_KEY = 'afina_restricciones_2026_10'
export const AFINA_NOTICE_WHATSAPP_DAYS = 3
const DAY = 86_400_000

/** Legal's text (2026-10-18). Not to be changed without Legal. */
export const AFINA_NOTICE_TEXT =
  '¡Hola! Un aviso rápido: si usaste «Afina tu menú» estos días, puede que te enseñara algún plato que no encaja con lo que nos dijiste (alergias o cosas que no coméis en casa). Era un fallo de esa pantalla y ya está arreglado. El menú de la semana se hace con las alergias y la dieta que tienes en tu perfil: échales un vistazo en Perfil para comprobar que está todo. Si le diste «Me apetece» a algo que no podéis comer, díselo a Mimo o quítalo en Perfil → «Lo que recuerdo de ti» (o dímelo y te ayudo). Perdona el lío, y gracias por estar en la prueba: para esto sirve.'

export interface NoticeRow {
  id: string
  householdId: string
  userId: string | null
  createdAt: Date
  whatsappSentAt: Date | null
  appSince: Date | null
  dismissedAt: Date | null
}

/** Pure: does the card show in the app? */
export function noticeVisibleInApp(row: Pick<NoticeRow, 'userId' | 'createdAt' | 'whatsappSentAt' | 'appSince' | 'dismissedAt'>, now: Date): boolean {
  if (row.dismissedAt) return false
  if (row.appSince || !row.userId) return true
  return !row.whatsappSentAt && now.getTime() - row.createdAt.getTime() >= AFINA_NOTICE_WHATSAPP_DAYS * DAY
}

export interface NoticeRepo {
  /** Once per key: true when this call did the scan (and wrote the rows). */
  scan(key: string, now: Date): Promise<boolean>
  /** Rows still to try on WhatsApp (recipient set, not sent, not closed). */
  pendingWhatsApp(key: string): Promise<NoticeRow[]>
  claimWhatsApp(id: string, at: Date): Promise<boolean>
  unclaimWhatsApp(id: string): Promise<void>
  /** Rows past the WhatsApp days with nothing sent: show them in the app from now. */
  openInApp(key: string, now: Date): Promise<number>
}

export interface NoticeDeps {
  repo: NoticeRepo
  /** Mimo on WhatsApp, inside the 24 h window only. */
  sendWhatsApp: (userId: string, text: string, now: Date) => Promise<ChannelOutcome>
}

/** One pass: scan (first time only), WhatsApp where the window is open, app after 3 days. */
export async function runAfinaNotice(now: Date, deps: NoticeDeps, key = AFINA_NOTICE_KEY) {
  const out = { scanned: false, whatsapp: 0, toApp: 0 }
  out.scanned = await deps.repo.scan(key, now)
  for (const row of await deps.repo.pendingWhatsApp(key)) {
    if (!row.userId) continue
    if (!(await deps.repo.claimWhatsApp(row.id, now))) continue
    let wa: ChannelOutcome = { status: 'skipped' }
    try {
      wa = await deps.sendWhatsApp(row.userId, AFINA_NOTICE_TEXT, now)
    } catch (err) {
      console.error('[afina-notice] whatsapp failed:', err)
    }
    if (wa.status === 'ok') out.whatsapp += 1
    else await deps.repo.unclaimWhatsApp(row.id)
  }
  out.toApp = await deps.repo.openInApp(key, now)
  return out
}

export function createDbNoticeRepo(db: Db = defaultDb): NoticeRepo {
  return {
    async scan(key, now) {
      return db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`household_notices:${key}`}))`)
        const [marker] = await tx
          .select({ id: householdNotices.id })
          .from(householdNotices)
          .where(and(eq(householdNotices.key, key), isNull(householdNotices.householdId)))
          .limit(1)
        if (marker) return false
        const cutoff = now.toISOString()
        await tx.insert(householdNotices).values({ key, householdId: null, createdAt: now })
        // Households with a verdict before the cutoff and a restriction on some
        // member; the WhatsApp recipient: a member with WhatsApp who accepts
        // messages, the ones who rated first, then the owner.
        await tx.execute(sql`
          INSERT INTO household_notices (key, household_id, user_id, created_at, app_since)
          SELECT ${key}, c.household_id, c.wa_user, ${cutoff}::timestamptz,
                 CASE WHEN c.wa_user IS NULL THEN ${cutoff}::timestamptz END
          FROM (
            SELECT h.id AS household_id,
              (SELECT wl.user_id
                 FROM household_members m2
                 JOIN whatsapp_links wl ON wl.user_id = m2.user_id
                 JOIN users u2 ON u2.id = m2.user_id
                WHERE m2.household_id = h.id AND wl.notify AND u2.suspended_at IS NULL
                ORDER BY EXISTS (SELECT 1 FROM recipe_verdicts v2 WHERE v2.user_id = m2.user_id) DESC,
                         (m2.role = 'owner') DESC, m2.joined_at
                LIMIT 1) AS wa_user
            FROM households h
            WHERE EXISTS (
                SELECT 1 FROM household_members m JOIN recipe_verdicts v ON v.user_id = m.user_id
                 WHERE m.household_id = h.id AND v.created_at < ${cutoff}::timestamptz)
              AND EXISTS (
                SELECT 1 FROM household_members m
                  JOIN users u ON u.id = m.user_id
                  LEFT JOIN user_memories um ON um.user_id = m.user_id AND um.key = 'restrictions'
                 WHERE m.household_id = h.id
                   AND (COALESCE(cardinality(u.restrictions), 0) > 0
                        OR (jsonb_typeof(um.value) = 'array' AND jsonb_array_length(um.value) > 0)))
          ) c
          ON CONFLICT (key, household_id) DO NOTHING
        `)
        return true
      })
    },
    async pendingWhatsApp(key) {
      const rows = await db
        .select()
        .from(householdNotices)
        .where(
          and(
            eq(householdNotices.key, key),
            isNotNull(householdNotices.householdId),
            isNotNull(householdNotices.userId),
            isNull(householdNotices.whatsappSentAt),
            isNull(householdNotices.dismissedAt),
          ),
        )
      return rows as NoticeRow[]
    },
    async claimWhatsApp(id, at) {
      const r = await db
        .update(householdNotices)
        .set({ whatsappSentAt: at })
        .where(and(eq(householdNotices.id, id), isNull(householdNotices.whatsappSentAt)))
        .returning({ id: householdNotices.id })
      return r.length > 0
    },
    async unclaimWhatsApp(id) {
      await db.update(householdNotices).set({ whatsappSentAt: null }).where(eq(householdNotices.id, id))
    },
    async openInApp(key, now) {
      const before = new Date(now.getTime() - AFINA_NOTICE_WHATSAPP_DAYS * DAY)
      const r = await db
        .update(householdNotices)
        .set({ appSince: now })
        .where(
          and(
            eq(householdNotices.key, key),
            isNotNull(householdNotices.householdId),
            isNull(householdNotices.appSince),
            isNull(householdNotices.whatsappSentAt),
            sql`${householdNotices.createdAt} <= ${before.toISOString()}::timestamptz`,
          ),
        )
        .returning({ id: householdNotices.id })
      return r.length
    },
  }
}

/** The caller's household notice, for the app card. */
export async function noticeForUser(userId: string, now: Date = new Date(), key = AFINA_NOTICE_KEY, db: Db = defaultDb) {
  const [u] = await db.select({ householdId: users.primaryHouseholdId }).from(users).where(eq(users.id, userId)).limit(1)
  if (!u?.householdId) return null
  const [row] = await db
    .select()
    .from(householdNotices)
    .where(and(eq(householdNotices.key, key), eq(householdNotices.householdId, u.householdId)))
    .limit(1)
  return row ? { row: row as NoticeRow, show: noticeVisibleInApp(row as NoticeRow, now) } : null
}

/** «Entendido»: closed for the whole household. */
export async function dismissNotice(userId: string, now: Date = new Date(), key = AFINA_NOTICE_KEY, db: Db = defaultDb): Promise<boolean> {
  const [u] = await db.select({ householdId: users.primaryHouseholdId }).from(users).where(eq(users.id, userId)).limit(1)
  if (!u?.householdId) return false
  const r = await db
    .update(householdNotices)
    .set({ dismissedAt: now })
    .where(and(eq(householdNotices.key, key), eq(householdNotices.householdId, u.householdId), isNull(householdNotices.dismissedAt)))
    .returning({ id: householdNotices.id })
  return r.length > 0
}

/** Aggregates only, for the brief: how many households and by which channel. */
export async function noticeStats(key = AFINA_NOTICE_KEY, db: Db = defaultDb) {
  const r = await db.execute(sql`
    SELECT
      MIN(created_at) FILTER (WHERE household_id IS NULL) AS "scannedAt",
      COUNT(*) FILTER (WHERE household_id IS NOT NULL)::int AS "households",
      COUNT(*) FILTER (WHERE whatsapp_sent_at IS NOT NULL)::int AS "whatsapp",
      COUNT(*) FILTER (WHERE household_id IS NOT NULL AND user_id IS NULL)::int AS "appOnly",
      COUNT(*) FILTER (WHERE household_id IS NOT NULL AND user_id IS NOT NULL AND whatsapp_sent_at IS NULL)::int AS "whatsappPending",
      COUNT(*) FILTER (WHERE app_since IS NOT NULL)::int AS "inApp",
      COUNT(*) FILTER (WHERE dismissed_at IS NOT NULL)::int AS "dismissed"
    FROM household_notices WHERE key = ${key}
  `)
  return r.rows[0] as {
    scannedAt: string | null
    households: number
    whatsapp: number
    appOnly: number
    whatsappPending: number
    inApp: number
    dismissed: number
  }
}

let timer: NodeJS.Timeout | null = null
let running = false

/** Pure: only a deployed API (staging or production) runs it on its own, never CI or a laptop; `AFINA_NOTICE=off` stops it. */
export function afinaNoticeEnabled(e: NodeJS.ProcessEnv = process.env): boolean {
  return e.AFINA_NOTICE !== 'off' && !e.VITEST && isDeployedRuntime(e)
}

/** From boot: a first pass after 30 s, then every 10 minutes (see `afinaNoticeEnabled`). */
export function startAfinaNotice(): void {
  if (timer || !afinaNoticeEnabled()) return
  const tick = async () => {
    if (running) return
    running = true
    try {
      const { sendInsideServiceWindow } = await import('./whatsapp/outbound.js')
      const r = await runAfinaNotice(new Date(), {
        repo: createDbNoticeRepo(),
        sendWhatsApp: (userId, text, at) => sendInsideServiceWindow(userId, text, 'afina_notice', at),
      })
      if (r.scanned || r.whatsapp || r.toApp) {
        const s = await noticeStats()
        console.log(`[afina-notice] ${s.households} hogares · WhatsApp ${s.whatsapp} enviados, ${s.whatsappPending} pendientes · app ${s.inApp} · cerrados ${s.dismissed}`)
      }
    } catch (err) {
      console.error('[afina-notice] run failed:', err)
    } finally {
      running = false
    }
  }
  setTimeout(() => void tick(), 30_000).unref?.()
  timer = setInterval(() => void tick(), 10 * 60_000)
  timer.unref?.()
}
