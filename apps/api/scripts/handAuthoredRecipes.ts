#!/usr/bin/env tsx
/**
 * 26 hand-authored recipes that the regen pipeline didn't get to (and
 * couldn't have anyway — the original seed had `ingredients: []` and
 * `steps: []` for these). Authored manually with proper culinary detail
 * and resolved against the live catalog.
 *
 * Usage:
 *   pnpm --filter @ona/api ts-node scripts/handAuthoredRecipes.ts
 *   → appends entries to scripts/output/regen-passed.jsonl
 *   then run apply:recipes --force
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { db, pool } from '../src/db/connection.js'
import { ingredients } from '../src/db/schema.js'

interface IngLine {
  name: string
  qty: number
  unit: 'g' | 'ml' | 'u' | 'cda' | 'cdita' | 'pizca' | 'al_gusto'
  optional?: boolean
  note?: string
  section?: string
}

interface StepLine {
  text: string
  durationMin?: number
  temperature?: number
  technique?: string
  refs?: string[] // ingredient names referenced
}

interface AuthoredRecipe {
  name: string
  servings: number
  yieldText?: string
  prepTime?: number
  cookTime?: number
  activeTime?: number
  difficulty: 'easy' | 'medium' | 'hard'
  meals: string[]
  seasons: string[]
  equipment: string[]
  tags?: string[]
  notes?: string
  tips?: string
  substitutions?: string
  storage?: string
  ingredients: IngLine[]
  steps: StepLine[]
}

// ── 26 hand-authored recipes ─────────────────────────────────────

const RECIPES: AuthoredRecipe[] = [
  {
    name: 'Arroz con bacalao',
    servings: 4,
    prepTime: 15, cookTime: 25, difficulty: 'medium',
    meals: ['lunch', 'dinner'], seasons: ['autumn', 'winter'],
    equipment: ['paellera', 'cazuela'],
    tags: ['arroces', 'pescado'],
    notes: 'Plato tradicional de la costa del Mediterráneo. El bacalao desalado conserva una textura más firme que el fresco.',
    ingredients: [
      { name: 'arroz', qty: 320, unit: 'g' },
      { name: 'bacalao', qty: 400, unit: 'g', note: 'desmigado' },
      { name: 'cebolla', qty: 100, unit: 'g', note: 'picada fina' },
      { name: 'ajo', qty: 8, unit: 'g', note: 'picado' },
      { name: 'tomate triturado', qty: 200, unit: 'g' },
      { name: 'pimiento rojo', qty: 100, unit: 'g', note: 'en tiras' },
      { name: 'guisantes', qty: 80, unit: 'g' },
      { name: 'caldo de verduras', qty: 800, unit: 'ml', note: 'caliente' },
      { name: 'aceite de oliva virgen', qty: 30, unit: 'ml' },
      { name: 'pimenton dulce', qty: 1, unit: 'cdita' },
      { name: 'sal', qty: 1, unit: 'al_gusto' },
    ],
    steps: [
      { text: 'Calentar el aceite en la paellera y sofreír la cebolla y el ajo a fuego medio.', durationMin: 5, technique: 'sofreír', refs: ['cebolla', 'ajo', 'aceite de oliva virgen'] },
      { text: 'Añadir el pimiento rojo en tiras y rehogar hasta que esté blando.', durationMin: 5, technique: 'rehogar', refs: ['pimiento rojo'] },
      { text: 'Incorporar el tomate triturado y el pimentón. Cocinar 3 minutos removiendo.', durationMin: 3, technique: 'sofreír', refs: ['tomate triturado', 'pimenton dulce'] },
      { text: 'Añadir el arroz y dorarlo brevemente, removiendo para que se impregne.', durationMin: 2, technique: 'sofreír', refs: ['arroz'] },
      { text: 'Verter el caldo caliente y los guisantes. Subir el fuego para que rompa a hervir.', durationMin: 2, refs: ['caldo de verduras', 'guisantes'] },
      { text: 'Bajar a fuego medio-bajo, añadir el bacalao desmigado distribuido, salar al gusto y cocer sin remover.', durationMin: 18, technique: 'cocer', refs: ['bacalao', 'sal'] },
      { text: 'Apagar el fuego y dejar reposar 5 minutos tapado con un paño.', durationMin: 5 },
    ],
  },
  {
    name: 'Alitas de pollo al horno',
    servings: 4,
    yieldText: '≈ 16 alitas',
    prepTime: 10, cookTime: 40, difficulty: 'easy',
    meals: ['lunch', 'dinner'], seasons: ['spring', 'summer', 'autumn', 'winter'],
    equipment: ['horno', 'bandeja'],
    tags: ['horno', 'pollo'],
    notes: 'Marinado mínimo: si dispones de tiempo, deja reposar 1-2 horas para que la salsa penetre.',
    ingredients: [
      { name: 'pollo', qty: 800, unit: 'g', note: 'alitas enteras' },
      { name: 'salsa de soja', qty: 30, unit: 'ml' },
      { name: 'miel', qty: 30, unit: 'g' },
      { name: 'ajo', qty: 10, unit: 'g', note: 'picado' },
      { name: 'jengibre fresco', qty: 10, unit: 'g', note: 'rallado' },
      { name: 'aceite de oliva virgen', qty: 15, unit: 'ml' },
      { name: 'pimenton dulce', qty: 1, unit: 'cdita' },
      { name: 'sesamo', qty: 5, unit: 'g', optional: true, note: 'para decorar' },
      { name: 'pimienta negra', qty: 1, unit: 'al_gusto' },
      { name: 'sal', qty: 1, unit: 'al_gusto' },
    ],
    steps: [
      { text: 'Precalentar el horno a 200 °C con calor arriba y abajo.', durationMin: 10, temperature: 200 },
      { text: 'Mezclar en un bol la salsa de soja, miel, ajo, jengibre, aceite, pimentón, sal y pimienta.', durationMin: 3, refs: ['salsa de soja', 'miel', 'ajo', 'jengibre fresco', 'aceite de oliva virgen', 'pimenton dulce'] },
      { text: 'Añadir las alitas al bol y mezclar hasta cubrirlas bien.', durationMin: 2, refs: ['pollo'] },
      { text: 'Disponer las alitas en una bandeja con papel de horno, separadas.', durationMin: 2 },
      { text: 'Hornear 35-40 minutos volteando a media cocción hasta que estén doradas y crujientes.', durationMin: 38, temperature: 200, technique: 'hornear' },
      { text: 'Servir espolvoreadas con sésamo si se desea.', refs: ['sesamo'] },
    ],
  },
  {
    name: 'Vichyssoise',
    servings: 4,
    prepTime: 15, cookTime: 30, difficulty: 'easy',
    meals: ['lunch', 'dinner'], seasons: ['spring', 'summer'],
    equipment: ['olla', 'batidora'],
    tags: ['frio', 'crema'],
    notes: 'Crema fría francesa. Servir bien fría — al menos 2 h en nevera.',
    storage: 'Hasta 3 días en nevera. No conviene congelar (la nata se separa).',
    ingredients: [
      { name: 'puerro', qty: 400, unit: 'g', note: 'parte blanca' },
      { name: 'patata', qty: 300, unit: 'g', note: 'pelada y troceada' },
      { name: 'cebolla', qty: 100, unit: 'g', note: 'picada' },
      { name: 'mantequilla', qty: 30, unit: 'g' },
      { name: 'caldo de verduras', qty: 800, unit: 'ml' },
      { name: 'nata liquida', qty: 200, unit: 'ml' },
      { name: 'perejil', qty: 1, unit: 'al_gusto', optional: true, note: 'para decorar (o cebollino)' },
      { name: 'sal', qty: 1, unit: 'al_gusto' },
      { name: 'pimienta negra', qty: 1, unit: 'al_gusto' },
    ],
    steps: [
      { text: 'Lavar bien los puerros y cortar la parte blanca en rodajas finas.', durationMin: 5, refs: ['puerro'] },
      { text: 'Derretir la mantequilla en la olla y rehogar la cebolla y el puerro a fuego suave sin que cojan color.', durationMin: 8, technique: 'pochar', refs: ['mantequilla', 'cebolla', 'puerro'] },
      { text: 'Añadir las patatas troceadas y el caldo. Hervir y cocer hasta que la patata esté tierna.', durationMin: 22, technique: 'cocer', refs: ['patata', 'caldo de verduras'] },
      { text: 'Triturar con batidora hasta obtener una crema fina.', durationMin: 3, technique: 'triturar' },
      { text: 'Añadir la nata, salpimentar y mezclar. Enfriar al menos 2 horas en nevera.', refs: ['nata liquida', 'sal', 'pimienta negra'] },
      { text: 'Servir muy fría, decorada con cebollino picado.', refs: ['cebollino'] },
    ],
  },
  {
    name: 'Dorada a la marsellesa',
    servings: 4,
    prepTime: 15, cookTime: 25, difficulty: 'medium',
    meals: ['lunch', 'dinner'], seasons: ['spring', 'summer', 'autumn'],
    equipment: ['horno', 'fuente'],
    tags: ['pescado', 'horno'],
    notes: 'Receta provenzal con hierbas frescas y vino blanco.',
    ingredients: [
      { name: 'salmon', qty: 800, unit: 'g', note: 'use dorada limpia, 2 piezas medianas — sin vendor en catálogo, fallback a pescado magro' },
      { name: 'tomate', qty: 300, unit: 'g', note: 'en rodajas' },
      { name: 'cebolla', qty: 150, unit: 'g', note: 'en rodajas finas' },
      { name: 'ajo', qty: 8, unit: 'g', note: 'laminado' },
      { name: 'aceitunas negras', qty: 60, unit: 'g' },
      { name: 'vino blanco', qty: 100, unit: 'ml' },
      { name: 'aceite de oliva virgen', qty: 40, unit: 'ml' },
      { name: 'tomillo', qty: 1, unit: 'al_gusto', note: 'fresco' },
      { name: 'romero', qty: 1, unit: 'al_gusto', note: 'fresco' },
      { name: 'limon', qty: 1, unit: 'u', note: 'en rodajas' },
      { name: 'sal', qty: 1, unit: 'al_gusto' },
      { name: 'pimienta negra', qty: 1, unit: 'al_gusto' },
    ],
    steps: [
      { text: 'Precalentar el horno a 190 °C.', durationMin: 10, temperature: 190 },
      { text: 'Engrasar una fuente con aceite y disponer la cebolla y el tomate en capas en el fondo.', refs: ['cebolla', 'tomate', 'aceite de oliva virgen'] },
      { text: 'Salpimentar el pescado por dentro y fuera. Colocarlo encima de la cama de verduras.', refs: ['salmon', 'sal', 'pimienta negra'] },
      { text: 'Distribuir ajo laminado, aceitunas, hierbas y rodajas de limón sobre el pescado.', refs: ['ajo', 'aceitunas negras', 'tomillo', 'romero', 'limon'] },
      { text: 'Regar con el vino blanco y un hilo de aceite. Cubrir con papel de horno.', refs: ['vino blanco'] },
      { text: 'Hornear 20-25 minutos hasta que el pescado esté hecho. Servir con el jugo de la fuente.', durationMin: 22, temperature: 190, technique: 'hornear' },
    ],
  },
  {
    name: 'Verduras estofadas',
    servings: 4,
    prepTime: 15, cookTime: 35, difficulty: 'easy',
    meals: ['lunch', 'dinner'], seasons: ['autumn', 'winter'],
    equipment: ['cazuela'],
    tags: ['verduras', 'guiso'],
    ingredients: [
      { name: 'patata', qty: 400, unit: 'g', note: 'en taquitos' },
      { name: 'zanahoria', qty: 200, unit: 'g', note: 'en rodajas' },
      { name: 'cebolla', qty: 150, unit: 'g', note: 'picada' },
      { name: 'puerro', qty: 100, unit: 'g', note: 'en rodajas' },
      { name: 'ajo', qty: 8, unit: 'g' },
      { name: 'tomate triturado', qty: 200, unit: 'g' },
      { name: 'guisantes', qty: 100, unit: 'g' },
      { name: 'caldo de verduras', qty: 500, unit: 'ml' },
      { name: 'aceite de oliva virgen', qty: 30, unit: 'ml' },
      { name: 'pimenton dulce', qty: 1, unit: 'cdita' },
      { name: 'laurel', qty: 1, unit: 'u' },
      { name: 'sal', qty: 1, unit: 'al_gusto' },
    ],
    steps: [
      { text: 'Sofreír cebolla, ajo y puerro en aceite a fuego medio.', durationMin: 8, technique: 'sofreír', refs: ['cebolla', 'ajo', 'puerro', 'aceite de oliva virgen'] },
      { text: 'Añadir la zanahoria y dorar 5 minutos.', durationMin: 5, refs: ['zanahoria'] },
      { text: 'Incorporar pimentón y tomate, cocinar 3 minutos.', durationMin: 3, refs: ['pimenton dulce', 'tomate triturado'] },
      { text: 'Añadir patata, laurel, caldo y sal. Llevar a ebullición y bajar fuego.', durationMin: 5, refs: ['patata', 'laurel', 'caldo de verduras', 'sal'] },
      { text: 'Cocer tapado a fuego suave 20 minutos.', durationMin: 20, technique: 'cocer' },
      { text: 'Añadir guisantes los últimos 5 minutos para que queden enteros.', durationMin: 5, refs: ['guisantes'] },
    ],
  },
  {
    name: 'Sopa juliana',
    servings: 4,
    prepTime: 15, cookTime: 30, difficulty: 'easy',
    meals: ['lunch', 'dinner'], seasons: ['autumn', 'winter'],
    equipment: ['olla'],
    tags: ['sopa', 'verduras'],
    notes: 'Verduras cortadas en juliana fina. Se sirve con el caldo y las verduras enteras.',
    ingredients: [
      { name: 'puerro', qty: 200, unit: 'g', note: 'en juliana' },
      { name: 'zanahoria', qty: 150, unit: 'g', note: 'en juliana' },
      { name: 'cebolla', qty: 100, unit: 'g', note: 'en juliana' },
      { name: 'apio', qty: 100, unit: 'g', note: 'en juliana' },
      { name: 'patata', qty: 200, unit: 'g', note: 'en taquitos pequeños' },
      { name: 'caldo de verduras', qty: 1500, unit: 'ml' },
      { name: 'aceite de oliva virgen', qty: 20, unit: 'ml' },
      { name: 'perejil', qty: 1, unit: 'al_gusto', optional: true },
      { name: 'sal', qty: 1, unit: 'al_gusto' },
      { name: 'pimienta negra', qty: 1, unit: 'al_gusto' },
    ],
    steps: [
      { text: 'Cortar todas las verduras en juliana fina (5 cm de largo, 3 mm de grosor).', durationMin: 12 },
      { text: 'Pochar puerro, cebolla y apio en aceite a fuego suave 8 minutos.', durationMin: 8, technique: 'pochar', refs: ['puerro', 'cebolla', 'apio', 'aceite de oliva virgen'] },
      { text: 'Añadir zanahoria y patata, rehogar 3 minutos más.', durationMin: 3, refs: ['zanahoria', 'patata'] },
      { text: 'Verter el caldo, salpimentar y llevar a ebullición.', durationMin: 5, refs: ['caldo de verduras', 'sal', 'pimienta negra'] },
      { text: 'Cocer a fuego medio 15 minutos hasta que las verduras estén tiernas.', durationMin: 15, technique: 'cocer' },
      { text: 'Servir caliente con perejil picado por encima.', refs: ['perejil'] },
    ],
  },
  {
    name: 'Onigirazu',
    servings: 2,
    yieldText: '4 sandwiches',
    prepTime: 25, cookTime: 15, difficulty: 'medium',
    meals: ['lunch', 'dinner'], seasons: ['spring', 'summer', 'autumn', 'winter'],
    equipment: ['olla'],
    tags: ['japon', 'sandwich'],
    notes: 'Sándwich de sushi. Cada onigirazu lleva una capa de relleno entre dos capas de arroz envueltas en alga nori.',
    ingredients: [
      { name: 'arroz', qty: 200, unit: 'g', note: 'tipo japonés o redondo, lavado' },
      { name: 'salmon', qty: 200, unit: 'g', note: 'fresco, sashimi grade' },
      { name: 'aguacate', qty: 1, unit: 'u', note: 'maduro, en láminas' },
      { name: 'pepino', qty: 100, unit: 'g', note: 'en juliana' },
      { name: 'salsa de soja', qty: 30, unit: 'ml' },
      { name: 'sesamo', qty: 5, unit: 'g' },
      { name: 'vinagre de vino', qty: 20, unit: 'ml', note: 'mejor de arroz si tienes' },
      { name: 'azucar', qty: 5, unit: 'g' },
      { name: 'sal', qty: 2, unit: 'g' },
    ],
    steps: [
      { text: 'Lavar el arroz hasta que el agua salga clara. Cocer con 250 ml de agua tapado 12 min, reposar 10 min.', durationMin: 22, technique: 'cocer', refs: ['arroz'] },
      { text: 'Calentar vinagre, azúcar y sal hasta disolver. Mezclar con el arroz caliente.', durationMin: 3, refs: ['vinagre de vino', 'azucar', 'sal'] },
      { text: 'Cortar el salmón en lonchas finas. Aliñar con la mitad de la soja.', durationMin: 5, refs: ['salmon', 'salsa de soja'] },
      { text: 'Sobre una hoja de nori, formar capa de arroz, salmón, aguacate, pepino, otra capa de arroz.', durationMin: 8, refs: ['aguacate', 'pepino'] },
      { text: 'Cerrar las puntas del nori sobre el arroz, prensar y cortar por la mitad. Espolvorear sésamo.', durationMin: 3, refs: ['sesamo'] },
    ],
  },
  {
    name: 'Espinacas a la crema',
    servings: 4,
    prepTime: 10, cookTime: 15, difficulty: 'easy',
    meals: ['lunch', 'dinner'], seasons: ['autumn', 'winter'],
    equipment: ['sartén'],
    tags: ['verduras', 'lacteo'],
    ingredients: [
      { name: 'espinacas', qty: 600, unit: 'g', note: 'frescas o congeladas' },
      { name: 'cebolla', qty: 100, unit: 'g', note: 'picada fina' },
      { name: 'ajo', qty: 8, unit: 'g' },
      { name: 'nata liquida', qty: 200, unit: 'ml' },
      { name: 'queso parmesano', qty: 40, unit: 'g', note: 'rallado' },
      { name: 'mantequilla', qty: 20, unit: 'g' },
      { name: 'nuez moscada', qty: 1, unit: 'pizca' },
      { name: 'sal', qty: 1, unit: 'al_gusto' },
      { name: 'pimienta negra', qty: 1, unit: 'al_gusto' },
    ],
    steps: [
      { text: 'Si las espinacas son frescas: blanquearlas 1 min en agua hirviendo, escurrir y picar.', durationMin: 5, refs: ['espinacas'] },
      { text: 'Derretir mantequilla en sartén. Pochar cebolla y ajo a fuego medio sin dorar.', durationMin: 6, technique: 'pochar', refs: ['mantequilla', 'cebolla', 'ajo'] },
      { text: 'Añadir las espinacas y rehogar 3 minutos.', durationMin: 3, technique: 'rehogar' },
      { text: 'Verter la nata, parmesano, nuez moscada, sal y pimienta. Cocer 5 minutos hasta espesar.', durationMin: 5, refs: ['nata liquida', 'queso parmesano', 'nuez moscada', 'sal', 'pimienta negra'] },
    ],
  },
  {
    name: 'Curry de patatas y guisantes',
    servings: 4,
    prepTime: 15, cookTime: 30, difficulty: 'easy',
    meals: ['lunch', 'dinner'], seasons: ['spring', 'autumn', 'winter'],
    equipment: ['cazuela'],
    tags: ['curry', 'vegetariano'],
    notes: 'Inspirado en aloo matar. Si no tienes garam masala, mezcla canela, comino y nuez moscada.',
    ingredients: [
      { name: 'patata', qty: 600, unit: 'g', note: 'en taquitos de 2 cm' },
      { name: 'guisantes', qty: 200, unit: 'g' },
      { name: 'cebolla', qty: 200, unit: 'g', note: 'picada' },
      { name: 'ajo', qty: 10, unit: 'g' },
      { name: 'jengibre fresco', qty: 15, unit: 'g', note: 'rallado' },
      { name: 'tomate triturado', qty: 300, unit: 'g' },
      { name: 'aceite de oliva virgen', qty: 30, unit: 'ml' },
      { name: 'comino', qty: 1, unit: 'cdita' },
      { name: 'curcuma', qty: 1, unit: 'cdita' },
      { name: 'pimenton dulce', qty: 1, unit: 'cdita' },
      { name: 'caldo de verduras', qty: 300, unit: 'ml' },
      { name: 'sal', qty: 1, unit: 'al_gusto' },
      { name: 'cilantro', qty: 1, unit: 'al_gusto', optional: true },
    ],
    steps: [
      { text: 'Sofreír cebolla en aceite a fuego medio hasta dorar.', durationMin: 8, technique: 'sofreír', refs: ['cebolla', 'aceite de oliva virgen'] },
      { text: 'Añadir ajo, jengibre y especias. Tostar 1 minuto.', durationMin: 1, refs: ['ajo', 'jengibre fresco', 'comino', 'curcuma', 'pimenton dulce'] },
      { text: 'Incorporar tomate triturado y cocinar 5 minutos.', durationMin: 5, refs: ['tomate triturado'] },
      { text: 'Añadir patatas, caldo y sal. Llevar a ebullición.', durationMin: 3, refs: ['patata', 'caldo de verduras', 'sal'] },
      { text: 'Tapar y cocer 20 minutos hasta que la patata esté tierna.', durationMin: 20, technique: 'cocer' },
      { text: 'Añadir guisantes los últimos 5 minutos. Servir con cilantro fresco.', durationMin: 5, refs: ['guisantes', 'cilantro'] },
    ],
  },
  {
    name: 'Wrap de lechuga con noodles',
    servings: 2,
    prepTime: 15, cookTime: 10, difficulty: 'easy',
    meals: ['lunch', 'dinner'], seasons: ['spring', 'summer'],
    equipment: ['olla'],
    tags: ['asia', 'fresco'],
    notes: 'Versión ligera. Las hojas de lechuga sustituyen al pan o tortilla.',
    ingredients: [
      { name: 'lechuga', qty: 200, unit: 'g', note: 'hojas grandes y firmes' },
      { name: 'fideos', qty: 150, unit: 'g', note: 'finos tipo soba o arroz' },
      { name: 'pollo', qty: 200, unit: 'g', note: 'en tiras' },
      { name: 'zanahoria', qty: 100, unit: 'g', note: 'rallada' },
      { name: 'pepino', qty: 100, unit: 'g', note: 'en juliana' },
      { name: 'salsa de soja', qty: 30, unit: 'ml' },
      { name: 'lima', qty: 1, unit: 'u' },
      { name: 'jengibre fresco', qty: 5, unit: 'g' },
      { name: 'aceite de oliva virgen', qty: 15, unit: 'ml' },
      { name: 'cilantro', qty: 1, unit: 'al_gusto', optional: true },
      { name: 'almendras', qty: 30, unit: 'g', optional: true, note: 'picadas (o cacahuetes)' },
    ],
    steps: [
      { text: 'Cocer los fideos según instrucciones del paquete, escurrir y enfriar bajo agua.', durationMin: 6, technique: 'cocer', refs: ['fideos'] },
      { text: 'Saltear el pollo con un poco de aceite y soja a fuego fuerte 5 minutos.', durationMin: 5, technique: 'saltear', refs: ['pollo', 'aceite de oliva virgen', 'salsa de soja'] },
      { text: 'Mezclar fideos fríos con zanahoria, pepino, jengibre rallado y zumo de lima.', durationMin: 3, refs: ['zanahoria', 'pepino', 'jengibre fresco', 'lima'] },
      { text: 'Servir las hojas de lechuga rellenándolas con la mezcla de fideos y el pollo. Espolvorear cilantro y cacahuetes.', refs: ['lechuga', 'cilantro', 'cacahuetes'] },
    ],
  },
  {
    name: 'Berenjenas rellenas',
    servings: 4,
    prepTime: 20, cookTime: 50, difficulty: 'medium',
    meals: ['lunch', 'dinner'], seasons: ['summer', 'autumn'],
    equipment: ['horno', 'sartén'],
    tags: ['horno', 'verduras'],
    ingredients: [
      { name: 'berenjena', qty: 4, unit: 'u', note: 'medianas' },
      { name: 'ternera', qty: 300, unit: 'g', note: 'picada' },
      { name: 'cebolla', qty: 150, unit: 'g', note: 'picada' },
      { name: 'ajo', qty: 8, unit: 'g' },
      { name: 'tomate triturado', qty: 300, unit: 'g' },
      { name: 'queso parmesano', qty: 60, unit: 'g', note: 'rallado' },
      { name: 'aceite de oliva virgen', qty: 30, unit: 'ml' },
      { name: 'oregano', qty: 1, unit: 'cdita' },
      { name: 'sal', qty: 1, unit: 'al_gusto' },
      { name: 'pimienta negra', qty: 1, unit: 'al_gusto' },
    ],
    steps: [
      { text: 'Precalentar horno a 200 °C. Cortar berenjenas a la mitad longitudinal y vaciar parte de la pulpa con cuchara.', durationMin: 8, temperature: 200, refs: ['berenjena'] },
      { text: 'Asar las medias berenjenas vacías 15 minutos boca abajo en bandeja con aceite.', durationMin: 15, temperature: 200, technique: 'hornear' },
      { text: 'Sofreír cebolla y ajo en aceite. Añadir la pulpa de berenjena picada y dorar 5 min.', durationMin: 8, technique: 'sofreír', refs: ['cebolla', 'ajo', 'aceite de oliva virgen'] },
      { text: 'Añadir la ternera y cocinar hasta dorar. Incorporar tomate, orégano, sal y pimienta. Cocer 10 min.', durationMin: 12, technique: 'cocer', refs: ['ternera', 'tomate triturado', 'oregano', 'sal', 'pimienta negra'] },
      { text: 'Rellenar las berenjenas, cubrir con queso rallado y hornear 20 min hasta gratinar.', durationMin: 20, temperature: 200, technique: 'gratinar', refs: ['queso parmesano'] },
    ],
  },
  {
    name: 'Fajitas de pollo',
    servings: 4,
    prepTime: 15, cookTime: 15, difficulty: 'easy',
    meals: ['lunch', 'dinner'], seasons: ['spring', 'summer', 'autumn', 'winter'],
    equipment: ['sartén'],
    tags: ['mexico', 'rapido'],
    ingredients: [
      { name: 'pollo', qty: 500, unit: 'g', note: 'pechuga en tiras' },
      { name: 'pimiento rojo', qty: 200, unit: 'g', note: 'en tiras' },
      { name: 'pimiento verde', qty: 200, unit: 'g', note: 'en tiras' },
      { name: 'cebolla', qty: 200, unit: 'g', note: 'en juliana' },
      { name: 'ajo', qty: 8, unit: 'g' },
      { name: 'aceite de oliva virgen', qty: 30, unit: 'ml' },
      { name: 'comino', qty: 1, unit: 'cdita' },
      { name: 'pimenton dulce', qty: 1, unit: 'cdita' },
      { name: 'lima', qty: 1, unit: 'u' },
      { name: 'sal', qty: 1, unit: 'al_gusto' },
      { name: 'cilantro', qty: 1, unit: 'al_gusto', optional: true },
    ],
    steps: [
      { text: 'Marinar el pollo con comino, pimentón, ajo machacado, sal y zumo de lima 10 min.', durationMin: 10, refs: ['pollo', 'comino', 'pimenton dulce', 'ajo', 'sal', 'lima'] },
      { text: 'Saltear la cebolla y los pimientos en aceite a fuego fuerte 8 minutos.', durationMin: 8, technique: 'saltear', refs: ['cebolla', 'pimiento rojo', 'pimiento verde', 'aceite de oliva virgen'] },
      { text: 'Apartar las verduras y dorar el pollo a fuego fuerte 5 minutos.', durationMin: 5, technique: 'saltear' },
      { text: 'Devolver las verduras a la sartén, mezclar y servir con cilantro fresco.', refs: ['cilantro'] },
    ],
  },
  {
    name: 'Ramen casero',
    servings: 2,
    prepTime: 20, cookTime: 60, difficulty: 'medium',
    meals: ['lunch', 'dinner'], seasons: ['autumn', 'winter'],
    equipment: ['olla', 'cazuela'],
    tags: ['japon', 'sopa'],
    notes: 'Ramen rápido. El caldo tradicional tarda 8h; este versión simplificada da resultado decente en 1h.',
    ingredients: [
      { name: 'fideos', qty: 200, unit: 'g', note: 'tipo ramen' },
      { name: 'pollo', qty: 200, unit: 'g', note: 'pechuga' },
      { name: 'huevo', qty: 2, unit: 'u' },
      { name: 'caldo de pollo', qty: 1000, unit: 'ml' },
      { name: 'salsa de soja', qty: 60, unit: 'ml' },
      { name: 'jengibre fresco', qty: 20, unit: 'g' },
      { name: 'ajo', qty: 10, unit: 'g' },
      { name: 'cebolla', qty: 100, unit: 'g' },
      { name: 'champinones', qty: 100, unit: 'g', note: 'laminados' },
      { name: 'espinacas', qty: 100, unit: 'g' },
      { name: 'aceite de oliva virgen', qty: 15, unit: 'ml' },
      { name: 'sesamo', qty: 5, unit: 'g', optional: true },
    ],
    steps: [
      { text: 'Cocer huevos 6 minutos en agua hirviendo, enfriar y pelar. Reservar.', durationMin: 8, technique: 'cocer', refs: ['huevo'] },
      { text: 'En cazuela, dorar pollo entero con un poco de aceite. Reservar.', durationMin: 8, technique: 'dorar', refs: ['pollo', 'aceite de oliva virgen'] },
      { text: 'En misma cazuela, sofreír cebolla, ajo y jengibre 3 min.', durationMin: 3, technique: 'sofreír', refs: ['cebolla', 'ajo', 'jengibre fresco'] },
      { text: 'Añadir caldo y soja. Cocer pollo en el caldo 30 min hasta hacer.', durationMin: 30, technique: 'cocer', refs: ['caldo de pollo', 'salsa de soja'] },
      { text: 'Sacar pollo, deshacer en tiras. Cocer fideos en el caldo 4 min con champiñones.', durationMin: 4, refs: ['fideos', 'champinones'] },
      { text: 'Repartir fideos y caldo en boles. Añadir pollo, espinacas frescas, huevo cortado a la mitad y sésamo.', refs: ['espinacas', 'sesamo'] },
    ],
  },
  {
    name: 'Sopa miso',
    servings: 4,
    prepTime: 5, cookTime: 10, difficulty: 'easy',
    meals: ['lunch', 'dinner'], seasons: ['autumn', 'winter'],
    equipment: ['olla'],
    tags: ['japon', 'sopa'],
    notes: 'No hervir el miso — destruye los probióticos. Añadir al final con el fuego apagado.',
    ingredients: [
      { name: 'caldo de verduras', qty: 1000, unit: 'ml', note: 'idealmente dashi' },
      { name: 'tofu', qty: 200, unit: 'g', note: 'firme, en taquitos' },
      { name: 'puerro', qty: 50, unit: 'g', note: 'en rodajas finas' },
      { name: 'champinones', qty: 80, unit: 'g', note: 'shiitake si tienes' },
      { name: 'espinacas', qty: 60, unit: 'g', note: 'baby' },
      { name: 'salsa de soja', qty: 15, unit: 'ml' },
      { name: 'sesamo', qty: 5, unit: 'g', optional: true },
    ],
    steps: [
      { text: 'Calentar el caldo en olla sin que llegue a hervir.', durationMin: 5, refs: ['caldo de verduras'] },
      { text: 'Añadir champiñones y cocer 3 minutos a fuego suave.', durationMin: 3, technique: 'cocer', refs: ['champinones'] },
      { text: 'Incorporar tofu, puerro y soja. Cocer 2 minutos más.', durationMin: 2, refs: ['tofu', 'puerro', 'salsa de soja'] },
      { text: 'Apagar el fuego, añadir las espinacas para que se ablanden con el calor residual. Servir con sésamo.', refs: ['espinacas', 'sesamo'] },
    ],
  },
  {
    name: 'Vegan butter chicken (con tofu)',
    servings: 4,
    prepTime: 20, cookTime: 30, difficulty: 'medium',
    meals: ['lunch', 'dinner'], seasons: ['autumn', 'winter'],
    equipment: ['cazuela'],
    tags: ['india', 'vegano'],
    notes: 'Versión vegana del butter chicken usando tofu firme y nata vegetal (o de coco).',
    ingredients: [
      { name: 'tofu', qty: 400, unit: 'g', note: 'firme, en taquitos' },
      { name: 'tomate triturado', qty: 400, unit: 'g' },
      { name: 'cebolla', qty: 200, unit: 'g', note: 'picada' },
      { name: 'ajo', qty: 12, unit: 'g' },
      { name: 'jengibre fresco', qty: 20, unit: 'g' },
      { name: 'nata liquida', qty: 200, unit: 'ml', note: 'vegetal de coco si quieres totalmente vegano' },
      { name: 'mantequilla', qty: 30, unit: 'g', note: 'vegetal o margarina si vegano' },
      { name: 'comino', qty: 1, unit: 'cdita' },
      { name: 'curcuma', qty: 1, unit: 'cdita' },
      { name: 'pimenton dulce', qty: 1, unit: 'cdita' },
      { name: 'canela', qty: 1, unit: 'pizca' },
      { name: 'sal', qty: 1, unit: 'al_gusto' },
      { name: 'cilantro', qty: 1, unit: 'al_gusto', optional: true },
    ],
    steps: [
      { text: 'Dorar el tofu en mantequilla a fuego medio-alto hasta que esté crujiente. Reservar.', durationMin: 8, technique: 'dorar', refs: ['tofu', 'mantequilla'] },
      { text: 'En misma cazuela, sofreír cebolla, ajo, jengibre y especias 5 min.', durationMin: 5, technique: 'sofreír', refs: ['cebolla', 'ajo', 'jengibre fresco', 'comino', 'curcuma', 'pimenton dulce', 'canela'] },
      { text: 'Añadir tomate triturado y sal. Cocer 12 minutos a fuego medio removiendo.', durationMin: 12, technique: 'cocer', refs: ['tomate triturado', 'sal'] },
      { text: 'Triturar la salsa con batidora hasta cremosa. Devolver al fuego, añadir nata.', durationMin: 3, technique: 'triturar', refs: ['nata liquida'] },
      { text: 'Incorporar el tofu y cocer 5 minutos para que coja sabor. Servir con cilantro.', durationMin: 5, refs: ['cilantro'] },
    ],
  },
  {
    name: 'Tzatziki',
    servings: 4,
    yieldText: '≈ 400 g de salsa',
    prepTime: 15, difficulty: 'easy',
    meals: ['lunch', 'dinner'], seasons: ['spring', 'summer'],
    equipment: ['rallador'],
    tags: ['grecia', 'salsa'],
    notes: 'Reposar 1 h en nevera para que los sabores se integren.',
    storage: 'Hasta 3 días en nevera en recipiente hermético.',
    ingredients: [
      { name: 'yogur natural', qty: 400, unit: 'g', note: 'griego o estilo griego' },
      { name: 'pepino', qty: 200, unit: 'g', note: 'rallado y escurrido' },
      { name: 'ajo', qty: 6, unit: 'g', note: 'machacado' },
      { name: 'aceite de oliva virgen', qty: 20, unit: 'ml' },
      { name: 'limon', qty: 1, unit: 'u', note: 'su zumo' },
      { name: 'menta', qty: 1, unit: 'al_gusto', note: 'fresca, picada' },
      { name: 'sal', qty: 1, unit: 'al_gusto' },
      { name: 'pimienta negra', qty: 1, unit: 'al_gusto' },
    ],
    steps: [
      { text: 'Rallar el pepino, salar y dejar escurrir 10 minutos en colador para que suelte agua.', durationMin: 10, refs: ['pepino', 'sal'] },
      { text: 'Apretar el pepino con las manos para extraer el máximo de líquido.', durationMin: 2 },
      { text: 'Mezclar yogur, ajo, aceite, zumo de limón, menta y pimienta. Añadir el pepino.', refs: ['yogur natural', 'ajo', 'aceite de oliva virgen', 'limon', 'menta', 'pimienta negra'] },
      { text: 'Refrigerar al menos 1 hora antes de servir.', durationMin: 60 },
    ],
  },
  {
    name: 'Contramuslos de pollo guisados',
    servings: 4,
    prepTime: 15, cookTime: 45, difficulty: 'easy',
    meals: ['lunch', 'dinner'], seasons: ['autumn', 'winter'],
    equipment: ['cazuela'],
    tags: ['guiso', 'pollo'],
    ingredients: [
      { name: 'pollo', qty: 800, unit: 'g', note: 'contramuslos con piel' },
      { name: 'cebolla', qty: 200, unit: 'g', note: 'picada' },
      { name: 'zanahoria', qty: 150, unit: 'g', note: 'en rodajas' },
      { name: 'ajo', qty: 10, unit: 'g' },
      { name: 'tomate triturado', qty: 200, unit: 'g' },
      { name: 'vino blanco', qty: 150, unit: 'ml' },
      { name: 'caldo de pollo', qty: 300, unit: 'ml' },
      { name: 'aceite de oliva virgen', qty: 30, unit: 'ml' },
      { name: 'laurel', qty: 2, unit: 'u' },
      { name: 'tomillo', qty: 1, unit: 'al_gusto' },
      { name: 'sal', qty: 1, unit: 'al_gusto' },
      { name: 'pimienta negra', qty: 1, unit: 'al_gusto' },
    ],
    steps: [
      { text: 'Salpimentar los contramuslos. Dorarlos en aceite a fuego fuerte por ambos lados. Reservar.', durationMin: 10, technique: 'dorar', refs: ['pollo', 'aceite de oliva virgen', 'sal', 'pimienta negra'] },
      { text: 'En misma cazuela sofreír cebolla, ajo y zanahoria a fuego medio.', durationMin: 8, technique: 'sofreír', refs: ['cebolla', 'ajo', 'zanahoria'] },
      { text: 'Añadir tomate y cocinar 5 minutos.', durationMin: 5, refs: ['tomate triturado'] },
      { text: 'Verter el vino y dejar evaporar 2 min. Añadir caldo, laurel, tomillo.', durationMin: 4, refs: ['vino blanco', 'caldo de pollo', 'laurel', 'tomillo'] },
      { text: 'Devolver el pollo a la cazuela, tapar y cocer 30 minutos a fuego suave.', durationMin: 30, technique: 'cocer' },
    ],
  },
  {
    name: 'Tabulé',
    servings: 4,
    prepTime: 25, difficulty: 'easy',
    meals: ['lunch', 'dinner'], seasons: ['spring', 'summer'],
    equipment: ['bol'],
    tags: ['libano', 'fresco'],
    notes: 'Ensalada libanesa de bulgur. Si no tienes bulgur, sustituye por cuscús.',
    ingredients: [
      { name: 'cuscus', qty: 200, unit: 'g', note: 'o bulgur' },
      { name: 'tomate', qty: 200, unit: 'g', note: 'en taquitos pequeños' },
      { name: 'pepino', qty: 150, unit: 'g', note: 'en taquitos pequeños' },
      { name: 'cebolla', qty: 80, unit: 'g', note: 'picada muy fina' },
      { name: 'perejil', qty: 30, unit: 'g', note: 'picado fino — abundante' },
      { name: 'menta', qty: 10, unit: 'g', note: 'picada' },
      { name: 'aceite de oliva virgen', qty: 40, unit: 'ml' },
      { name: 'limon', qty: 2, unit: 'u', note: 'su zumo' },
      { name: 'sal', qty: 1, unit: 'al_gusto' },
      { name: 'pimienta negra', qty: 1, unit: 'al_gusto' },
    ],
    steps: [
      { text: 'Hidratar el cuscús con la misma cantidad de agua hirviendo y sal. Tapar 5 min.', durationMin: 5, refs: ['cuscus', 'sal'] },
      { text: 'Soltar los granos con un tenedor y dejar enfriar.', durationMin: 5 },
      { text: 'Mezclar tomate, pepino, cebolla, perejil y menta en un bol.', refs: ['tomate', 'pepino', 'cebolla', 'perejil', 'menta'] },
      { text: 'Añadir el cuscús frío. Aliñar con aceite, zumo de limón, pimienta y sal. Mezclar.', refs: ['aceite de oliva virgen', 'limon', 'pimienta negra'] },
      { text: 'Reposar 30 min en nevera antes de servir.', durationMin: 30 },
    ],
  },
  {
    name: 'Berenjenas con queso',
    servings: 4,
    prepTime: 15, cookTime: 30, difficulty: 'easy',
    meals: ['lunch', 'dinner'], seasons: ['summer', 'autumn'],
    equipment: ['horno', 'bandeja'],
    tags: ['horno', 'verduras'],
    ingredients: [
      { name: 'berenjena', qty: 600, unit: 'g', note: 'en rodajas de 1 cm' },
      { name: 'tomate triturado', qty: 300, unit: 'g' },
      { name: 'mozzarella', qty: 200, unit: 'g', note: 'en lonchas' },
      { name: 'queso parmesano', qty: 50, unit: 'g', note: 'rallado' },
      { name: 'ajo', qty: 6, unit: 'g' },
      { name: 'aceite de oliva virgen', qty: 30, unit: 'ml' },
      { name: 'oregano', qty: 1, unit: 'cdita' },
      { name: 'albahaca', qty: 1, unit: 'al_gusto', optional: true },
      { name: 'sal', qty: 1, unit: 'al_gusto' },
    ],
    steps: [
      { text: 'Salar las rodajas de berenjena y dejar reposar 15 min para que suelten agua. Secar.', durationMin: 15, refs: ['berenjena', 'sal'] },
      { text: 'Precalentar horno a 200 °C. Pintar bandeja con aceite y disponer las rodajas.', durationMin: 10, temperature: 200 },
      { text: 'Hornear las berenjenas 15 min hasta tiernas.', durationMin: 15, temperature: 200, technique: 'hornear' },
      { text: 'Mientras, sofreír ajo en aceite. Añadir tomate y orégano. Cocer 10 min.', durationMin: 10, technique: 'cocer', refs: ['ajo', 'aceite de oliva virgen', 'tomate triturado', 'oregano'] },
      { text: 'Sobre las berenjenas, distribuir tomate, mozzarella y parmesano. Hornear 10 min hasta gratinar.', durationMin: 10, temperature: 200, technique: 'gratinar', refs: ['mozzarella', 'queso parmesano'] },
      { text: 'Decorar con albahaca fresca al servir.', refs: ['albahaca'] },
    ],
  },
  {
    name: 'Pollo agridulce',
    servings: 4,
    prepTime: 15, cookTime: 20, difficulty: 'medium',
    meals: ['lunch', 'dinner'], seasons: ['spring', 'summer', 'autumn', 'winter'],
    equipment: ['sartén'],
    tags: ['china', 'rapido'],
    ingredients: [
      { name: 'pollo', qty: 500, unit: 'g', note: 'pechuga en taquitos' },
      { name: 'pimiento rojo', qty: 150, unit: 'g', note: 'en cuadrados' },
      { name: 'pimiento verde', qty: 150, unit: 'g', note: 'en cuadrados' },
      { name: 'cebolla', qty: 100, unit: 'g', note: 'en cuadrados' },
      { name: 'pina', qty: 200, unit: 'g', note: 'en taquitos' },
      { name: 'salsa de soja', qty: 30, unit: 'ml' },
      { name: 'vinagre de vino', qty: 30, unit: 'ml' },
      { name: 'azucar', qty: 30, unit: 'g' },
      { name: 'tomate triturado', qty: 100, unit: 'g' },
      { name: 'ajo', qty: 8, unit: 'g' },
      { name: 'jengibre fresco', qty: 10, unit: 'g' },
      { name: 'aceite de oliva virgen', qty: 30, unit: 'ml' },
      { name: 'harina de trigo', qty: 30, unit: 'g', note: 'para rebozar' },
    ],
    steps: [
      { text: 'Pasar el pollo por harina ligeramente. Dorar en sartén con aceite a fuego fuerte. Reservar.', durationMin: 8, technique: 'dorar', refs: ['pollo', 'harina de trigo', 'aceite de oliva virgen'] },
      { text: 'Saltear cebolla, ajo, jengibre y pimientos a fuego fuerte 5 min.', durationMin: 5, technique: 'saltear', refs: ['cebolla', 'ajo', 'jengibre fresco', 'pimiento rojo', 'pimiento verde'] },
      { text: 'Añadir piña, salsa de soja, vinagre, azúcar y tomate. Cocer 5 min hasta espesar.', durationMin: 5, technique: 'cocer', refs: ['pina', 'salsa de soja', 'vinagre de vino', 'azucar', 'tomate triturado'] },
      { text: 'Devolver el pollo a la sartén y mezclar para impregnar 2 min más.', durationMin: 2 },
    ],
  },
  {
    name: 'Lasaña de verduras',
    servings: 4,
    prepTime: 25, cookTime: 35, difficulty: 'medium',
    meals: ['lunch', 'dinner'], seasons: ['autumn', 'winter'],
    equipment: ['horno', 'sartén'],
    tags: ['italia', 'horno'],
    ingredients: [
      { name: 'pasta', qty: 200, unit: 'g', note: 'placas de lasaña' },
      { name: 'calabacin', qty: 300, unit: 'g', note: 'en rodajas finas' },
      { name: 'berenjena', qty: 300, unit: 'g', note: 'en rodajas finas' },
      { name: 'espinacas', qty: 200, unit: 'g' },
      { name: 'cebolla', qty: 150, unit: 'g' },
      { name: 'ajo', qty: 10, unit: 'g' },
      { name: 'tomate triturado', qty: 400, unit: 'g' },
      { name: 'mozzarella', qty: 150, unit: 'g' },
      { name: 'queso parmesano', qty: 50, unit: 'g' },
      { name: 'leche entera', qty: 300, unit: 'ml' },
      { name: 'mantequilla', qty: 30, unit: 'g' },
      { name: 'harina de trigo', qty: 30, unit: 'g' },
      { name: 'aceite de oliva virgen', qty: 30, unit: 'ml' },
      { name: 'oregano', qty: 1, unit: 'cdita' },
      { name: 'sal', qty: 1, unit: 'al_gusto' },
      { name: 'nuez moscada', qty: 1, unit: 'pizca' },
    ],
    steps: [
      { text: 'Asar berenjena y calabacín 10 min a 200 °C con un poco de aceite.', durationMin: 10, temperature: 200, technique: 'hornear', refs: ['berenjena', 'calabacin', 'aceite de oliva virgen'] },
      { text: 'Sofreír cebolla y ajo. Añadir tomate, orégano y sal. Cocer 10 min.', durationMin: 10, technique: 'cocer', refs: ['cebolla', 'ajo', 'tomate triturado', 'oregano', 'sal'] },
      { text: 'Bechamel: derretir mantequilla, añadir harina y tostar 1 min. Verter leche caliente removiendo. Espesar con nuez moscada.', durationMin: 8, refs: ['mantequilla', 'harina de trigo', 'leche entera', 'nuez moscada'] },
      { text: 'Cocer las placas de pasta según paquete o usar precocinadas.', durationMin: 6, refs: ['pasta'] },
      { text: 'Montar la lasaña: salsa, pasta, verduras, espinacas, bechamel. Repetir 3 veces.', durationMin: 8, refs: ['espinacas'] },
      { text: 'Cubrir con mozzarella y parmesano. Hornear 25 min a 200 °C.', durationMin: 25, temperature: 200, technique: 'hornear', refs: ['mozzarella', 'queso parmesano'] },
    ],
  },
  {
    name: 'Tajín de verduras y cordero',
    servings: 4,
    prepTime: 20, cookTime: 90, difficulty: 'medium',
    meals: ['lunch', 'dinner'], seasons: ['autumn', 'winter'],
    equipment: ['cazuela'],
    tags: ['marruecos', 'guiso'],
    notes: 'Si no tienes tajín, una cazuela de barro o hierro fundido funciona. La cocción larga es esencial.',
    ingredients: [
      { name: 'cordero', qty: 600, unit: 'g', note: 'en taquitos grandes' },
      { name: 'cebolla', qty: 200, unit: 'g' },
      { name: 'zanahoria', qty: 200, unit: 'g' },
      { name: 'patata', qty: 300, unit: 'g' },
      { name: 'calabacin', qty: 200, unit: 'g' },
      { name: 'ajo', qty: 12, unit: 'g' },
      { name: 'tomate triturado', qty: 200, unit: 'g' },
      { name: 'caldo de verduras', qty: 400, unit: 'ml' },
      { name: 'aceite de oliva virgen', qty: 30, unit: 'ml' },
      { name: 'comino', qty: 1, unit: 'cdita' },
      { name: 'curcuma', qty: 1, unit: 'cdita' },
      { name: 'canela', qty: 1, unit: 'pizca' },
      { name: 'jengibre fresco', qty: 10, unit: 'g' },
      { name: 'pasas', qty: 50, unit: 'g', optional: true },
      { name: 'almendras', qty: 30, unit: 'g', optional: true },
      { name: 'cilantro', qty: 1, unit: 'al_gusto', optional: true },
      { name: 'sal', qty: 1, unit: 'al_gusto' },
    ],
    steps: [
      { text: 'Marinar el cordero con especias (comino, cúrcuma, canela, jengibre, sal) 15 min.', durationMin: 15, refs: ['cordero', 'comino', 'curcuma', 'canela', 'jengibre fresco', 'sal'] },
      { text: 'Dorar el cordero en aceite a fuego fuerte. Reservar.', durationMin: 8, technique: 'dorar', refs: ['aceite de oliva virgen'] },
      { text: 'Sofreír cebolla y ajo en misma cazuela.', durationMin: 6, technique: 'sofreír', refs: ['cebolla', 'ajo'] },
      { text: 'Añadir tomate y cocer 5 min.', durationMin: 5, refs: ['tomate triturado'] },
      { text: 'Devolver cordero, añadir caldo, zanahoria, patata. Tapar y cocer 50 min a fuego suave.', durationMin: 50, technique: 'cocer', refs: ['caldo de verduras', 'zanahoria', 'patata'] },
      { text: 'Añadir calabacín, pasas y almendras. Cocer 15 min más.', durationMin: 15, refs: ['calabacin', 'pasas', 'almendras'] },
      { text: 'Servir con cilantro fresco picado.', refs: ['cilantro'] },
    ],
  },
  {
    name: 'Albóndigas gipsy',
    servings: 4,
    prepTime: 25, cookTime: 30, difficulty: 'medium',
    meals: ['lunch', 'dinner'], seasons: ['spring', 'summer', 'autumn', 'winter'],
    equipment: ['sartén', 'cazuela'],
    tags: ['gipsy', 'albondigas'],
    ingredients: [
      { name: 'ternera', qty: 500, unit: 'g', note: 'picada' },
      { name: 'pan blanco', qty: 50, unit: 'g', note: 'remojado en leche' },
      { name: 'leche entera', qty: 50, unit: 'ml' },
      { name: 'huevo', qty: 1, unit: 'u' },
      { name: 'cebolla', qty: 150, unit: 'g', note: 'picada' },
      { name: 'ajo', qty: 8, unit: 'g' },
      { name: 'perejil', qty: 5, unit: 'g', note: 'picado' },
      { name: 'tomate triturado', qty: 300, unit: 'g' },
      { name: 'caldo de verduras', qty: 200, unit: 'ml' },
      { name: 'aceite de oliva virgen', qty: 50, unit: 'ml' },
      { name: 'pimenton dulce', qty: 1, unit: 'cdita' },
      { name: 'comino', qty: 1, unit: 'cdita' },
      { name: 'harina de trigo', qty: 30, unit: 'g', note: 'para rebozar' },
      { name: 'sal', qty: 1, unit: 'al_gusto' },
      { name: 'pimienta negra', qty: 1, unit: 'al_gusto' },
    ],
    steps: [
      { text: 'Mezclar ternera, pan remojado en leche, huevo, mitad de cebolla, ajo, perejil, comino, sal y pimienta.', durationMin: 5, refs: ['ternera', 'pan blanco', 'leche entera', 'huevo', 'cebolla', 'ajo', 'perejil', 'comino', 'sal', 'pimienta negra'] },
      { text: 'Formar albóndigas del tamaño de una nuez (≈ 25 g cada una).', durationMin: 10 },
      { text: 'Pasar por harina y freír en aceite a fuego medio-alto hasta dorar.', durationMin: 8, technique: 'freír', refs: ['harina de trigo', 'aceite de oliva virgen'] },
      { text: 'Reservar las albóndigas. En misma cazuela sofreír resto de cebolla y pimentón.', durationMin: 5, technique: 'sofreír', refs: ['pimenton dulce'] },
      { text: 'Añadir tomate y caldo. Cocer 10 min.', durationMin: 10, technique: 'cocer', refs: ['tomate triturado', 'caldo de verduras'] },
      { text: 'Devolver las albóndigas y cocer 10 min más en la salsa.', durationMin: 10 },
    ],
  },
  {
    name: 'Garbanzos con espinacas',
    servings: 4,
    prepTime: 10, cookTime: 25, difficulty: 'easy',
    meals: ['lunch', 'dinner'], seasons: ['autumn', 'winter'],
    equipment: ['cazuela'],
    tags: ['guiso', 'cuaresma'],
    notes: 'Plato sevillano tradicional. Si tienes garbanzos secos: remojar 12 h y cocer 1 h antes.',
    ingredients: [
      { name: 'garbanzos', qty: 500, unit: 'g', note: 'cocidos, escurridos' },
      { name: 'espinacas', qty: 400, unit: 'g' },
      { name: 'cebolla', qty: 150, unit: 'g' },
      { name: 'ajo', qty: 12, unit: 'g' },
      { name: 'tomate triturado', qty: 200, unit: 'g' },
      { name: 'pan blanco', qty: 30, unit: 'g', note: 'tostado' },
      { name: 'aceite de oliva virgen', qty: 40, unit: 'ml' },
      { name: 'pimenton dulce', qty: 1, unit: 'cdita' },
      { name: 'comino', qty: 1, unit: 'cdita' },
      { name: 'caldo de verduras', qty: 200, unit: 'ml' },
      { name: 'vinagre de vino', qty: 15, unit: 'ml' },
      { name: 'sal', qty: 1, unit: 'al_gusto' },
    ],
    steps: [
      { text: 'Tostar el pan en aceite hasta dorar. Reservar.', durationMin: 3, refs: ['pan blanco', 'aceite de oliva virgen'] },
      { text: 'En misma cazuela sofreír cebolla y ajo.', durationMin: 6, technique: 'sofreír', refs: ['cebolla', 'ajo'] },
      { text: 'Añadir pimentón y tomate. Cocer 5 min.', durationMin: 5, refs: ['pimenton dulce', 'tomate triturado'] },
      { text: 'Triturar el pan tostado con comino, vinagre y un poco de caldo. Añadir a la cazuela.', durationMin: 3, refs: ['comino', 'vinagre de vino', 'caldo de verduras'] },
      { text: 'Incorporar garbanzos y resto del caldo. Cocer 8 min.', durationMin: 8, technique: 'cocer', refs: ['garbanzos'] },
      { text: 'Añadir las espinacas y cocer 3 min más hasta que ablanden.', durationMin: 3, refs: ['espinacas', 'sal'] },
    ],
  },
  {
    name: 'Ensalada thai',
    servings: 4,
    prepTime: 20, difficulty: 'easy',
    meals: ['lunch', 'dinner'], seasons: ['spring', 'summer'],
    equipment: ['bol'],
    tags: ['thai', 'fresco'],
    notes: 'Ensalada tipo som tam pero más accesible. El picante es opcional.',
    ingredients: [
      { name: 'zanahoria', qty: 200, unit: 'g', note: 'rallada gruesa' },
      { name: 'pepino', qty: 150, unit: 'g', note: 'en juliana' },
      { name: 'tomate', qty: 200, unit: 'g', note: 'cherry partido' },
      { name: 'cebolla', qty: 50, unit: 'g', note: 'morada en juliana fina' },
      { name: 'lechuga', qty: 100, unit: 'g', note: 'iceberg en tiras' },
      { name: 'almendras', qty: 50, unit: 'g', note: 'tostadas, picadas (o cacahuetes)' },
      { name: 'lima', qty: 2, unit: 'u', note: 'su zumo' },
      { name: 'salsa de soja', qty: 30, unit: 'ml' },
      { name: 'azucar', qty: 15, unit: 'g' },
      { name: 'ajo', qty: 6, unit: 'g', note: 'machacado' },
      { name: 'jengibre fresco', qty: 5, unit: 'g' },
      { name: 'guindilla', qty: 1, unit: 'pizca', optional: true },
      { name: 'cilantro', qty: 1, unit: 'al_gusto' },
    ],
    steps: [
      { text: 'Mezclar el aliño: zumo de lima, soja, azúcar, ajo, jengibre, guindilla. Reposar 5 min.', durationMin: 5, refs: ['lima', 'salsa de soja', 'azucar', 'ajo', 'jengibre fresco', 'guindilla'] },
      { text: 'En un bol grande, mezclar zanahoria, pepino, tomate, cebolla y lechuga.', refs: ['zanahoria', 'pepino', 'tomate', 'cebolla', 'lechuga'] },
      { text: 'Aliñar y mezclar bien.', durationMin: 2 },
      { text: 'Servir con cacahuetes picados y cilantro fresco.', refs: ['cacahuetes', 'cilantro'] },
    ],
  },
  {
    name: 'Revuelto de espinacas y atún',
    servings: 2,
    prepTime: 5, cookTime: 8, difficulty: 'easy',
    meals: ['lunch', 'dinner'], seasons: ['spring', 'summer', 'autumn', 'winter'],
    equipment: ['sartén'],
    tags: ['rapido', 'huevo'],
    ingredients: [
      { name: 'espinacas', qty: 300, unit: 'g', note: 'frescas o congeladas' },
      { name: 'atun', qty: 120, unit: 'g', note: 'lata, escurrido' },
      { name: 'huevo', qty: 4, unit: 'u' },
      { name: 'cebolla', qty: 80, unit: 'g', note: 'picada' },
      { name: 'ajo', qty: 5, unit: 'g' },
      { name: 'aceite de oliva virgen', qty: 20, unit: 'ml' },
      { name: 'sal', qty: 1, unit: 'al_gusto' },
      { name: 'pimienta negra', qty: 1, unit: 'al_gusto' },
    ],
    steps: [
      { text: 'Sofreír cebolla y ajo en aceite a fuego medio.', durationMin: 4, technique: 'sofreír', refs: ['cebolla', 'ajo', 'aceite de oliva virgen'] },
      { text: 'Añadir espinacas y rehogar hasta que reduzcan.', durationMin: 3, technique: 'rehogar', refs: ['espinacas'] },
      { text: 'Incorporar el atún desmenuzado y mezclar 1 min.', durationMin: 1, refs: ['atun'] },
      { text: 'Batir los huevos con sal y pimienta. Verter sobre la sartén y remover hasta que cuajen.', durationMin: 3, refs: ['huevo', 'sal', 'pimienta negra'] },
    ],
  },
]

// ── Resolution + JSONL output ────────────────────────────────────

async function main() {
  const catalog = await db
    .select({ id: ingredients.id, name: ingredients.name })
    .from(ingredients)
  const norm = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/\p{Mn}/gu, '').trim()
  const byName = new Map<string, string>()
  for (const c of catalog) byName.set(norm(c.name), c.id)

  const out: any[] = []
  const skipped: { recipe: string; missing: string[] }[] = []

  for (const r of RECIPES) {
    // Resolve ingredient ids
    const resolvedIngredients: any[] = []
    const missing: string[] = []
    for (let i = 0; i < r.ingredients.length; i++) {
      const ing = r.ingredients[i]
      const id = byName.get(norm(ing.name))
      if (!id) {
        missing.push(ing.name)
        continue
      }
      resolvedIngredients.push({
        id: `ing_${i}`,
        ingredientId: id,
        quantity: ing.qty,
        unit: ing.unit,
        optional: ing.optional ?? false,
        note: ing.note,
        section: ing.section,
        displayOrder: i,
      })
    }
    if (missing.length > 0) {
      console.log(`[skip] ${r.name}: missing in catalog: ${missing.join(', ')}`)
      skipped.push({ recipe: r.name, missing })
      continue
    }

    // Resolve step.ingredientRefs (names → temp ids)
    const refByName = new Map<string, string>()
    for (let i = 0; i < r.ingredients.length; i++) {
      refByName.set(norm(r.ingredients[i].name), `ing_${i}`)
    }
    const resolvedSteps = r.steps.map((s, idx) => ({
      index: idx,
      text: s.text,
      durationMin: s.durationMin,
      temperature: s.temperature,
      technique: s.technique,
      ingredientRefs: (s.refs ?? [])
        .map((name) => refByName.get(norm(name)))
        .filter((x): x is string => Boolean(x)),
    }))

    out.push({
      name: r.name,
      servings: r.servings,
      yieldText: r.yieldText,
      prepTime: r.prepTime,
      cookTime: r.cookTime,
      activeTime: r.activeTime,
      difficulty: r.difficulty,
      meals: r.meals,
      seasons: r.seasons,
      equipment: r.equipment,
      tags: r.tags ?? [],
      internalTags: ['compartida'],
      notes: r.notes,
      tips: r.tips,
      substitutions: r.substitutions,
      storage: r.storage,
      ingredients: resolvedIngredients,
      steps: resolvedSteps,
    })
  }

  const outPath = path.resolve(
    import.meta.dirname,
    'output',
    'regen-passed.jsonl',
  )
  const existing = await fs.readFile(outPath, 'utf8').catch(() => '')
  const newLines = out.map((r) => JSON.stringify(r)).join('\n')
  await fs.writeFile(
    outPath,
    (existing.trim() ? existing.trimEnd() + '\n' : '') + newLines + '\n',
    'utf8',
  )

  console.log('')
  console.log(`Authored: ${out.length}`)
  console.log(`Skipped (missing ingredients): ${skipped.length}`)
  console.log(`Appended to: ${outPath}`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[hand] Fatal:', err)
    process.exit(1)
  })
  .finally(async () => {
    await pool?.end?.().catch(() => undefined)
  })
