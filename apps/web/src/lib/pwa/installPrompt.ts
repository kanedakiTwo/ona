// localStorage keys
const KEY_VISITS = "ona-pwa-visits"
const KEY_MENU_VISITS = "ona-pwa-menu-visits"
const KEY_DISMISSED_UNTIL = "ona-pwa-dismissed-until"

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

let stashedPrompt: BeforeInstallPromptEvent | null = null
let listenerAttached = false

function attachListener() {
  if (listenerAttached || typeof window === "undefined") return
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault()
    stashedPrompt = e as BeforeInstallPromptEvent
  })
  listenerAttached = true
}

// Call once on app load (e.g., in layout.tsx via useEffect)
export function recordVisit() {
  if (typeof window === "undefined") return
  attachListener()
  const current = Number(localStorage.getItem(KEY_VISITS) ?? "0")
  localStorage.setItem(KEY_VISITS, String(current + 1))
}

// Call when /menu is reached
export function recordMenuVisit() {
  if (typeof window === "undefined") return
  const current = Number(localStorage.getItem(KEY_MENU_VISITS) ?? "0")
  localStorage.setItem(KEY_MENU_VISITS, String(current + 1))
}

export interface InstallPromptState {
  visits: number
  menuVisits: number
  dismissedUntil: number
  isStandalone: boolean
  isIOS: boolean
  hasNativePrompt: boolean
  shouldShow: boolean
}

export function getInstallPromptState(): InstallPromptState {
  if (typeof window === "undefined") {
    return {
      visits: 0,
      menuVisits: 0,
      dismissedUntil: 0,
      isStandalone: false,
      isIOS: false,
      hasNativePrompt: false,
      shouldShow: false,
    }
  }
  const visits = Number(localStorage.getItem(KEY_VISITS) ?? "0")
  const menuVisits = Number(localStorage.getItem(KEY_MENU_VISITS) ?? "0")
  const dismissedUntil = Number(localStorage.getItem(KEY_DISMISSED_UNTIL) ?? "0")
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent)
  const hasNativePrompt = stashedPrompt !== null
  const meetsThreshold = visits >= 3 || menuVisits >= 2
  const notDismissed = Date.now() >= dismissedUntil
  const canPrompt = hasNativePrompt || (isIOS && !isStandalone)
  const shouldShow = !isStandalone && meetsThreshold && notDismissed && canPrompt
  return { visits, menuVisits, dismissedUntil, isStandalone, isIOS, hasNativePrompt, shouldShow }
}

export async function triggerInstall(): Promise<{ outcome: "accepted" | "dismissed" | "unavailable" }> {
  if (!stashedPrompt) return { outcome: "unavailable" }
  await stashedPrompt.prompt()
  const choice = await stashedPrompt.userChoice
  stashedPrompt = null
  return { outcome: choice.outcome }
}

export function dismissForDays(days: number) {
  if (typeof window === "undefined") return
  const until = Date.now() + days * 24 * 60 * 60 * 1000
  localStorage.setItem(KEY_DISMISSED_UNTIL, String(until))
}
