import { api } from "@/lib/api"

/**
 * PRO-83 (specs/metrics.md "App instalada y avisos"): when Mimoia is opened as
 * an installed app (`display-mode: standalone`) by a signed-in user, tell the
 * API at most once a day per browser. The API keeps one event per household
 * and day, with only the device (android / ios / desktop) — deduced there from
 * the browser, never stored whole. Fire-and-forget: it never fails the app.
 */
const KEY_LAST_DAY = "ona-pwa-installed-open-day"

/** Pure: should this load report an installed open? */
export function shouldReportInstalledOpen(opts: {
  standalone: boolean
  signedIn: boolean
  lastReportedDay: string | null
  today: string
}): boolean {
  return opts.standalone && opts.signedIn && opts.lastReportedDay !== opts.today
}

function localDay(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function reportInstalledOpen(): void {
  try {
    if (typeof window === "undefined") return
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches === true ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true
    const today = localDay()
    if (
      !shouldReportInstalledOpen({
        standalone,
        signedIn: Boolean(localStorage.getItem("ona_token")),
        lastReportedDay: localStorage.getItem(KEY_LAST_DAY),
        today,
      })
    ) {
      return
    }
    api
      .post("/usage/app-opened")
      .then(() => {
        try {
          localStorage.setItem(KEY_LAST_DAY, today)
        } catch {
          /* storage blocked: we'll try again next load, the API dedupes */
        }
      })
      .catch(() => {})
  } catch {
    /* analytics never breaks the app */
  }
}
