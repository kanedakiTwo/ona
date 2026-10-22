/**
 * «Afina tu menú» (specs/taste.md): pure bits of the swiper, tested in
 * apps/api/src/tests/tasteText.test.ts.
 */
import { prettyName, type TasteReason, type TasteVerdict } from "@ona/shared"

/** «No me gusta el atún» / «No me gustan las lentejas» (PRO-200: agreement and accents). */
export function dislikeChipText(label: string): string {
  const pretty = prettyName(label)
  return `${/^(los|las) /.test(pretty) ? "No me gustan" : "No me gusta"} ${pretty}`
}

/** Pure: which «No para mí» count for the meat/fish streak («Es muy largo» doesn't, PRO-200). */
export function nextStreak(current: number, verdict: TasteVerdict, reasonKind?: TasteReason["kind"] | null): number {
  if (verdict === "skip") return current
  if (verdict !== "nope") return 0
  return reasonKind === "long" ? current : current + 1
}

/**
 * What a swipe of (dx, dy) px on a card means (a beta tester, 2026-10-22: «la opción de me
 * encanta no funciona del todo bien; a mí me los ha descartado»). The side was checked
 * first, so swiping up with a thumb — which always drifts sideways, to the left with the
 * right hand — past 100 px turned «Me encanta» into «No para mí». Now the main direction
 * wins: mostly up is «Me encanta», mostly to a side is «Me apetece» or «No para mí».
 */
export function swipeVerdict(dx: number, dy: number): TasteVerdict | null {
  const up = -dy
  if (up > 90 && up >= Math.abs(dx)) return "love"
  if (Math.abs(dx) > 100 && Math.abs(dx) > up) return dx > 0 ? "like" : "nope"
  return null
}

/** How much of each stamp shows while dragging: only the main direction's. */
export function swipeStamps(dx: number, dy: number): { like: number; nope: number; love: number } {
  const up = Math.max(0, -dy)
  const clamp = (v: number) => Math.max(0, Math.min(1, v / 100))
  if (up >= Math.abs(dx)) return { like: 0, nope: 0, love: clamp(up) }
  return { like: dx > 0 ? clamp(dx) : 0, nope: dx < 0 ? clamp(-dx) : 0, love: 0 }
}
