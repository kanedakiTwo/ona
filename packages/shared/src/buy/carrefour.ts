/**
 * «Hacer este pedido en Carrefour.es» (PRO-84, specs/shop-orders.md): one
 * plain search link on carrefour.es per line of the súper card. Carrefour
 * doesn't let anyone fill its cart from outside, so the user searches and adds
 * each product there. No affiliate code, no tracking parameters: just `q`.
 */
export const CARREFOUR_SEARCH_URL = 'https://www.carrefour.es/'

/** Search link for one product on carrefour.es. */
export function carrefourSearchUrl(query: string): string {
  return `${CARREFOUR_SEARCH_URL}?q=${encodeURIComponent(query.trim())}`
}

export interface CarrefourLineInput {
  key: string
  name: string
  /** Curated supermarket search text from the buy rule, when there is one. */
  eci?: string | null
  /** false = the user unticked it ("probablemente lo tienes"). */
  included?: boolean
}

/** One link per line that is still in the order. */
export function carrefourLinks(lines: CarrefourLineInput[]): Array<{ key: string; url: string }> {
  return lines
    .filter((l) => l.included !== false)
    .map((l) => ({ key: l.key, url: carrefourSearchUrl(l.eci || l.name) }))
}
