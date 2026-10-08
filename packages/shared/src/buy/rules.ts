/**
 * "Cómo se compra" — how each product is asked for at a Spanish shop
 * (specs/shop-orders.md → Buy rules; research: docs/research/Pedir en
 * tiendas de frescos.md). Keyed by normalized name + aliases; the ingredient
 * UUID can't be the key because it differs per environment.
 *
 * Weights are typical retail weights (UCM household-unit table, frutería
 * catalogues, El Corte Inglés / Mercadona formats). Minimums marked (est.)
 * in the research are design estimates to be tuned with real orders.
 */

export type BuyShop = 'fruteria' | 'carniceria' | 'charcuteria' | 'pescaderia' | 'supermercado' | 'despensa'
export type BuyBy = 'pieza' | 'peso' | 'envase'
export type BuyTier = 'despensa' | 'nevera' | 'normal' | 'especial'

export interface BuyChoice {
  question: string
  options: string[]
  /** null = the order can't go out until someone chooses. */
  def: string | null
}

export interface BuyRule {
  key: string
  /** Normalized names that resolve to this rule; `name → preset choice` for variants ("jamon serrano" → serrano). */
  names: Array<string | [string, string]>
  /** Extra patterns tried after exact names (normalized input). */
  match?: RegExp
  shop: BuyShop
  by: BuyBy
  /** What the shop calls it. `{c}` is replaced by the chosen option. [singular, plural] */
  noun: [string, string]
  /** Sale unit when it isn't the product itself: "1 cabeza de ajos", "1 manojo de perejil". */
  unit?: [string, string]
  /** Grams per sale unit (pieza / unit / pack). */
  g?: number
  /** Grams that a recipe "u" means (ajo: a clove). Default: g. */
  ug?: number
  /** pieza: min units · peso: min grams. */
  min?: number
  /** peso: rounding step in grams (default 250; charcutería 50). */
  step?: number
  /** pieza → by weight when more than this many pieces ("1 kg de naranjas"). */
  kgAbove?: number
  /** Half piece allowed and how it's said ("medio melón"). */
  half?: string
  /** envase: container name [singular, plural] and size label; g = pack grams/ml. */
  pack?: { unit: [string, string]; size: string }
  tier?: BuyTier
  choice?: BuyChoice
  /** Default preparation [singular, plural] ("limpia para el horno"). */
  prep?: [string, string]
  /** Offer an alternative to the shop: "(o lubinas, la que esté mejor hoy)" — {alt} = first other option, plural. */
  alt?: string
  /** Recipe notes that turn this into another product (cebolla + "morada" → cebolla morada). */
  variants?: Array<[RegExp, string]>
  /** Recipe notes that are the shop's job (picada, en filetes…); default: shopPrep regex below. */
  eci?: string
  /** Fish priced by the daily lonja (always to approval). */
  volatile?: boolean
  /** Edible grams per whole piece (whole fish): converts clean recipe grams to pieces. */
  edibleG?: number
  /** Pieces to ask for when the user typed it with no amount ("plátanos" → 6). */
  defaultN?: number
}

const piece = (key: string, names: BuyRule['names'], noun: [string, string], g: number, extra: Partial<BuyRule> = {}): BuyRule => ({
  key,
  names,
  shop: 'fruteria',
  by: 'pieza',
  noun,
  g,
  min: 1,
  ...extra,
})
const bunch = (key: string, names: BuyRule['names'], of: string, extra: Partial<BuyRule> = {}): BuyRule => ({
  key,
  names,
  shop: 'fruteria',
  by: 'pieza',
  noun: [of, of],
  unit: ['manojo', 'manojos'],
  g: 30,
  min: 1,
  ...extra,
})
const weight = (key: string, shop: BuyShop, names: BuyRule['names'], noun: string, extra: Partial<BuyRule> = {}): BuyRule => ({
  key,
  names,
  shop,
  by: 'peso',
  noun: [noun, noun],
  min: 250,
  step: 250,
  ...extra,
})
const pack = (
  key: string,
  names: BuyRule['names'],
  noun: string,
  unit: [string, string],
  size: string,
  g: number,
  extra: Partial<BuyRule> = {},
): BuyRule => ({ key, names, shop: 'supermercado', by: 'envase', noun: [noun, noun], pack: { unit, size }, g, tier: 'normal', ...extra })
const pantry = (key: string, names: BuyRule['names'], noun: string, unit: [string, string], size: string, g: number, extra: Partial<BuyRule> = {}): BuyRule =>
  pack(key, names, noun, unit, size, g, { shop: 'despensa', tier: 'despensa', ...extra })

const FRUTERIA: BuyRule[] = [
  piece('ajo', ['ajo', 'ajos', 'diente de ajo', 'dientes de ajo', 'cabeza de ajo', 'cabeza de ajos'], ['ajos', 'ajos'], 50, { unit: ['cabeza', 'cabezas'], ug: 5 }),
  piece('cebolla', ['cebolla', 'cebollas', 'cebolla blanca'], ['cebolla', 'cebollas'], 150, { kgAbove: 6, variants: [[/\b(morada|roja)\b/, 'cebolla morada']] }),
  piece('cebolla morada', ['cebolla morada', 'cebollas moradas', 'cebolla roja'], ['cebolla morada', 'cebollas moradas'], 150, { kgAbove: 6 }),
  piece('cebolleta', ['cebolleta', 'cebolletas', 'cebolla tierna'], ['cebolleta', 'cebolletas'], 100),
  piece('puerro', ['puerro', 'puerros'], ['puerro', 'puerros'], 150),
  piece('tomate', ['tomate', 'tomates', ['tomate pera', 'pera'], ['tomate de rama', 'de rama'], ['tomate de ensalada', 'de ensalada']], ['tomate {c}', 'tomates {c}'], 150, {
    kgAbove: 6,
    choice: { question: '¿Qué tomate?', options: ['de ensalada', 'pera', 'de rama'], def: 'de ensalada' },
    variants: [[/\bcherry\b/, 'tomate cherry']],
  }),
  piece('tomate cherry', ['tomate cherry', 'tomates cherry'], ['tomates cherry', 'tomates cherry'], 250, { unit: ['tarrina', 'tarrinas'] }),
  piece('patata', ['patata', 'patatas'], ['patata', 'patatas'], 200, { kgAbove: 4 }),
  piece('boniato', ['boniato', 'boniatos'], ['boniato', 'boniatos'], 300),
  piece('zanahoria', ['zanahoria', 'zanahorias'], ['zanahoria', 'zanahorias'], 80, { kgAbove: 8 }),
  piece('pimiento rojo', ['pimiento rojo', 'pimientos rojos', 'pimientos de color', 'pimiento morron'], ['pimiento rojo', 'pimientos rojos'], 200),
  piece('pimiento verde', ['pimiento verde', 'pimientos verdes', 'pimiento italiano'], ['pimiento verde italiano', 'pimientos verdes italianos'], 120),
  piece('calabacin', ['calabacin', 'calabacines'], ['calabacín', 'calabacines'], 250),
  piece('berenjena', ['berenjena', 'berenjenas'], ['berenjena', 'berenjenas'], 300),
  piece('pepino', ['pepino', 'pepinos'], ['pepino', 'pepinos'], 200),
  piece('brocoli', ['brocoli', 'brocolis', 'brecol'], ['brócoli', 'brócolis'], 500),
  piece('coliflor', ['coliflor', 'coliflores'], ['coliflor', 'coliflores'], 1200, { half: 'media coliflor' }),
  piece('repollo', ['repollo', 'col', 'berza', 'lombarda'], ['repollo', 'repollos'], 1600, { half: 'medio repollo' }),
  piece('lechuga', ['lechuga', 'lechugas', 'lechuga romana'], ['lechuga', 'lechugas'], 400),
  piece('cogollo', ['cogollo', 'cogollos', 'cogollos de tudela'], ['cogollo', 'cogollos'], 150),
  piece('alcachofa', ['alcachofa', 'alcachofas'], ['alcachofa', 'alcachofas'], 200),
  piece('apio', ['apio', 'rama de apio', 'ramas de apio'], ['apio', 'apios'], 500, { half: 'medio apio', ug: 50 }),
  piece('remolacha', ['remolacha', 'remolachas'], ['remolacha', 'remolachas'], 150),
  piece('aguacate', ['aguacate', 'aguacates'], ['aguacate', 'aguacates'], 200),
  piece('limon', ['limon', 'limones', 'zumo de limon'], ['limón', 'limones'], 120, { ug: 120 }),
  piece('lima', ['lima', 'limas', 'zumo de lima'], ['lima', 'limas'], 60),
  piece('naranja', ['naranja', 'naranjas', ['naranja de zumo', 'de zumo'], ['naranja de mesa', 'de mesa']], ['naranja {c}', 'naranjas {c}'], 200, {
    kgAbove: 4,
    choice: { question: '¿De zumo o de mesa?', options: ['de zumo', 'de mesa'], def: 'de zumo' },
  }),
  piece('mandarina', ['mandarina', 'mandarinas'], ['mandarina', 'mandarinas'], 80, { kgAbove: 6 }),
  piece('manzana', ['manzana', 'manzanas'], ['manzana', 'manzanas'], 180, { kgAbove: 5 }),
  piece('pera', ['pera', 'peras'], ['pera', 'peras'], 175, { kgAbove: 5 }),
  piece('platano', ['platano', 'platanos', 'banana', 'bananas'], ['plátano de Canarias', 'plátanos de Canarias'], 150, { defaultN: 6 }),
  piece('mango', ['mango', 'mangos'], ['mango', 'mangos'], 400),
  piece('kiwi', ['kiwi', 'kiwis'], ['kiwi', 'kiwis'], 100, { kgAbove: 6 }),
  piece('melocoton', ['melocoton', 'melocotones'], ['melocotón', 'melocotones'], 150, { kgAbove: 5 }),
  piece('granada', ['granada', 'granadas'], ['granada', 'granadas'], 300),
  piece('pina', ['pina', 'pinas'], ['piña', 'piñas'], 1500),
  piece('melon', ['melon', 'melones'], ['melón', 'melones'], 2000, { half: 'medio melón' }),
  piece('sandia', ['sandia', 'sandias'], ['sandía', 'sandías'], 4000, { half: 'media sandía' }),
  piece('fresa', ['fresa', 'fresas', 'freson', 'fresones'], ['fresas', 'fresas'], 500, { unit: ['bandeja', 'bandejas'] }),
  piece('arandanos', ['arandano', 'arandanos'], ['arándanos', 'arándanos'], 125, { unit: ['tarrina', 'tarrinas'] }),
  piece('frambuesas', ['frambuesa', 'frambuesas'], ['frambuesas', 'frambuesas'], 125, { unit: ['tarrina', 'tarrinas'] }),
  piece('champinones', ['champinon', 'champinones', 'champiñones'], ['champiñones', 'champiñones'], 250, { unit: ['bandeja', 'bandejas'] }),
  piece('rucula', ['rucula', 'canonigos', 'brotes tiernos'], ['rúcula', 'rúcula'], 125, { unit: ['bolsa', 'bolsas'] }),
  piece('jengibre', ['jengibre', 'jengibre fresco'], ['jengibre', 'jengibre'], 50, { unit: ['trozo', 'trozos'] }),
  piece('esparragos', ['esparragos', 'esparragos trigueros', 'esparrago triguero'], ['espárragos trigueros', 'espárragos trigueros'], 250, { unit: ['manojo', 'manojos'] }),
  bunch('perejil', ['perejil', 'perejil fresco'], 'perejil'),
  bunch('cilantro', ['cilantro', 'cilantro fresco'], 'cilantro'),
  bunch('albahaca', ['albahaca', 'albahaca fresca'], 'albahaca'),
  bunch('menta', ['menta', 'hierbabuena', 'menta fresca'], 'menta'),
  bunch('eneldo', ['eneldo'], 'eneldo'),
  bunch('cebollino', ['cebollino', 'cebollino fresco', 'cebollino fresco, un manojo'], 'cebollino'),
  bunch('romero', ['romero', 'romero fresco'], 'romero'),
  bunch('tomillo', ['tomillo', 'tomillo fresco'], 'tomillo'),
  bunch('rabanitos', ['rabanitos', 'rabanos', 'rabanito'], 'rabanitos', { g: 150 }),
  bunch('acelgas', ['acelgas', 'acelga'], 'acelgas', { g: 500 }),
  weight('espinacas', 'fruteria', ['espinacas', 'espinaca', 'espinacas frescas'], 'espinacas'),
  weight('judias verdes', 'fruteria', ['judias verdes', 'judia verde', 'judias planas'], 'judías verdes'),
  weight('calabaza', 'fruteria', ['calabaza'], 'calabaza', { min: 500 }),
  weight('uva', 'fruteria', ['uva', 'uvas'], 'uvas', { min: 500 }),
  weight('setas', 'fruteria', ['setas', 'setas variadas', 'seta'], 'setas variadas'),
]

const MEAT_PREP = ['picada', 'en filetes', 'fileteada', 'fileteado', 'en dados', 'en taquitos', 'troceado', 'troceada', 'deshuesado', 'deshuesada', 'sin piel', 'para guisar', 'en tiras']

const CARNICERIA: BuyRule[] = [
  weight('ternera', 'carniceria', ['ternera', 'vaca', 'buey', 'carne de ternera', 'carne'], 'ternera {c}', {
    choice: { question: '¿Para qué es la ternera?', options: ['picada', 'en filetes', 'para guisar'], def: null },
    variants: [[/\bpicad/, 'carne picada de ternera'], [/\bfilete/, 'filetes de ternera'], [/\bcarriller/, 'carrilleras de ternera']],
  }),
  weight('carrilleras', 'carniceria', ['carrilleras', 'carrilleras de ternera', 'carrillada', 'carrilladas'], 'carrilleras de ternera', { min: 500 }),
  weight('carne picada', 'carniceria', ['carne picada', ['carne picada de ternera', 'de ternera'], ['carne picada de cerdo', 'de cerdo'], ['carne picada mixta', 'mixta']], 'carne picada {c}', {
    choice: { question: '¿Picada de qué?', options: ['de ternera', 'de cerdo', 'mixta'], def: 'mixta' },
  }),
  weight('filetes de ternera', 'carniceria', ['filetes de ternera', 'filete de ternera'], 'ternera en filetes finos'),
  weight('entrana', 'carniceria', ['entrana', 'entrana de ternera', 'entraña de ternera'], 'entraña de ternera'),
  weight('solomillo de ternera', 'carniceria', ['solomillo de ternera', 'solomillo'], 'solomillo de ternera', { match: /^solomillo de (ternera|buey|vaca)\b/ }),
  weight('pollo', 'carniceria', ['pollo', 'pollo campero', 'pollo de corral'], 'pollo {c}', {
    min: 500,
    choice: { question: '¿Cómo quieres el pollo?', options: ['troceado para guisar', 'entero', 'en pechugas', 'en contramuslos'], def: 'troceado para guisar' },
    variants: [[/\bpechug/, 'pechuga de pollo'], [/\b(contra)?muslo/, 'muslo de pollo'], [/\balita/, 'alitas de pollo']],
  }),
  piece('pechuga de pollo', ['pechuga de pollo', 'pechugas de pollo', 'pechuga'], ['pechuga de pollo', 'pechugas de pollo'], 200, { shop: 'carniceria' }),
  piece('muslo de pollo', ['muslo de pollo', 'muslos de pollo', 'contramuslo', 'contramuslos', 'contramuslos de pollo'], ['contramuslo de pollo', 'contramuslos de pollo'], 150, { shop: 'carniceria' }),
  weight('alitas de pollo', 'carniceria', ['alitas', 'alitas de pollo', 'alas de pollo'], 'alitas de pollo', { min: 500 }),
  weight('pavo', 'carniceria', ['pavo', 'pechuga de pavo'], 'pechuga de pavo en filetes'),
  weight('cerdo', 'carniceria', ['cerdo', 'carne de cerdo', ['lomo de cerdo', 'lomo'], ['secreto', 'secreto']], '{c} de cerdo', {
    choice: { question: '¿Qué parte del cerdo?', options: ['lomo', 'secreto', 'carne para guisar'], def: null },
  }),
  // "Carne de aguja" is beef for a burger and pork for a stew: the recipe says which.
  weight('aguja', 'carniceria', ['carne de aguja', 'carne de aguja de retal', 'aguja', ['aguja de cerdo', 'de cerdo'], ['aguja de ternera', 'de ternera'], ['aguja de vaca', 'de ternera']], 'aguja {c}', {
    choice: { question: '¿Aguja de ternera o de cerdo?', options: ['de ternera', 'de cerdo'], def: null },
  }),
  weight('costillas de cerdo', 'carniceria', ['costillas', 'costillas de cerdo', 'costilla de cerdo'], 'costillas de cerdo', { min: 500 }),
  weight('panceta', 'carniceria', ['panceta', 'panceta fresca'], 'panceta fresca'),
  weight('cordero', 'carniceria', ['cordero', 'carne de cordero'], '{c} de cordero', {
    choice: { question: '¿Qué pieza de cordero?', options: ['chuletillas', 'paletilla', 'carne para guisar'], def: null },
  }),
  piece('conejo', ['conejo'], ['conejo', 'conejos'], 1300, { shop: 'carniceria', half: 'medio conejo', prep: ['troceado', 'troceados'] }),
  weight('oreja de cerdo', 'carniceria', ['oreja de cerdo', 'oreja'], 'oreja de cerdo'),
  weight('rinones de cerdo', 'carniceria', ['rinones de cerdo', 'rinones'], 'riñones de cerdo'),
  piece('chorizo', ['chorizo', 'chorizo oreado', 'chorizo asturiano', 'chorizo para cocinar'], ['chorizo para cocinar', 'chorizos para cocinar'], 100, { shop: 'carniceria' }),
  piece('morcilla', ['morcilla', 'morcilla de cebolla', 'morcilla asturiana', 'morcilla de burgos'], ['morcilla', 'morcillas'], 150, { shop: 'carniceria' }),
]

const CHARCUTERIA: BuyRule[] = [
  weight('jamon', 'charcuteria', ['jamon', ['jamon serrano', 'serrano'], ['jamon serrano fileteado', 'serrano'], ['jamon iberico', 'ibérico']], 'jamón {c}', {
    min: 100,
    step: 50,
    choice: { question: '¿Serrano o ibérico?', options: ['serrano', 'ibérico'], def: null },
    prep: ['loncheado fino', 'loncheado fino'],
  }),
  weight('jamon cocido', 'charcuteria', ['jamon york', 'jamon de york', 'jamon cocido', 'york', 'jamon cocido extra'], 'jamón cocido extra', {
    min: 150,
    step: 50,
    prep: ['en lonchas', 'en lonchas'],
  }),
  weight('panceta curada', 'charcuteria', ['panceta salada curada', 'panceta curada', 'bacon', 'beicon'], 'bacon', { min: 100, step: 50, prep: ['en lonchas', 'en lonchas'] }),
  weight('lacon', 'charcuteria', ['lacon', 'lacon cocido'], 'lacón cocido', { min: 200, step: 50 }),
  weight('embutido', 'charcuteria', ['salchichon', 'lomo embuchado', 'fuet', 'chorizo en lonchas', 'cecina'], '{name}', { min: 100, step: 50 }),
]

const PESCADERIA: BuyRule[] = [
  {
    key: 'pescado entero',
    names: ['pescado entero', 'pescado entero fresco', 'pescado para el horno', ['dorada', 'dorada'], ['doradas', 'dorada'], ['lubina', 'lubina'], ['lubinas', 'lubina']],
    match: /^pescado entero\b/,
    shop: 'pescaderia',
    by: 'pieza',
    noun: ['{c} de ración', '{c}s de ración'],
    g: 550,
    edibleG: 300,
    min: 1,
    choice: { question: '¿Qué pescado?', options: ['dorada', 'lubina', 'gallo'], def: 'dorada' },
    prep: ['limpia para el horno', 'limpias para el horno'],
    alt: '(o {alt}, la que esté mejor hoy)',
  },
  weight('merluza', 'pescaderia', ['merluza', 'merluza fresca', 'lomos de merluza', 'pescadilla'], 'merluza', {
    prep: ['en lomos sin piel', 'en lomos sin piel'],
    volatile: true,
    variants: [[/\brodaja/, 'merluza en rodajas']],
  }),
  weight('merluza en rodajas', 'pescaderia', ['merluza en rodajas'], 'merluza en rodajas', { volatile: true }),
  weight('bacalao', 'pescaderia', ['bacalao', 'bacalao fresco'], 'bacalao fresco', { prep: ['en lomos', 'en lomos'], variants: [[/\bdesmig/, 'bacalao desmigado']] }),
  weight('bacalao desmigado', 'pescaderia', ['bacalao desmigado', 'bacalao desalado desmigado'], 'bacalao desalado desmigado'),
  weight('bacalao desalado', 'pescaderia', ['bacalao desalado'], 'bacalao desalado', { prep: ['en lomos', 'en lomos'] }),
  weight('salmon', 'pescaderia', ['salmon', 'salmon fresco', 'lomo de salmon', 'lomos de salmon'], 'salmón', { prep: ['en lomos sin piel', 'en lomos sin piel'] }),
  weight('rape', 'pescaderia', ['rape', 'cola de rape'], 'rape', { prep: ['limpio, en rodajas', 'limpio, en rodajas'], volatile: true }),
  weight('sardinas', 'pescaderia', ['sardina', 'sardinas'], 'sardinas', { min: 500, prep: ['limpias', 'limpias'], volatile: true }),
  weight('boquerones', 'pescaderia', ['boqueron', 'boquerones'], 'boquerones', { min: 500, prep: ['limpios', 'limpios'], volatile: true }),
  piece('trucha', ['trucha', 'truchas'], ['trucha', 'truchas'], 300, { shop: 'pescaderia', prep: ['limpia', 'limpias'], edibleG: 180 }),
  weight('mejillones', 'pescaderia', ['mejillon', 'mejillones'], 'mejillones', { min: 1000, step: 500 }),
  weight('almejas', 'pescaderia', ['almeja', 'almejas'], 'almejas', { volatile: true }),
  weight('gambas', 'pescaderia', ['gamba', 'gambas', 'gamba arrocera', 'langostinos', 'langostino'], 'gambas', { prep: ['crudas', 'crudas'], volatile: true }),
  weight('calamares', 'pescaderia', ['calamar', 'calamares', 'chipirones', 'sepia'], 'calamares', { prep: ['limpios', 'limpios'], volatile: true }),
  piece('pulpo', ['pulpo'], ['pulpo', 'pulpos'], 1500, { shop: 'pescaderia', prep: ['cocido', 'cocidos'], volatile: true }),
]

const SUPER: BuyRule[] = [
  pack('huevos', ['huevo', 'huevos', 'yema de huevo', 'yemas de huevo', 'yema', 'yemas', 'clara de huevo', 'claras'], 'huevos', ['docena', 'docenas'], '', 50, { tier: 'nevera', eci: 'huevos' }),
  pack('mantequilla', ['mantequilla'], 'mantequilla', ['tarrina', 'tarrinas'], '250 g', 250, { tier: 'nevera', eci: 'mantequilla 250 g' }),
  pack('leche', ['leche', 'leche entera', 'leche semidesnatada', 'leche desnatada'], 'leche entera', ['brik', 'briks'], '1 l', 1000, { tier: 'nevera', eci: 'leche entera' }),
  pack('bebida de avena', ['leche avena', 'leche de avena', 'bebida de avena'], 'bebida de avena', ['brik', 'briks'], '1 l', 1000, { eci: 'bebida de avena' }),
  pack('nata', ['nata', 'nata liquida', 'nata para cocinar'], 'nata para cocinar', ['brik', 'briks'], '200 ml', 200, { tier: 'nevera', eci: 'nata para cocinar' }),
  pack('yogur', ['yogur', 'yogures', 'yogur natural', 'yogures naturales'], '', ['pack de 4 yogures naturales', 'packs de 4 yogures naturales'], '', 500, { ug: 125, eci: 'yogur natural' }),
  pack('queso', ['queso'], 'queso {c}', ['paquete', 'paquetes'], '', 250, {
    choice: { question: '¿Qué queso?', options: ['curado', 'tierno', 'en lonchas', 'rallado'], def: null },
    eci: 'queso {c}',
  }),
  pack('queso rallado', ['queso rallado'], 'queso rallado', ['bolsa', 'bolsas'], '200 g', 200, { tier: 'nevera', eci: 'queso rallado' }),
  pack('queso en lonchas', ['queso sandwich', 'queso en lonchas', 'queso de sandwich', 'queso gouda', 'queso cheddar'], 'queso en lonchas', ['paquete', 'paquetes'], '200 g', 200, { eci: 'queso en lonchas' }),
  pack('parmesano', ['queso parmesano', 'parmesano', 'parmesano rallado'], 'parmesano rallado', ['bolsa', 'bolsas'], '60 g', 60, { tier: 'nevera', eci: 'parmesano rallado' }),
  pack('feta', ['feta', 'queso feta'], 'queso feta', ['paquete', 'paquetes'], '150 g', 150, { tier: 'especial', eci: 'queso feta' }),
  pack('mozzarella', ['mozzarella', 'queso mozzarella'], 'mozzarella', ['bola', 'bolas'], '125 g', 125, { eci: 'mozzarella fresca' }),
  pack('queso de cabra', ['queso de cabra', 'rulo de cabra'], 'rulo de queso de cabra', ['paquete', 'paquetes'], '200 g', 200, { eci: 'rulo de cabra' }),
  pack('queso fresco', ['queso fresco', 'requeson'], 'queso fresco', ['tarrina', 'tarrinas'], '250 g', 250, { eci: 'queso fresco' }),
  pack('queso manchego', ['queso manchego', 'manchego'], 'queso manchego', ['cuña', 'cuñas'], '300 g', 300, { eci: 'queso manchego curado' }),
  {
    key: 'pan',
    names: ['pan', 'pan blanco', ['barra de pan', 'en barra'], ['hogaza', 'de hogaza']],
    shop: 'supermercado',
    by: 'pieza',
    noun: ['pan {c}', 'panes {c}'],
    g: 400,
    min: 1,
    tier: 'normal',
    choice: { question: '¿Qué pan?', options: ['de molde', 'de hogaza', 'en barra'], def: null },
    eci: 'pan {c}',
  },
  pack('pan de molde', ['pan de molde', 'pan integral', 'pan de molde integral'], 'pan de molde', ['paquete', 'paquetes'], '450 g', 450, { eci: 'pan de molde' }),
  pack('pan de hamburguesa', ['pan de hamburguesa', 'panes de hamburguesa'], '', ['paquete de 4 panes de hamburguesa', 'paquetes de 4 panes de hamburguesa'], '', 4, { ug: 1, eci: 'pan de hamburguesa' }),
  pack('harina de fuerza', ['harina de fuerza'], 'harina de fuerza', ['paquete', 'paquetes'], '1 kg', 1000, { tier: 'especial', eci: 'harina de fuerza' }),
  pack('arroz', ['arroz', 'arroz de grano largo', 'arroz redondo', 'arroz bomba'], 'arroz', ['paquete', 'paquetes'], '1 kg', 1000, { eci: 'arroz' }),
  pack('pasta', ['pasta', 'macarrones', 'espaguetis', 'spaghetti'], 'pasta', ['paquete', 'paquetes'], '500 g', 500, { eci: 'pasta' }),
  pack('fideos', ['fideos', 'fideo'], 'fideos', ['paquete', 'paquetes'], '500 g', 500, { eci: 'fideos' }),
  pack('lentejas', ['lentejas', 'lenteja'], 'lentejas', ['paquete', 'paquetes'], '1 kg', 1000, { eci: 'lentejas', variants: [[/cocid/, 'lentejas cocidas']] }),
  pack('lentejas cocidas', ['lentejas cocidas'], 'lentejas cocidas', ['frasco', 'frascos'], '400 g', 400, { eci: 'lentejas cocidas' }),
  pack('garbanzos', ['garbanzos', 'garbanzo'], 'garbanzos', ['paquete', 'paquetes'], '1 kg', 1000, { eci: 'garbanzos', variants: [[/cocid/, 'garbanzos cocidos']] }),
  pack('garbanzos cocidos', ['garbanzos cocidos'], 'garbanzos cocidos', ['frasco', 'frascos'], '400 g', 400, { eci: 'garbanzos cocidos' }),
  pack('alubias', ['judias blancas', 'alubias', 'alubias blancas', 'judias rojas', 'alubias rojas'], 'alubia blanca', ['paquete', 'paquetes'], '1 kg', 1000, { eci: 'alubia blanca' }),
  pack('tomate triturado', ['tomate triturado'], 'tomate triturado', ['lata', 'latas'], '400 g', 400, { eci: 'tomate triturado' }),
  pack('tomate frito', ['tomate frito', 'salsa de tomate'], 'tomate frito', ['brik', 'briks'], '350 g', 350, { eci: 'tomate frito' }),
  pack('caldo de verduras', ['caldo de verduras'], 'caldo de verduras', ['brik', 'briks'], '1 l', 1000, { eci: 'caldo de verduras' }),
  pack('caldo de pollo', ['caldo de pollo', 'caldo de cocido'], 'caldo de pollo', ['brik', 'briks'], '1 l', 1000, { eci: 'caldo de pollo' }),
  pack('caldo de pescado', ['caldo de pescado', 'fumet'], 'caldo de pescado', ['brik', 'briks'], '1 l', 1000, { eci: 'caldo de pescado' }),
  pack('aceitunas negras', ['aceitunas negras', 'aceituna negra'], 'aceitunas negras sin hueso', ['lata', 'latas'], '150 g', 150, { ug: 4, eci: 'aceitunas negras sin hueso' }),
  pack('aceitunas verdes', ['aceitunas verdes', 'aceitunas', 'aceituna'], 'aceitunas verdes', ['lata', 'latas'], '150 g', 150, { ug: 4, eci: 'aceitunas verdes' }),
  pack('alcaparras', ['alcaparras', 'alcaparra'], 'alcaparras', ['frasco', 'frascos'], '80 g', 80, { tier: 'especial', eci: 'alcaparras' }),
  pack('pepinillos', ['pepinillo', 'pepinillos'], 'pepinillos', ['frasco', 'frascos'], '', 300, { eci: 'pepinillos' }),
  pack('atun', ['atun', 'atun en lata', 'atun en aceite'], 'atún en aceite de oliva', ['pack de 3 latas', 'packs de 3 latas'], '', 200, { eci: 'atun aceite de oliva pack 3' }),
  pack('guisantes', ['guisantes', 'guisante', 'guisantes congelados'], 'guisantes congelados', ['bolsa', 'bolsas'], '400 g', 400, { eci: 'guisantes congelados' }),
  pack('surimi', ['surimi', 'palitos de cangrejo', 'palitos de cangrejo (surimi)'], 'palitos de surimi', ['paquete', 'paquetes'], '250 g', 250, { eci: 'palitos de surimi' }),
  pack('tofu', ['tofu'], 'tofu', ['paquete', 'paquetes'], '250 g', 250, { eci: 'tofu' }),
  pack('avena', ['avena', 'copos de avena'], 'copos de avena', ['paquete', 'paquetes'], '500 g', 500, { eci: 'copos de avena' }),
  pack('quinoa', ['quinoa'], 'quinoa', ['paquete', 'paquetes'], '500 g', 500, { eci: 'quinoa' }),
  pack('cuscus', ['cuscus'], 'cuscús', ['paquete', 'paquetes'], '500 g', 500, { eci: 'cuscus' }),
  pack('almendras', ['almendras', 'almendra'], 'almendras', ['bolsa', 'bolsas'], '200 g', 200, { eci: 'almendras' }),
  pack('nueces', ['nueces', 'nuez'], 'nueces peladas', ['bolsa', 'bolsas'], '200 g', 200, { eci: 'nueces peladas' }),
  pack('pinones', ['pinones', 'pinon'], 'piñones', ['bolsa', 'bolsas'], '100 g', 100, { tier: 'especial', eci: 'piñones' }),
  pack('pasas', ['pasas', 'uvas pasas', 'ciruela pasa', 'ciruelas pasas'], 'pasas', ['bolsa', 'bolsas'], '200 g', 200, { eci: 'pasas' }),
  pack('sesamo', ['sesamo', 'semillas de sesamo'], 'semillas de sésamo', ['bolsa', 'bolsas'], '100 g', 100, { eci: 'semillas de sesamo' }),
  pack('miel', ['miel'], 'miel', ['bote', 'botes'], '500 g', 500, { eci: 'miel' }),
  pack('mostaza', ['mostaza'], 'mostaza', ['bote', 'botes'], '', 200, { eci: 'mostaza' }),
  pack('mayonesa', ['mayonesa'], 'mayonesa', ['bote', 'botes'], '', 450, { eci: 'mayonesa' }),
  pack('ketchup', ['ketchup'], 'ketchup', ['bote', 'botes'], '', 450, { eci: 'ketchup' }),
  pack('tahini', ['tahini', 'tahin'], 'tahini', ['bote', 'botes'], '', 300, { tier: 'especial', eci: 'tahini' }),
  pack('vino blanco', ['vino blanco'], 'vino blanco para cocinar', ['botella', 'botellas'], '75 cl', 750, { eci: 'vino blanco' }),
  pack('vino tinto', ['vino tinto'], 'vino tinto para cocinar', ['botella', 'botellas'], '75 cl', 750, { eci: 'vino tinto' }),
]

const DESPENSA: BuyRule[] = [
  pantry('sal', ['sal', 'sal fina', 'sal gorda', 'sal en escamas'], 'sal fina', ['paquete', 'paquetes'], '1 kg', 1000, { eci: 'sal fina' }),
  pantry('pimienta', ['pimienta', 'pimienta negra', 'pimienta blanca'], 'pimienta negra molida', ['bote', 'botes'], '', 50, { eci: 'pimienta negra molida' }),
  pantry('aceite de oliva', ['aceite de oliva', 'aceite de oliva virgen', 'aceite de oliva virgen extra', 'aceite', 'aove'], 'aceite de oliva virgen extra', ['botella', 'botellas'], '1 l', 1000, { eci: 'aceite de oliva virgen extra 1 l' }),
  pantry('aceite de girasol', ['aceite de girasol'], 'aceite de girasol', ['botella', 'botellas'], '1 l', 1000, { eci: 'aceite de girasol' }),
  pantry('aceite de sesamo', ['aceite de sesamo'], 'aceite de sésamo', ['botella', 'botellas'], '250 ml', 250, { eci: 'aceite de sesamo', tier: 'especial', shop: 'supermercado' }),
  pantry('vinagre', ['vinagre', 'vinagre de vino', 'vinagre balsamico', 'vinagre de sidra', 'vinagre de jerez'], 'vinagre de vino', ['botella', 'botellas'], '1 l', 1000, { eci: 'vinagre de vino' }),
  pantry('azucar', ['azucar', 'azucar blanco', 'azucar moreno'], 'azúcar', ['paquete', 'paquetes'], '1 kg', 1000, { eci: 'azucar blanco' }),
  pantry('harina', ['harina', 'harina de trigo'], 'harina de trigo', ['paquete', 'paquetes'], '1 kg', 1000, { eci: 'harina de trigo' }),
  pantry('salsa de soja', ['salsa de soja', 'soja'], 'salsa de soja', ['botella', 'botellas'], '250 ml', 250, { eci: 'salsa de soja' }),
  pantry('especias', ['oregano', 'comino', 'canela', 'curcuma', 'pimenton', 'pimenton dulce', 'pimenton picante', 'laurel', 'nuez moscada', 'tomillo seco', 'romero seco', 'azafran', 'clavo', 'jengibre molido', 'curry', 'hierbas provenzales'], '{name}', ['bote', 'botes'], '', 40, { eci: '{name}' }),
  pantry('levadura', ['levadura', 'levadura quimica', 'levadura de panaderia', 'bicarbonato'], 'levadura', ['sobre', 'sobres'], '', 15, { eci: 'levadura' }),
  pantry('agua', ['agua'], 'agua', ['botella', 'botellas'], '', 1500),
  pantry('salsas', ['salsa worcestershire', 'salsa sriracha', 'vino de jerez', 'sirope de arce', 'pasta de tomate', 'tomate concentrado'], '{name}', ['bote', 'botes'], '', 150, { eci: '{name}', shop: 'supermercado', tier: 'normal' }),
]

export const BUY_RULES: BuyRule[] = [...FRUTERIA, ...CARNICERIA, ...CHARCUTERIA, ...PESCADERIA, ...SUPER, ...DESPENSA]

export const MEAT_PREP_WORDS = MEAT_PREP
