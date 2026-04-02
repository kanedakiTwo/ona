// Seed recipes for the ONA catalog (authorId = null)
// ingredientNames will be resolved to IDs during seeding

export interface SeedRecipe {
  name: string
  prepTime: number
  meals: string[]
  seasons: string[]
  tags: string[]
  steps: string[]
  ingredients: Array<{ name: string; quantity: number; unit: string }>
}

export const seedRecipes: SeedRecipe[] = [
  {
    name: 'Espaguetis con ajo y aceite',
    prepTime: 15,
    meals: ['lunch', 'dinner'],
    seasons: ['spring', 'summer', 'autumn', 'winter'],
    tags: ['rapido', 'vegetariano', 'italiano'],
    steps: [
      'Cocer la pasta en agua con sal',
      'Dorar el ajo laminado en aceite de oliva',
      'Escurrir la pasta y saltear con el ajo',
      'Servir con queso parmesano rallado',
    ],
    ingredients: [
      { name: 'pasta', quantity: 100, unit: 'g' },
      { name: 'ajo', quantity: 10, unit: 'g' },
      { name: 'aceite de oliva virgen', quantity: 15, unit: 'g' },
      { name: 'queso parmesano', quantity: 15, unit: 'g' },
    ],
  },
  {
    name: 'Pollo a la plancha con brocoli',
    prepTime: 20,
    meals: ['lunch', 'dinner'],
    seasons: ['autumn', 'winter'],
    tags: ['saludable', 'proteina', 'rapido'],
    steps: [
      'Salpimentar la pechuga de pollo',
      'Cocinar a la plancha 5-6 min por lado',
      'Hervir el brocoli al vapor 5 minutos',
      'Servir con un chorrito de aceite de oliva',
    ],
    ingredients: [
      { name: 'pollo', quantity: 150, unit: 'g' },
      { name: 'brocoli', quantity: 200, unit: 'g' },
      { name: 'aceite de oliva virgen', quantity: 10, unit: 'g' },
    ],
  },
  {
    name: 'Tortilla de patatas',
    prepTime: 30,
    meals: ['lunch', 'dinner'],
    seasons: ['spring', 'summer', 'autumn', 'winter'],
    tags: ['clasico', 'espanol'],
    steps: [
      'Pelar y cortar las patatas en rodajas finas',
      'Freir las patatas en aceite a fuego medio',
      'Batir los huevos con sal',
      'Mezclar patatas con huevo y cuajar en sarten',
    ],
    ingredients: [
      { name: 'patata', quantity: 200, unit: 'g' },
      { name: 'huevo', quantity: 120, unit: 'g' },
      { name: 'cebolla', quantity: 80, unit: 'g' },
      { name: 'aceite de oliva virgen', quantity: 30, unit: 'g' },
    ],
  },
  {
    name: 'Salmon al horno con patatas',
    prepTime: 35,
    meals: ['lunch', 'dinner'],
    seasons: ['autumn', 'winter'],
    tags: ['pescado', 'horno', 'saludable'],
    steps: [
      'Precalentar horno a 200C',
      'Cortar patatas en rodajas y disponer en bandeja',
      'Colocar el salmon encima',
      'Hornear 25 minutos',
    ],
    ingredients: [
      { name: 'salmon', quantity: 150, unit: 'g' },
      { name: 'patata', quantity: 200, unit: 'g' },
      { name: 'aceite de oliva virgen', quantity: 10, unit: 'g' },
      { name: 'cebolla', quantity: 50, unit: 'g' },
    ],
  },
  {
    name: 'Lentejas estofadas',
    prepTime: 45,
    meals: ['lunch'],
    seasons: ['autumn', 'winter'],
    tags: ['legumbre', 'reconfortante', 'saludable'],
    steps: [
      'Sofreir cebolla, zanahoria y ajo',
      'Anadir las lentejas y cubrir con agua',
      'Cocer a fuego lento 40 minutos',
      'Salpimentar al gusto',
    ],
    ingredients: [
      { name: 'lentejas', quantity: 100, unit: 'g' },
      { name: 'zanahoria', quantity: 80, unit: 'g' },
      { name: 'patata', quantity: 100, unit: 'g' },
      { name: 'cebolla', quantity: 60, unit: 'g' },
      { name: 'ajo', quantity: 5, unit: 'g' },
      { name: 'aceite de oliva virgen', quantity: 10, unit: 'g' },
    ],
  },
  {
    name: 'Ensalada de atun',
    prepTime: 10,
    meals: ['lunch', 'dinner'],
    seasons: ['spring', 'summer'],
    tags: ['rapido', 'ligero', 'saludable'],
    steps: [
      'Lavar y cortar el tomate y la cebolla',
      'Escurrir el atun',
      'Mezclar todo con aceite y sal',
    ],
    ingredients: [
      { name: 'atun', quantity: 100, unit: 'g' },
      { name: 'tomate', quantity: 150, unit: 'g' },
      { name: 'cebolla', quantity: 40, unit: 'g' },
      { name: 'aceite de oliva virgen', quantity: 10, unit: 'g' },
    ],
  },
  {
    name: 'Garbanzos con espinacas',
    prepTime: 25,
    meals: ['lunch'],
    seasons: ['spring', 'winter'],
    tags: ['legumbre', 'vegetariano', 'saludable'],
    steps: [
      'Sofreir ajo y cebolla',
      'Anadir los garbanzos cocidos',
      'Incorporar las espinacas',
      'Cocinar 10 minutos',
    ],
    ingredients: [
      { name: 'garbanzos', quantity: 120, unit: 'g' },
      { name: 'espinacas', quantity: 150, unit: 'g' },
      { name: 'ajo', quantity: 5, unit: 'g' },
      { name: 'cebolla', quantity: 50, unit: 'g' },
      { name: 'aceite de oliva virgen', quantity: 10, unit: 'g' },
    ],
  },
  {
    name: 'Revuelto de calabacin',
    prepTime: 15,
    meals: ['dinner'],
    seasons: ['spring', 'summer'],
    tags: ['rapido', 'ligero', 'vegetariano'],
    steps: [
      'Cortar el calabacin en dados',
      'Saltear en aceite de oliva',
      'Batir huevos y anadir al calabacin',
      'Revolver hasta cuajar',
    ],
    ingredients: [
      { name: 'calabacin', quantity: 200, unit: 'g' },
      { name: 'huevo', quantity: 100, unit: 'g' },
      { name: 'aceite de oliva virgen', quantity: 10, unit: 'g' },
    ],
  },
  {
    name: 'Arroz con pollo',
    prepTime: 30,
    meals: ['lunch'],
    seasons: ['spring', 'summer', 'autumn', 'winter'],
    tags: ['clasico', 'completo'],
    steps: [
      'Sofreir pollo troceado',
      'Anadir cebolla, pimiento y ajo',
      'Incorporar arroz y caldo',
      'Cocer 18 minutos',
    ],
    ingredients: [
      { name: 'arroz', quantity: 100, unit: 'g' },
      { name: 'pollo', quantity: 120, unit: 'g' },
      { name: 'pimiento rojo', quantity: 60, unit: 'g' },
      { name: 'cebolla', quantity: 50, unit: 'g' },
      { name: 'ajo', quantity: 5, unit: 'g' },
      { name: 'aceite de oliva virgen', quantity: 10, unit: 'g' },
    ],
  },
  {
    name: 'Tostadas con aguacate y huevo',
    prepTime: 10,
    meals: ['breakfast'],
    seasons: ['autumn', 'winter'],
    tags: ['rapido', 'desayuno', 'saludable'],
    steps: [
      'Tostar el pan',
      'Machacar el aguacate con sal y limon',
      'Hacer huevo a la plancha',
      'Montar sobre la tostada',
    ],
    ingredients: [
      { name: 'pan integral', quantity: 60, unit: 'g' },
      { name: 'aguacate', quantity: 80, unit: 'g' },
      { name: 'huevo', quantity: 60, unit: 'g' },
    ],
  },
  {
    name: 'Porridge de avena con platano',
    prepTime: 10,
    meals: ['breakfast'],
    seasons: ['spring', 'summer', 'autumn', 'winter'],
    tags: ['rapido', 'desayuno', 'saludable'],
    steps: [
      'Calentar leche en un cazo',
      'Anadir avena y cocinar 5 min removiendo',
      'Servir con platano en rodajas',
    ],
    ingredients: [
      { name: 'avena', quantity: 50, unit: 'g' },
      { name: 'leche entera', quantity: 200, unit: 'g' },
      { name: 'platano', quantity: 100, unit: 'g' },
    ],
  },
  {
    name: 'Crema de zanahoria',
    prepTime: 25,
    meals: ['dinner'],
    seasons: ['autumn', 'winter'],
    tags: ['ligero', 'vegetariano', 'reconfortante'],
    steps: [
      'Sofreir cebolla y ajo',
      'Anadir zanahorias troceadas y patata',
      'Cubrir con agua y cocer 20 min',
      'Triturar y servir con un chorrito de aceite',
    ],
    ingredients: [
      { name: 'zanahoria', quantity: 250, unit: 'g' },
      { name: 'patata', quantity: 100, unit: 'g' },
      { name: 'cebolla', quantity: 50, unit: 'g' },
      { name: 'ajo', quantity: 5, unit: 'g' },
      { name: 'aceite de oliva virgen', quantity: 10, unit: 'g' },
    ],
  },
  {
    name: 'Ternera con pimientos',
    prepTime: 25,
    meals: ['lunch', 'dinner'],
    seasons: ['summer', 'autumn'],
    tags: ['proteina', 'saludable'],
    steps: [
      'Cortar la ternera en tiras',
      'Saltear a fuego fuerte',
      'Anadir pimiento rojo en tiras',
      'Cocinar 5 min mas con soja',
    ],
    ingredients: [
      { name: 'ternera', quantity: 150, unit: 'g' },
      { name: 'pimiento rojo', quantity: 100, unit: 'g' },
      { name: 'cebolla', quantity: 50, unit: 'g' },
      { name: 'aceite de oliva virgen', quantity: 10, unit: 'g' },
    ],
  },
  {
    name: 'Coliflor gratinada',
    prepTime: 30,
    meals: ['dinner'],
    seasons: ['autumn', 'winter'],
    tags: ['horno', 'vegetariano'],
    steps: [
      'Hervir la coliflor 10 minutos',
      'Preparar bechamel con mantequilla, harina y leche',
      'Colocar coliflor en bandeja, cubrir con bechamel y queso',
      'Gratinar 10 minutos',
    ],
    ingredients: [
      { name: 'coliflor', quantity: 300, unit: 'g' },
      { name: 'leche entera', quantity: 150, unit: 'g' },
      { name: 'mantequilla', quantity: 15, unit: 'g' },
      { name: 'harina de trigo', quantity: 15, unit: 'g' },
      { name: 'queso parmesano', quantity: 30, unit: 'g' },
    ],
  },
  {
    name: 'Yogur con avena y manzana',
    prepTime: 5,
    meals: ['breakfast', 'snack'],
    seasons: ['autumn', 'winter'],
    tags: ['rapido', 'saludable', 'snack'],
    steps: [
      'Poner yogur en un bol',
      'Anadir avena y manzana troceada',
    ],
    ingredients: [
      { name: 'yogur natural', quantity: 125, unit: 'g' },
      { name: 'avena', quantity: 30, unit: 'g' },
      { name: 'manzana', quantity: 100, unit: 'g' },
    ],
  },
]
