/**
 * PRO-85: recipes Mimo mentions in the web panel link to their page.
 *
 * The reply is the model's free text; the ids come from the turn's `data`
 * (`get_todays_menu` → `{ day }`, a week → `{ days[] }`, a recipe asked by
 * name → `{ id, name }`, or `{ recipeId, recipeName }`). Free-text notes
 * («cenamos fuera») have no page, so they never link. Pure, no React.
 */

export interface RecipeRef {
  id: string
  name: string
}

export interface TextSegment {
  text: string
  href?: string
}

function addDay(day: unknown, out: RecipeRef[]): void {
  if (!day || typeof day !== 'object') return
  for (const slot of Object.values(day as Record<string, any>)) {
    const dishes = slot?.dishes
    if (!Array.isArray(dishes)) continue
    for (const d of dishes) {
      if (d?.kind === 'recipe' && typeof d.recipeId === 'string' && typeof d.recipeName === 'string') {
        add({ id: d.recipeId, name: d.recipeName }, out)
      }
    }
  }
}

function add(ref: RecipeRef, out: RecipeRef[]): void {
  const name = ref.name.trim()
  if (name && !out.some((r) => r.id === ref.id)) out.push({ id: ref.id, name })
}

export function recipeRefsFrom(uiHint: string | undefined, data: unknown): RecipeRef[] {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return []
  const d = data as Record<string, any>
  const out: RecipeRef[] = []
  addDay(d.day, out)
  if (Array.isArray(d.days)) for (const day of d.days) addDay(day, out)
  if (typeof d.recipeId === 'string' && typeof d.recipeName === 'string') add({ id: d.recipeId, name: d.recipeName }, out)
  if (uiHint === 'recipe' && typeof d.id === 'string' && typeof d.name === 'string') add({ id: d.id, name: d.name }, out)
  return out
}

const isLetter = (ch: string | undefined) => !!ch && /[\p{L}\p{N}]/u.test(ch)

/**
 * Split `text` so the first whole-word mention (any case) of each recipe name
 * is a link to `/recipes/<id>`. Longer names first, so «Tortilla de patata»
 * isn't cut short by «Tortilla».
 */
export function linkRecipeNames(text: string, refs: RecipeRef[]): TextSegment[] {
  const lower = text.toLocaleLowerCase('es')
  const taken: Array<{ start: number; end: number; href: string }> = []
  for (const ref of [...refs].sort((a, b) => b.name.length - a.name.length)) {
    const needle = ref.name.toLocaleLowerCase('es')
    let from = 0
    while (needle) {
      const at = lower.indexOf(needle, from)
      if (at < 0) break
      const end = at + needle.length
      const free = !taken.some((t) => at < t.end && end > t.start)
      if (free && !isLetter(text[at - 1]) && !isLetter(text[end])) {
        taken.push({ start: at, end, href: `/recipes/${ref.id}` })
        break
      }
      from = at + 1
    }
  }
  if (taken.length === 0) return [{ text }]
  taken.sort((a, b) => a.start - b.start)
  const out: TextSegment[] = []
  let pos = 0
  for (const t of taken) {
    if (t.start > pos) out.push({ text: text.slice(pos, t.start) })
    out.push({ text: text.slice(t.start, t.end), href: t.href })
    pos = t.end
  }
  if (pos < text.length) out.push({ text: text.slice(pos) })
  return out
}
