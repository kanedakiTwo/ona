/**
 * Which kind of shop sells a shopping-list line (specs/shop-orders.md).
 *
 * The catalogue's `aisle` is too coarse ('proteinas' mixes merluza, pollo,
 * huevo and tofu), so meat and fish are told apart by name. Anything
 * processed or packaged (caldo, conserva, triturado…) goes to the súper.
 */

import type { BuyShop, ShopKind } from '@ona/shared'

export function normalizeName(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Packaged / processed forms that a fresh-food shop doesn't sell. */
const PACKAGED = /\b(caldo|fondo|salsa|conserva|lata|en aceite|triturado|tomate frito|pasta de|congelad|ahumad|surimi|nuggets?|en escabeche|enlatad|encurtid)/

const FISH = /\b(merluza|pescadilla|bacalao|salmon|dorada|lubina|sardinas?|boquerone?s?|anchoas? frescas?|caballa|jurel|trucha|rodaballo|lenguado|gallo|rape|besugo|bonito|atun (fresco|rojo)|lomos? de atun|emperador|pez espada|cabracho|corvina|mero|sepia|calamar(es)?|chipirones?|pulpo|gambas?|langostinos?|cigalas?|carabineros?|mejillone?s?|almejas?|berberechos?|navajas?|vieiras?|zamburinas?|ostras?|bogavante|centollo|necoras?|percebes?|pescado|marisco)\b/

const MEAT = /\b(ternera|vaca|buey|anojo|cerdo|lomo|solomillo|secreto|presa|pluma|costillas?|panceta|tocino|bacon|pollo|gallina|pavo|pato|codorniz|conejo|cordero|cabrito|chuletas?|chuleton|entrecot|filetes? de (ternera|cerdo|pollo|pavo)|pechugas?|muslos?|contramuslos?|alitas?|carrillada|rabo|morcillo|jarrete|aguja|babilla|redondo|carne|hamburguesas?|albondigas|salchichas?|chorizo|morcilla|longaniza|butifarra|sobrasada|jamon|lacon|cecina|hueso|tuetano|higado|callos|manitas)\b/

/** Fruit, veg and fresh herbs by name — the catalogue's aisle is often missing ("limón", typed "calabacín"). */
const PRODUCE = /\b(fruta|frutas|verdura|verduras|hortalizas?|ajos?|cebollas?|cebolletas?|puerros?|tomates?|patatas?|zanahorias?|pimientos?|calabacin(es)?|berenjenas?|pepinos?|calabazas?|brocoli|coliflor(es)?|repollo|lombarda|lechugas?|cogollos?|espinacas|acelgas|judias verdes|alcachofas?|esparragos|champinones|setas|perejil|cilantro|albahaca|menta|hierbabuena|eneldo|cebollino|romero|tomillo|jengibre|limon(es)?|limas?|naranjas?|mandarinas?|manzanas?|peras?|platanos?|aguacates?|mangos?|kiwis?|melocoton(es)?|granadas?|pinas?|melon(es)?|sandias?|fresas?|fresones?|arandanos|frambuesas|uvas?|boniatos?|remolachas?|rabanitos?|apio|rucula|canonigos)\b/

export function classifyShopKind(name: string, aisle: string | null | undefined): ShopKind {
  const n = normalizeName(name)
  if (aisle === 'congelados' || PACKAGED.test(n)) return 'supermercado'
  if (FISH.test(n)) return 'pescaderia'
  if (MEAT.test(n) && !/^pan\b/.test(n)) return 'carniceria'
  if (aisle === 'produce' || PRODUCE.test(n)) return 'fruteria'
  return 'supermercado'
}

/** Where a buy rule sends its line. Charcutería goes to the butcher; pantry items typed by hand to the súper. */
export function kindForBuyShop(shop: BuyShop): ShopKind {
  switch (shop) {
    case 'charcuteria':
      return 'carniceria'
    case 'despensa':
      return 'supermercado'
    default:
      return shop
  }
}

export interface RoutableShop {
  id: string
  kind: ShopKind
  position: number
}

/** First shop of that kind (by position); otherwise the household's súper; otherwise none. */
export function pickShopForKind<T extends RoutableShop>(kind: ShopKind, shops: T[]): T | null {
  const sorted = [...shops].sort((a, b) => a.position - b.position)
  return sorted.find((s) => s.kind === kind) ?? sorted.find((s) => s.kind === 'supermercado') ?? null
}
