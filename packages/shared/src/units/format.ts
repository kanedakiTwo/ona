/** Values that scale cleanly into culinary fractions; ε = 0.02. */
const CULINARY_FRACTIONS = [
  0.25, 0.33, 0.5, 0.66, 0.75,
  1, 1.25, 1.33, 1.5, 1.66, 1.75,
  2, 2.25, 2.33, 2.5, 2.66, 2.75,
  3, 3.5, 4, 4.5, 5, 6, 8, 10, 12,
]

/** "Is this scaled value close to a value cooks would write down?" */
export function isCulinaryClean(scaled: number): { clean: true; value: number } | { clean: false } {
  for (const f of CULINARY_FRACTIONS) {
    if (Math.abs(scaled - f) <= 0.02) return { clean: true, value: f }
  }
  if (scaled >= 1 && Math.abs(scaled - Math.round(scaled)) <= 0.02) {
    return { clean: true, value: Math.round(scaled) }
  }
  return { clean: false }
}

/** Map of fractional decimal → ASCII fraction. */
const FRACTION_LABELS = new Map<number, string>([
  [0.25, '1/4'],
  [0.33, '1/3'],
  [0.5,  '1/2'],
  [0.66, '2/3'],
  [0.75, '3/4'],
])

/**
 * Convert a culinary-clean numeric to a readable string.
 * 1.5 → "1 1/2", 0.75 → "3/4", 2 → "2", 1.33 → "1 1/3".
 */
export function formatFraction(value: number): string {
  const whole = Math.floor(value)
  const remainder = value - whole
  if (Math.abs(remainder) <= 0.01) return String(whole)
  for (const [decimal, label] of FRACTION_LABELS) {
    if (Math.abs(remainder - decimal) <= 0.02) {
      return whole === 0 ? label : `${whole} ${label}`
    }
  }
  // Fallback: one decimal place ("1.5" → "1.5"; "1.0" stripped to "1")
  return value.toFixed(1).replace(/\.0$/, '')
}

/**
 * Render a canonical quantity with magnitude-aware rounding.
 *  < 1   → 2 decimals (0.5 g)
 *  < 10  → 1 decimal (4.5 g)
 *  < 100 → integer (22 g)
 *  ≥ 100 → multiple of 5 (235 g)
 */
export function formatCanonical(qty: number, unit: 'g' | 'ml' | 'u'): string {
  let rounded: number
  if (qty < 1) {
    rounded = Math.round(qty * 100) / 100
  } else if (qty < 10) {
    rounded = Math.round(qty * 10) / 10
  } else if (qty < 100) {
    rounded = Math.round(qty)
  } else {
    rounded = Math.round(qty / 5) * 5
  }
  return `${rounded} ${unit}`
}

export interface FormatScaledInput {
  displayQuantity: number     // already scaled
  displayUnit: string
  canonicalQuantity: number   // already scaled
  canonicalUnit: 'g' | 'ml' | 'u'
  factor: number              // userServings / recipe.servings
}

export interface FormatScaledOutput {
  primary: string
  secondary?: string
}

/**
 * Produce a display-friendly rendering of a scaled ingredient quantity.
 * If the scaled `displayQuantity` is culinary-clean, keep the abstract unit
 * and append the canonical as a secondary; else fall back to canonical only.
 */
export function formatScaled(input: FormatScaledInput): FormatScaledOutput {
  const culinary = isCulinaryClean(input.displayQuantity)
  if (culinary.clean) {
    return {
      primary: `${formatFraction(culinary.value)} ${input.displayUnit}`,
      secondary: formatCanonical(input.canonicalQuantity, input.canonicalUnit),
    }
  }
  return { primary: formatCanonical(input.canonicalQuantity, input.canonicalUnit) }
}
