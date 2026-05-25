/**
 * Pure token-set ingredient matcher.
 *
 * Background: the previous matcher in `recipeExtractor.ts` used a naive
 * substring fallback (`normalized.includes(catalogName)` OR
 * `catalogName.includes(normalized)`). That collapsed "pechuga de pollo"
 * to catalogue entry "pollo" — losing the part-of-animal qualifier and
 * dropping the recipe from "1 chicken breast" to "1 whole chicken".
 *
 * This matcher encodes the principle "no information loss":
 *
 *   - Cooking-state modifiers (picada, rallado, fresco, …) are
 *     considered noise and may be stripped from the user input — they
 *     describe how the ingredient is cut/prepared, not what it is.
 *
 *   - Anything else the user typed beyond the catalogue name (parts,
 *     varieties, regional adjectives) IS information and must be
 *     preserved by refusing the match and letting the upstream caller
 *     fall through to the next strategy (LLM disambiguation, then USDA
 *     auto-create).
 *
 * The function is intentionally pure (no DB, no network) so it can be
 * unit-tested without infrastructure and embedded in the matcher
 * cascade in `recipeExtractor.matchIngredients`.
 */

/** Spanish connectors that never carry semantic weight in ingredient names. */
export const STOPWORDS = new Set<string>([
  'de', 'del', 'la', 'el', 'las', 'los', 'al', 'en', 'con', 'a', 'y',
])

/**
 * Cooking-state modifiers that describe HOW the ingredient is prepared,
 * not WHAT it is. Safe to strip when matching against a generic catalogue
 * entry — e.g. "cebolla picada" → "cebolla", "tomate maduro" → "tomate".
 * Kept short and unambiguous; anything not on this list defaults to
 * preserving the modifier and rejecting the match.
 */
export const NOISE_TOKENS = new Set<string>([
  // Cutting / processing state
  'picada', 'picado', 'troceada', 'troceado', 'rallada', 'rallado',
  'molida', 'molido', 'rebanada', 'rebanado', 'laminada', 'laminado',
  'cortada', 'cortado', 'trozos',
  // Cooking state
  'cocida', 'cocido', 'crudo', 'cruda', 'hervida', 'hervido',
  'asada', 'asado', 'tostada', 'tostado',
  // Freshness / maturity
  'fresca', 'fresco', 'seca', 'seco', 'congelada', 'congelado',
  'madura', 'maduro',
  // Provenance descriptors that don't change the ingredient nutritionally
  'ecologica', 'ecológica', 'ecologico', 'ecológico',
  'biologica', 'biológica', 'biologico', 'biológico',
  'natural',
])

export function tokenize(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[.,()]+/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !STOPWORDS.has(t))
}

export interface CatalogEntry {
  id: string
  name: string
}

export type TokenMatchVerdict =
  | { kind: 'exact'; catalog: CatalogEntry }
  | { kind: 'noise-stripped'; catalog: CatalogEntry; stripped: string[] }
  | { kind: 'user-generic'; catalog: CatalogEntry }
  | { kind: 'no-match' }

/**
 * Match `userName` against the catalogue using token-set semantics.
 *
 * Resolution order (first hit wins):
 *
 *   1. **exact** — token sets are equal after stopword removal.
 *      "tomate" vs "tomate", "aceite de oliva" vs "aceite de oliva".
 *
 *   2. **noise-stripped** — the catalogue's tokens are a subset of the
 *      user's tokens AND every extra user token is in `NOISE_TOKENS`.
 *      "cebolla picada" matches catalogue "cebolla" because the only
 *      extra token, "picada", describes preparation state.
 *      "pechuga de pollo" does NOT match "pollo" because the extra
 *      token "pechuga" is not in the noise list.
 *
 *   3. **user-generic** — the user's tokens are a strict subset of the
 *      catalogue's tokens (user typed something more generic than what
 *      the catalogue offers). "sal" matched against catalogue
 *      "sal marina". When multiple catalogue entries qualify, the
 *      SHORTEST one wins (deterministic; prefer the closest to what
 *      the user typed).
 *
 *   4. **no-match** — the caller falls through to LLM disambiguation
 *      or USDA auto-create.
 */
export function tokenSetMatch(
  userName: string,
  catalog: CatalogEntry[],
): TokenMatchVerdict {
  const userTokens = tokenize(userName)
  if (userTokens.length === 0) return { kind: 'no-match' }

  const userSet = new Set(userTokens)

  let exact: CatalogEntry | null = null
  let noiseStripped: { entry: CatalogEntry; stripped: string[] } | null = null
  const generic: CatalogEntry[] = []

  for (const entry of catalog) {
    const catalogTokens = tokenize(entry.name)
    if (catalogTokens.length === 0) continue
    const catalogSet = new Set(catalogTokens)

    // 1) exact token-set equality
    if (
      catalogSet.size === userSet.size &&
      [...catalogSet].every((t) => userSet.has(t))
    ) {
      // First exact wins (rare: should only be one in a clean catalogue).
      exact = entry
      break
    }

    // 2) noise-stripped: catalog ⊂ user AND extras all in noise list
    if ([...catalogSet].every((t) => userSet.has(t))) {
      const extras = [...userSet].filter((t) => !catalogSet.has(t))
      if (extras.length > 0 && extras.every((t) => NOISE_TOKENS.has(t))) {
        // Keep the catalogue entry with the largest token-set so the
        // result is the most specific candidate that still token-fits.
        if (
          !noiseStripped ||
          catalogTokens.length > noiseStripped.entry.name.split(/\s+/).length
        ) {
          noiseStripped = { entry, stripped: extras }
        }
      }
    }

    // 3) user ⊂ catalog (user generic, catalog specific)
    if ([...userSet].every((t) => catalogSet.has(t)) && catalogSet.size > userSet.size) {
      generic.push(entry)
    }
  }

  if (exact) return { kind: 'exact', catalog: exact }
  if (noiseStripped) {
    return {
      kind: 'noise-stripped',
      catalog: noiseStripped.entry,
      stripped: noiseStripped.stripped,
    }
  }
  if (generic.length > 0) {
    // Shortest catalog name wins — closest to the user's intent.
    generic.sort((a, b) => a.name.length - b.name.length)
    return { kind: 'user-generic', catalog: generic[0] }
  }
  return { kind: 'no-match' }
}
