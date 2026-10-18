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
  'weekly_nudge',
] as const
export type AlertKind = (typeof ALERT_KINDS)[number]

export const ALERT_LABELS: Record<AlertKind, { title: string; description: string }> = {
  daily_brief: { title: 'Menú del día', description: 'Lo que toca hoy, a la hora del desayuno.' },
  cooking_reminder: { title: 'Hora de empezar a cocinar', description: 'Solo si la cena lleva 40 minutos o más.' },
  prep_alerts: { title: 'Sacar del congelador y poner en remojo', description: 'Con tiempo, antes de cocinar.' },
  dinner_checkin: { title: '¿Hiciste la cena?', description: 'Un par de horas después de cenar, para apuntarlo.' },
  shopping_reminder: { title: '¿Toca compra?', description: 'Los sábados por la mañana, si te faltan cosas.' },
  weekly_nudge: { title: 'Domingo de planificar', description: 'Si la semana que viene aún no tiene menú.' },
}

/** Where one kind arrives today. */
export type AlertChannel = 'whatsapp' | 'push' | 'email' | 'off'

export interface AlertRow {
  kind: AlertKind
  title: string
  description: string
  /** The person's switch (missing = on). */
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
}

export function isAlertKind(k: unknown): k is AlertKind {
  return typeof k === 'string' && (ALERT_KINDS as readonly string[]).includes(k)
}

/** Missing key = on; off if either store says off. */
export function alertKindOn(kind: AlertKind, ...prefs: Array<Record<string, boolean> | null | undefined>): boolean {
  return prefs.every((p) => p?.[kind] !== false)
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
  return ALERT_KINDS.map((kind) => {
    const on = alertKindOn(kind, input.userPrefs, input.whatsapp.linked ? input.whatsapp.prefs : null)
    let channel: AlertChannel = 'off'
    let fallback: 'push' | null = null
    let note: string | null = null
    if (on) {
      if (waReady) {
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
