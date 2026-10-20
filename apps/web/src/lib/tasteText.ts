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
