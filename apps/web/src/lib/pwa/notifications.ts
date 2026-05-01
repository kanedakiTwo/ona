// Local meal-time notifications (client-side setTimeout, no Push API).
// MVP per specs/pwa.md: schedules the next 24h on every app open and re-arms
// in layout.tsx. State lives in localStorage; no API mutations.

const KEY_ENABLED = "ona-notifications-enabled"
const KEY_MEAL_TIMES = "ona-meal-times"

export type MealTimes = {
  breakfast: string // "HH:MM"
  lunch: string
  dinner: string
  snack: string
}

const DEFAULT_MEAL_TIMES: MealTimes = {
  breakfast: "08:00",
  lunch: "14:00",
  dinner: "21:00",
  snack: "17:00",
}

const MEAL_LABELS: Record<keyof MealTimes, string> = {
  breakfast: "Desayuno",
  lunch: "Comida",
  dinner: "Cena",
  snack: "Snack",
}

let scheduledTimers: ReturnType<typeof setTimeout>[] = []

export function getEnabled(): boolean {
  if (typeof window === "undefined") return false
  return localStorage.getItem(KEY_ENABLED) === "1"
}

export function setEnabled(value: boolean) {
  if (typeof window === "undefined") return
  localStorage.setItem(KEY_ENABLED, value ? "1" : "0")
}

export function getMealTimes(): MealTimes {
  if (typeof window === "undefined") return DEFAULT_MEAL_TIMES
  try {
    const raw = localStorage.getItem(KEY_MEAL_TIMES)
    if (!raw) return DEFAULT_MEAL_TIMES
    return { ...DEFAULT_MEAL_TIMES, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_MEAL_TIMES
  }
}

export function setMealTimes(times: Partial<MealTimes>) {
  if (typeof window === "undefined") return
  const current = getMealTimes()
  localStorage.setItem(KEY_MEAL_TIMES, JSON.stringify({ ...current, ...times }))
}

export async function requestPermission(): Promise<NotificationPermission> {
  if (typeof window === "undefined" || !("Notification" in window)) return "denied"
  if (Notification.permission === "granted") return "granted"
  if (Notification.permission === "denied") return "denied"
  try {
    return await Notification.requestPermission()
  } catch {
    return "denied"
  }
}

export function clearAllReminders() {
  for (const id of scheduledTimers) clearTimeout(id)
  scheduledTimers = []
}

function nextOccurrenceMs(hhmm: string): number {
  // "HH:MM" -> ms epoch of next occurrence (today if future, else tomorrow).
  const [h, m] = hhmm.split(":").map(Number)
  const now = new Date()
  const target = new Date(now)
  target.setHours(h, m, 0, 0)
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1)
  }
  return target.getTime()
}

export function scheduleMealReminders(times: MealTimes = getMealTimes()) {
  if (typeof window === "undefined") return
  if (!("Notification" in window) || Notification.permission !== "granted") return
  if (!getEnabled()) return

  clearAllReminders()
  const now = Date.now()
  const horizon = now + 24 * 60 * 60 * 1000

  for (const [meal, time] of Object.entries(times) as [keyof MealTimes, string][]) {
    const fireAt = nextOccurrenceMs(time)
    if (fireAt > horizon) continue
    const delay = fireAt - now
    const id = setTimeout(() => fireMealReminder(meal), delay)
    scheduledTimers.push(id)
  }
}

function fireMealReminder(meal: keyof MealTimes) {
  if (typeof window === "undefined" || !("Notification" in window)) return
  if (Notification.permission !== "granted") return

  const label = MEAL_LABELS[meal]
  const n = new Notification(`Es hora de ${label.toLowerCase()}`, {
    body: "Abre tu menu para ver que toca cocinar.",
    icon: "/icons/icon-192.png",
    tag: `ona-meal-${meal}`,
  })
  n.onclick = () => {
    window.focus()
    window.open("/menu", "_self")
    n.close()
  }
}
