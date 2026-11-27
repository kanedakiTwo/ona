/**
 * The «Avisos» screen in Perfil (PRO-237, D-080; specs/notifications.md).
 * One row per alert kind: by where it arrives and a switch. The same list is
 * what Mimo reads and changes (`get_alerts` / `set_alerts`).
 */

/** Day-to-day alerts Mimo sends first (same keys as `whatsapp_links.prefs`). */
export const ALERT_KINDS = [
  'daily_brief',
  'cooking_reminder',
  'prep_alerts',
  'dinner_checkin',
  'shopping_reminder',
  'weekly_autoplan',
  'weekly_nudge',
  'freezer_review',
] as const
export type AlertKind = (typeof ALERT_KINDS)[number]

export const ALERT_LABELS: Record<AlertKind, { title: string; description: string }> = {
  daily_brief: { title: 'Menú del día', description: 'Lo que toca hoy, a la hora del desayuno.' },
  cooking_reminder: { title: 'Hora de empezar a cocinar', description: 'Solo si la cena lleva 40 minutos o más.' },
  prep_alerts: { title: 'Sacar del congelador y poner en remojo', description: 'Con tiempo, antes de cocinar.' },
  dinner_checkin: { title: '¿Hiciste la cena?', description: 'Un par de horas después de cenar, para apuntarlo.' },
  shopping_reminder: { title: '¿Toca compra?', description: 'Los sábados por la mañana, si te faltan cosas.' },
  weekly_autoplan: { title: 'La semana, hecha cada jueves', description: 'Los jueves, Mimo os deja lista la próxima; la cambiáis cuando queráis.' },
  weekly_nudge: { title: 'Domingo de planificar', description: 'Si la semana que viene aún no tiene menú.' },
  freezer_review: { title: 'Repaso del congelador', description: 'Una vez al mes, lo que lleva tiempo congelado.' },
}

/**
 * Kinds that only go to whoever asks for them (PRO-215, D-069: the morning
 * menu is off unless the person turned it on).
 */
export const ALERT_OPT_IN_KINDS: ReadonlySet<AlertKind> = new Set<AlertKind>(['daily_brief'])

/** Where one kind arrives today (`app`: in the menu, no message; PRO-381). */
export type AlertChannel = 'whatsapp' | 'push' | 'email' | 'app' | 'off'

/** PRO-381: with the Thursday week on, the Sunday question isn't needed. */
export const WEEKLY_NUDGE_AUTOPLAN_NOTE = 'No hace falta: Mimo os deja hecha la semana cada jueves.'

export interface AlertRow {
  kind: AlertKind
  title: string
  description: string
  /** The person's switch (missing = on, except the opt-in kinds). */
  on: boolean
  /** Where it arrives with the switch on and the current connections; 'off' when it can't. */
  channel: AlertChannel
  /** The phone notification stands in when WhatsApp can't (PRO-234). */
  fallback: 'push' | null
  /** Why it doesn't arrive, when on but `channel` is 'off'. */
  note: string | null
}

export interface AlertsOverview {
  whatsapp: { linked: boolean; notify: boolean }
  push: { subscribed: boolean }
  kinds: AlertRow[]
  /** PRO-1301: the household's time for the morning menu and the dinner question. */
  times: Record<AlertTimeKind, AlertTime>
}

/**
 * PRO-1301: the two avisos whose time each household can choose (Perfil →
 * Avisos and Mimo's `set_alert_time`). Saved per household
 * (`households.daily_brief_time` / `dinner_checkin_time`); none saved = the
 * time it always had (breakfast time; two hours after dinner).
 */
export const ALERT_TIME_KINDS = ['daily_brief', 'dinner_checkin'] as const
export type AlertTimeKind = (typeof ALERT_TIME_KINDS)[number]

export interface AlertTime {
  /** "HH:MM", Madrid wall clock: the one saved or, if none, today's default. */
  time: string
  /** The household chose it (false = the default). */
  custom: boolean
}

/** Earliest and latest time each one can be set to (inside 08:00–22:30, PRO-236). */
export const ALERT_TIME_RANGE: Record<AlertTimeKind, { min: string; max: string }> = {
  daily_brief: { min: '08:00', max: '13:00' },
  dinner_checkin: { min: '19:00', max: '22:00' },
}

export const DEFAULT_BREAKFAST_TIME = '09:00'
export const DEFAULT_DINNER_TIME = '21:00'

export function isAlertTimeKind(k: unknown): k is AlertTimeKind {
  return typeof k === 'string' && (ALERT_TIME_KINDS as readonly string[]).includes(k)
}

/** "9:30" / "09:30" / "21.00" → "09:30" / "21:00"; anything else → null. */
export function normalizeAlertTime(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const m = /^\s*([01]?\d|2[0-3])[:.h]([0-5]\d)\s*$/i.exec(input)
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))
const fromMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/** Why a time can't be saved for that aviso (in Spanish, to show or say), or null if it can. */
export function alertTimeError(kind: AlertTimeKind, time: string | null): string | null {
  if (!time) return 'Dime la hora como 08:30 o 21:15.'
  const { min, max } = ALERT_TIME_RANGE[kind]
  if (toMin(time) < toMin(min) || toMin(time) > toMin(max)) {
    return kind === 'daily_brief'
      ? `El menú del día puede llegar entre las ${min} y las ${max}.`
      : `La pregunta de la cena puede llegar entre las ${min} y las ${max} (más tarde no escribimos).`
  }
  return null
}

/**
 * Pure: the time each one goes today. Saved household time first; otherwise
 * the morning menu at breakfast time (default 09:00) and the dinner question
 * two hours after dinner (default 21:00), never after 22:00.
 */
export function resolveAlertTimes(input: {
  saved: Partial<Record<AlertTimeKind, string | null>>
  breakfast?: string | null
  dinner?: string | null
}): Record<AlertTimeKind, AlertTime> {
  const brief = normalizeAlertTime(input.saved.daily_brief)
  const checkin = normalizeAlertTime(input.saved.dinner_checkin)
  const breakfast = normalizeAlertTime(input.breakfast) ?? DEFAULT_BREAKFAST_TIME
  const dinner = normalizeAlertTime(input.dinner) ?? DEFAULT_DINNER_TIME
  return {
    daily_brief: brief ? { time: brief, custom: true } : { time: breakfast, custom: false },
    dinner_checkin: checkin ? { time: checkin, custom: true } : { time: fromMin(Math.min(toMin(dinner) + 120, 22 * 60)), custom: false },
  }
}

/**
 * PRO-381: the card on /menu after Mimo left next week done on Thursday
 * (`GET /menu/autoplan`). `null` when there is nothing to show.
 */
export interface AutoplanNotice {
  /** Monday of the week Mimo made (YYYY-MM-DD). */
  weekStart: string
  /** Its Sunday (YYYY-MM-DD). */
  weekEnd: string
  /** PRO-1337 (D-1029): one real dish of that week, so the card names it. */
  highlight?: AutoplanHighlight | null
}

/** PRO-1337: the dish the Thursday card names (`autoplanHighlightOf`). */
export interface AutoplanHighlight {
  /** 0 = Monday. */
  day: number
  meal: 'lunch' | 'dinner'
  recipeId: string
  name?: string
}

const AUTOPLAN_DAY_NAMES = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']

/**
 * Pure (PRO-1337, D-1029): the first dish of the week Mimo made — the first
 * day not skipped, its dinner before its lunch, a planned recipe (no táper,
 * no leftover, no dessert). Null when the week has none.
 */
export function autoplanHighlightOf(
  days: ReadonlyArray<Record<string, { dishes?: ReadonlyArray<Record<string, unknown>> } | undefined> | null | undefined>,
  skippedDays: readonly number[] = [],
): AutoplanHighlight | null {
  for (let day = 0; day < Math.min(days.length, 7); day++) {
    if (skippedDays.includes(day)) continue
    for (const meal of ['dinner', 'lunch'] as const) {
      const dish = (days[day]?.[meal]?.dishes ?? []).find(
        (d) => d.kind === 'recipe' && typeof d.recipeId === 'string' && (d.variant ?? 'planned') === 'planned' && d.course !== 'dessert',
      )
      if (dish) return { day, meal, recipeId: dish.recipeId as string, ...(typeof dish.recipeName === 'string' && dish.recipeName ? { name: dish.recipeName } : {}) }
    }
  }
  return null
}

/** Pure: «El lunes cenáis Lentejas estofadas.» / «El martes coméis …». Null without a name. */
export function autoplanHighlightLine(h: AutoplanHighlight | null | undefined): string | null {
  if (!h?.name) return null
  return `El ${AUTOPLAN_DAY_NAMES[h.day] ?? 'lunes'} ${h.meal === 'dinner' ? 'cenáis' : 'coméis'} ${h.name}.`
}

export function isAlertKind(k: unknown): k is AlertKind {
  return typeof k === 'string' && (ALERT_KINDS as readonly string[]).includes(k)
}

/**
 * Off if any store says off. Missing key = on, except the opt-in kinds
 * (`ALERT_OPT_IN_KINDS`), which need some store to say on.
 */
export function alertKindOn(kind: AlertKind, ...prefs: Array<Record<string, boolean> | null | undefined>): boolean {
  if (!prefs.every((p) => p?.[kind] !== false)) return false
  return ALERT_OPT_IN_KINDS.has(kind) ? prefs.some((p) => p?.[kind] === true) : true
}

/**
 * Pure: the screen's rows. WhatsApp linked with «avisos» on carries every
 * kind (the phone notification behind it); without it, only the prep alerts
 * go by the phone notification, and the rest doesn't go out.
 */
export function buildAlertRows(input: {
  userPrefs: Record<string, boolean> | null | undefined
  whatsapp: { linked: boolean; notify: boolean; prefs?: Record<string, boolean> | null }
  pushSubscribed: boolean
}): AlertRow[] {
  const waReady = input.whatsapp.linked && input.whatsapp.notify
  const isOn = (kind: AlertKind) => alertKindOn(kind, input.userPrefs, input.whatsapp.linked ? input.whatsapp.prefs : null)
  return ALERT_KINDS.map((kind) => {
    const on = isOn(kind)
    let channel: AlertChannel = 'off'
    let fallback: 'push' | null = null
    let note: string | null = null
    if (on) {
      if (kind === 'weekly_autoplan') {
        // PRO-381: the week itself, in the menu; it is not a message.
        channel = 'app'
      } else if (kind === 'weekly_nudge' && isOn('weekly_autoplan')) {
        note = WEEKLY_NUDGE_AUTOPLAN_NOTE
      } else if (waReady) {
        channel = 'whatsapp'
        fallback = input.pushSubscribed ? 'push' : null
      } else if (kind === 'prep_alerts' && input.pushSubscribed) {
        channel = 'push'
      } else if (kind === 'prep_alerts') {
        note = 'Conecta WhatsApp o activa las notificaciones del móvil.'
      } else {
        note = input.whatsapp.linked ? 'Activa los avisos por WhatsApp.' : 'Solo llega por WhatsApp.'
      }
    }
    return { kind, ...ALERT_LABELS[kind], on, channel, fallback, note }
  })
}
