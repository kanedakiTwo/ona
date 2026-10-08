/**
 * How shop-order lines read, shared by the API (messages to shops) and the
 * web (/compra): "1,2 kg", "3 unidades", accents restored on catalogue names.
 */

import type { BuyableUnit } from '../types/shopping.js'

function num(n: number): string {
  return String(Math.round(n * 100) / 100).replace('.', ',')
}

export function formatQty(quantity: number, unit: BuyableUnit): string {
  switch (unit) {
    case 'g':
      return quantity >= 1000 ? `${num(quantity / 1000)} kg` : `${num(quantity)} g`
    case 'ml':
      return quantity >= 1000 ? `${num(quantity / 1000)} l` : `${num(quantity)} ml`
    case 'u':
      return `${num(quantity)} ${quantity === 1 ? 'unidad' : 'unidades'}`
    case 'cda':
      return `${num(quantity)} ${quantity === 1 ? 'cucharada' : 'cucharadas'}`
    case 'cdita':
      return `${num(quantity)} ${quantity === 1 ? 'cucharadita' : 'cucharaditas'}`
  }
}

/** The catalogue stores names without accents ("champinones"); messages go to real people. */
const ACCENTS: Record<string, string> = {
  champinones: 'champiñones', champinon: 'champiñón', judias: 'judías', judia: 'judía', jamon: 'jamón', salmon: 'salmón',
  limon: 'limón', pimenton: 'pimentón', atun: 'atún', calabacin: 'calabacín', brocoli: 'brócoli', platano: 'plátano',
  platanos: 'plátanos', pina: 'piña', melon: 'melón', sandia: 'sandía', oregano: 'orégano', azucar: 'azúcar', lacon: 'lacón',
  cuscus: 'cuscús', curcuma: 'cúrcuma', sesamo: 'sésamo', rucula: 'rúcula', maiz: 'maíz', rabano: 'rábano', rabanos: 'rábanos',
  boqueron: 'boquerón', tuetano: 'tuétano', cana: 'caña', cafe: 'café', te: 'té', higado: 'hígado', albondigas: 'albóndigas',
  arandanos: 'arándanos', jalapeno: 'jalapeño', pinones: 'piñones', nispero: 'níspero', aji: 'ají',
}

export function prettyName(name: string): string {
  return name.replace(/[A-Za-zÀ-ÿ]+/g, (w) => {
    const fixed = ACCENTS[w.toLowerCase()]
    if (!fixed) return w
    return w[0] === w[0].toUpperCase() ? capitalize(fixed) : fixed
  })
}

export function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

/**
 * How an ingredient name reads on screen (recipe detail, shopping list,
 * pantry): sentence case — only the first letter is raised — with accents
 * restored. Brands and acronyms the user typed ("Kerrygold", "AOVE") stay as
 * written; the stored name is never touched.
 */
export function ingredientDisplayName(name: string): string {
  return capitalize(prettyName(name.trim()))
}
