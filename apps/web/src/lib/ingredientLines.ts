/**
 * The ingredients box of the recipe forms (PRO-1115): one ingredient per
 * line, read with `parseIngredientText` (@ona/shared, no AI) and checked
 * against the library by the API (`POST /ingredients/match-lines`).
 *
 * A line that is exactly the text of a saved row (the editor writes the
 * saved rows as text) keeps that row as it is, so opening the editor and
 * saving without touching anything doesn't change the recipe. Any other
 * line becomes a row from what it says; the ones marked «nuevo» are created
 * when saving (`POST /ingredients/ensure`, like the imports).
 */
import {
  foldIngredientName,
  formatIngredientLine,
  formatLineQuantity,
  ingredientLineToRow,
  parseIngredientText,
  type IngredientLineAmount,
  type ParsedIngredientLine,
} from "@ona/shared"

export interface LibraryEntry {
  id: string
  name: string
}

/** The API's answer for one name (apps/api/src/services/ingredientLineMatch.ts). */
export type LineMatch =
  | { status: "match"; ingredient: LibraryEntry }
  | { status: "doubt"; candidates: LibraryEntry[]; fallback: "first" | "new" }
  | { status: "new" }

/** What the user picked under a «¿cuál?»: an entry, or «nuevo». */
export type LineChoice = LibraryEntry | "new"

/** A row as the recipe stores it (and as the API returns it). */
export interface SavedIngredientRow {
  ingredientId: string
  ingredientName: string
  quantity: number
  unit: string
  optional?: boolean
  note?: string | null
  section?: string | null
  displayQuantity?: number | null
  displayUnit?: string | null
}

export type LineState =
  | { kind: "loading" }
  | { kind: "match"; ingredient: LibraryEntry }
  | { kind: "doubt"; candidates: LibraryEntry[]; fallback: "first" | "new" }
  | { kind: "new" }

export interface IngredientLineView {
  line: string
  section: string | null
  parsed: ParsedIngredientLine
  amount: IngredientLineAmount
  /** The folded name: the key of matches and choices. */
  nameKey: string
  /** The saved row this line is, untouched. */
  saved: SavedIngredientRow | null
  state: LineState
  choice: LineChoice | null
  /** The «¿cuál?» buttons, kept once answered so the pick can change. */
  doubt: LibraryEntry[] | null
}

export function nameKey(name: string): string {
  return foldIngredientName(name)
}

export function savedRowLine(row: SavedIngredientRow): string {
  return formatIngredientLine({ ...row, note: row.note ?? undefined })
}

/** «200 g», «2 cucharadas», «1», «al gusto»: the amount as the line says it. */
export function amountLabel(parsed: ParsedIngredientLine): string {
  if (parsed.unit === "al gusto" || (parsed.quantity == null && parsed.unit == null)) return "al gusto"
  const metric = ["g", "kg", "mg", "ml", "cl", "dl", "l"].includes(parsed.unit ?? "")
  const q = parsed.quantity == null ? "1" : formatLineQuantity(parsed.quantity, !metric)
  return parsed.unit == null ? q : `${q} ${parsed.unitText ?? parsed.unit}`
}

function stateOf(match: LineMatch | undefined, choice: LineChoice | null): LineState {
  if (!match) return { kind: "loading" }
  if (choice === "new") return { kind: "new" }
  if (choice) return { kind: "match", ingredient: choice }
  if (match.status === "match") return { kind: "match", ingredient: match.ingredient }
  if (match.status === "doubt") return { kind: "doubt", candidates: match.candidates, fallback: match.fallback }
  return { kind: "new" }
}

export function ingredientLineViews(
  text: string,
  saved: readonly SavedIngredientRow[],
  matches: Readonly<Record<string, LineMatch>>,
  choices: Readonly<Record<string, LineChoice>>,
): IngredientLineView[] {
  const pool = saved.map((row) => ({ line: savedRowLine(row), section: row.section ?? null, row, used: false }))
  return parseIngredientText(text).map(({ line, section, parsed }) => {
    const hit = pool.find((p) => !p.used && p.line === line && p.section === section)
    if (hit) hit.used = true
    const key = nameKey(parsed.name)
    const choice = choices[key] ?? null
    return {
      line,
      section,
      parsed,
      amount: ingredientLineToRow(parsed),
      nameKey: key,
      saved: hit?.row ?? null,
      state: hit
        ? { kind: "match", ingredient: { id: hit.row.ingredientId, name: hit.row.ingredientName } }
        : stateOf(matches[key], choice),
      choice,
      doubt: !hit && matches[key]?.status === "doubt" ? (matches[key] as Extract<LineMatch, { status: "doubt" }>).candidates : null,
    }
  })
}

/** The names the API still has to look at. */
export function namesToMatch(views: readonly IngredientLineView[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of views) {
    if (v.saved || seen.has(v.nameKey)) continue
    seen.add(v.nameKey)
    out.push(v.parsed.name)
  }
  return out
}

/** One recipe row ready for the payload. */
export interface ResolvedIngredientRow {
  ingredientId: string
  ingredientName: string
  quantity: number
  unit: string
  optional: boolean
  note: string
  section?: string
  displayQuantity?: number | null
  displayUnit?: string | null
}

export interface LineResolvers {
  match: (names: string[]) => Promise<LineMatch[]>
  ensure: (names: string[]) => Promise<Array<{ name: string; id: string; ingredientName: string }>>
}

/**
 * The lines → the recipe's rows, at save time: saved lines as they were,
 * «✓» with their entry, «¿cuál?» with the pick (unanswered, what the
 * question says: the first one, or a new one), and the new ones created.
 */
export async function resolveIngredientRows(
  views: readonly IngredientLineView[],
  resolvers: LineResolvers,
): Promise<ResolvedIngredientRow[]> {
  const pending = views.filter((v) => !v.saved && v.state.kind === "loading")
  const late: Record<string, LineState> = {}
  if (pending.length > 0) {
    const names = namesToMatch(pending)
    const results = await resolvers.match(names)
    names.forEach((n, i) => {
      late[nameKey(n)] = stateOf(results[i], null)
    })
  }

  const picks = views.map((v): LibraryEntry | "new" | null => {
    if (v.saved) return null
    const state = v.state.kind === "loading" ? late[v.nameKey] ?? { kind: "new" } : v.state
    if (state.kind === "match") return state.ingredient
    if (state.kind === "doubt") return state.fallback === "first" ? state.candidates[0] : "new"
    return "new"
  })

  const newNames = [...new Map(views.filter((_, i) => picks[i] === "new").map((v) => [v.nameKey, v.parsed.name])).values()]
  const created = newNames.length > 0 ? await resolvers.ensure(newNames) : []
  const createdByKey = new Map(created.map((c) => [nameKey(c.name), { id: c.id, name: c.ingredientName }]))

  return views.map((v, i) => {
    if (v.saved) {
      return {
        ingredientId: v.saved.ingredientId,
        ingredientName: v.saved.ingredientName,
        quantity: v.saved.quantity,
        unit: v.saved.unit,
        optional: v.saved.optional ?? false,
        note: v.saved.note ?? "",
        ...(v.saved.section ? { section: v.saved.section } : {}),
        displayQuantity: v.saved.displayQuantity ?? null,
        displayUnit: v.saved.displayUnit ?? null,
      }
    }
    const pick = picks[i]
    const entry = pick === "new" ? createdByKey.get(v.nameKey) : pick
    if (!entry) throw new Error(`No se ha podido crear «${v.parsed.name}».`)
    return {
      ingredientId: entry.id,
      ingredientName: entry.name,
      quantity: v.amount.quantity,
      unit: v.amount.unit,
      optional: v.parsed.optional,
      note: v.parsed.note ?? "",
      ...(v.section ? { section: v.section } : {}),
      displayQuantity: v.amount.displayQuantity ?? null,
      displayUnit: v.amount.displayUnit ?? null,
    }
  })
}

/** Saved steps as the box's text: numbered, so they read back the same. */
export function stepsText(steps: readonly string[]): string {
  return steps.map((s, i) => `${i + 1}. ${s}`).join("\n")
}
