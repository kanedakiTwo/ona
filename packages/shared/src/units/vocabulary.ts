import { normalizeTerm } from './normalize.js'

export interface UnitFactor {
  gramsPerUnit?: number
  mlPerUnit?: number
  perUnitWeight?: boolean
  symbolic?: boolean
}

export interface VocabularyTerm {
  canonical: string
  synonyms: readonly string[]
  factor: UnitFactor
  /**
   * Category used by the display formatter (Task 1.4) to pick render rules —
   * e.g. plural inflection for `mass` ("2 pizcas"), and to choose default
   * decimal precision for `volume` vs `discrete`.
   */
  family: 'volume' | 'mass' | 'discrete' | 'symbolic'
}

export const VOCABULARY: readonly VocabularyTerm[] = [
  // Volumetric (13)
  { canonical: 'gota',          synonyms: ['gota','gotita','gotas','gotitas'],
    factor: { mlPerUnit: 0.05 }, family: 'volume' },
  { canonical: 'cdita',         synonyms: ['cdita','cdta','cucharadita','cucharaditas','cucharadita de cafe','cucharadita de te','cuchara de cafe','c.p.','c/p','cdt','tsp'],
    factor: { mlPerUnit: 5 }, family: 'volume' },
  { canonical: 'cda postre',    synonyms: ['cda postre','cucharada de postre','cuchara de postre'],
    factor: { mlPerUnit: 10 }, family: 'volume' },
  { canonical: 'cda',           synonyms: ['cda','cda.','cucharada','cucharadas','cucharada sopera','cuchara sopera','cuchs','tbsp'],
    factor: { mlPerUnit: 15 }, family: 'volume' },
  { canonical: 'chorrito',      synonyms: ['chorrito','chorrin','un chorrito'],
    factor: { mlPerUnit: 10 }, family: 'volume' },
  { canonical: 'chorro',        synonyms: ['chorro','chorreton','buen chorro'],
    factor: { mlPerUnit: 30 }, family: 'volume' },
  { canonical: 'copa licor',    synonyms: ['copa licor','copita','copa pequena'],
    factor: { mlPerUnit: 50 }, family: 'volume' },
  { canonical: 'tacita',        synonyms: ['tacita','tacita de cafe','taza de cafe'],
    factor: { mlPerUnit: 100 }, family: 'volume' },
  { canonical: 'copa vino',     synonyms: ['copa vino','copa de vino','vaso de vino','vaso pequeno','copa'],
    factor: { mlPerUnit: 100 }, family: 'volume' },
  { canonical: 'taza desayuno', synonyms: ['taza desayuno','taza de te','taza chica'],
    factor: { mlPerUnit: 150 }, family: 'volume' },
  { canonical: 'vaso',          synonyms: ['vaso','vaso de agua','vaso estandar','vaso normal'],
    factor: { mlPerUnit: 200 }, family: 'volume' },
  { canonical: 'taza',          synonyms: ['taza','cup','taza americana','taza reposteria'],
    factor: { mlPerUnit: 240 }, family: 'volume' },
  { canonical: 'tazón',         synonyms: ['tazon','bowl','tazon de desayuno'],
    factor: { mlPerUnit: 250 }, family: 'volume' },

  // Mass (4)
  { canonical: 'pizca',         synonyms: ['pizca','pizquita','una pizca','pinch'],
    factor: { gramsPerUnit: 0.5 }, family: 'mass' },
  { canonical: 'pellizco',      synonyms: ['pellizco','pellizquito','dash'],
    factor: { gramsPerUnit: 2 }, family: 'mass' },
  { canonical: 'puñado',        synonyms: ['punado','puno','punadito','un punado','handful'],
    factor: { gramsPerUnit: 30 }, family: 'mass' },
  { canonical: 'manojo',        synonyms: ['manojo','atadillo','ramillete','bouquet','bouquet garni'],
    factor: { gramsPerUnit: 100 }, family: 'mass' },

  // Discrete (10)
  { canonical: 'diente',        synonyms: ['diente','dientecillo','diente de ajo'],
    factor: { perUnitWeight: true, gramsPerUnit: 5 }, family: 'discrete' },
  { canonical: 'terrón',        synonyms: ['terron','cubito','cubito de azucar','sugar cube'],
    factor: { perUnitWeight: true, gramsPerUnit: 6 }, family: 'discrete' },
  { canonical: 'nuez',          synonyms: ['nuez','nuez de mantequilla'],
    factor: { perUnitWeight: true, gramsPerUnit: 20 }, family: 'discrete' },
  { canonical: 'avellana',      synonyms: ['avellana','avellana de mantequilla'],
    factor: { perUnitWeight: true, gramsPerUnit: 5 }, family: 'discrete' },
  { canonical: 'loncha',        synonyms: ['loncha','lonja','tajada','feta','slice'],
    factor: { perUnitWeight: true, gramsPerUnit: 40 }, family: 'discrete' },
  { canonical: 'rebanada',      synonyms: ['rebanada','rebanadita','rodaja de pan'],
    factor: { perUnitWeight: true, gramsPerUnit: 30 }, family: 'discrete' },
  { canonical: 'hoja',          synonyms: ['hoja','hojita','hojas','hojitas'],
    factor: { perUnitWeight: true, gramsPerUnit: 0.2 }, family: 'discrete' },
  { canonical: 'ramita',        synonyms: ['ramita','ramito','rama','sprig'],
    factor: { perUnitWeight: true, gramsPerUnit: 1.5 }, family: 'discrete' },
  { canonical: 'rodaja',        synonyms: ['rodaja','ruedita','rodajas','aro','aros'],
    factor: { perUnitWeight: true, gramsPerUnit: 12 }, family: 'discrete' },
  { canonical: 'unidad',        synonyms: ['unidad','unidades','u','ud','ud.','pieza','piezas','pza','pieces'],
    factor: { perUnitWeight: true }, family: 'discrete' },

  // Symbolic (2)
  // c.s. is intentionally NOT in synonyms — resolver disambiguates contextually.
  { canonical: 'al gusto',      synonyms: ['al gusto','a gusto','al paladar','q.s.','to taste'],
    factor: { symbolic: true }, family: 'symbolic' },
  { canonical: 'cantidad suficiente', synonyms: ['cantidad suficiente','c/s','c.n.','cantidad necesaria'],
    factor: { symbolic: true }, family: 'symbolic' },
]

const SYNONYM_INDEX = new Map<string, VocabularyTerm>()
for (const term of VOCABULARY) {
  for (const syn of term.synonyms) {
    const key = normalizeTerm(syn)
    if (SYNONYM_INDEX.has(key)) {
      throw new Error(`Duplicate synonym "${syn}" — already maps to ${SYNONYM_INDEX.get(key)!.canonical}`)
    }
    SYNONYM_INDEX.set(key, term)
  }
}

export function getTermBySynonym(input: string): VocabularyTerm | undefined {
  return SYNONYM_INDEX.get(normalizeTerm(input))
}
