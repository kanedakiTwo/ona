#!/usr/bin/env tsx
/**
 * Expand the ingredient catalog by querying USDA FoodData Central for a
 * curated list of common Spanish kitchen staples. Outputs draft YAML
 * entries to apps/api/src/seed/data/ingredient-fdc-map.expanded.yaml for
 * curator review before merging into the main map.
 *
 * Usage:
 *   pnpm --filter @ona/api expand:catalog
 *
 * After review, append entries from the expanded file into
 * ingredient-fdc-map.yaml (or rename it) and run `seed:usda` to apply.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import yaml from 'js-yaml'
import { createUsdaClient } from '../src/services/nutrition/usdaClient.js'
import { inferAllergenTagsFromName } from '../src/services/nutrition/allergens.js'
import type { Aisle } from '@ona/shared'

interface DraftEntry {
  name: string
  fdcId: number | null
  aisle: Aisle
  density: number | null
  unitWeight: number | null
  allergenTags: string[]
  /** USDA description for traceability — curator can cross-check */
  _usdaDescription?: string
}

interface CandidateInput {
  /** Spanish name as ONA stores it (lowercase, accent-stripped already if needed) */
  es: string
  /** English query sent to USDA `searchByName` */
  en: string
  aisle: Aisle
  /** g/ml when applicable (oils, milk, syrups, etc.) */
  density?: number | null
  /** g per unit when buyable by piece */
  unitWeight?: number | null
}

// ── Curated expansion list ────────────────────────────────────────
// Spanish kitchen staples that the existing seed (and most reasonable
// LLM-generated recipes) reference. Add freely; the script idempotently
// dedupes against the existing map.

const CANDIDATES: CandidateInput[] = [
  // Missing from existing seed
  { es: 'acelgas', en: 'swiss chard raw', aisle: 'produce' },
  { es: 'bacalao', en: 'cod atlantic raw', aisle: 'proteinas' },
  { es: 'berenjena', en: 'eggplant raw', aisle: 'produce', unitWeight: 250 },
  { es: 'costillas de cerdo', en: 'pork ribs raw', aisle: 'proteinas' },
  { es: 'guisantes', en: 'peas green raw', aisle: 'produce' },
  { es: 'jamon', en: 'ham cured', aisle: 'proteinas' },
  { es: 'judias verdes', en: 'beans green raw', aisle: 'produce' },
  { es: 'pimiento verde', en: 'peppers sweet green raw', aisle: 'produce', unitWeight: 120 },
  { es: 'puerro', en: 'leeks raw', aisle: 'produce', unitWeight: 90 },

  // Fresh herbs
  { es: 'albahaca', en: 'basil fresh', aisle: 'produce' },
  { es: 'cilantro', en: 'coriander leaves fresh', aisle: 'produce' },
  { es: 'menta', en: 'spearmint fresh', aisle: 'produce' },
  { es: 'perejil', en: 'parsley fresh', aisle: 'produce' },
  { es: 'romero', en: 'rosemary fresh', aisle: 'produce' },
  { es: 'tomillo', en: 'thyme fresh', aisle: 'produce' },
  { es: 'laurel', en: 'bay leaves', aisle: 'despensa' },
  { es: 'oregano', en: 'oregano dried', aisle: 'despensa' },

  // Spices and aromatics
  { es: 'sal', en: 'salt table', aisle: 'despensa' },
  { es: 'pimienta negra', en: 'pepper black ground', aisle: 'despensa' },
  { es: 'pimenton dulce', en: 'paprika', aisle: 'despensa' },
  { es: 'pimenton picante', en: 'spices paprika', aisle: 'despensa' },
  { es: 'comino', en: 'cumin seed ground', aisle: 'despensa' },
  { es: 'canela', en: 'cinnamon ground', aisle: 'despensa' },
  { es: 'nuez moscada', en: 'nutmeg ground', aisle: 'despensa' },
  { es: 'curcuma', en: 'turmeric ground', aisle: 'despensa' },
  { es: 'jengibre fresco', en: 'ginger root raw', aisle: 'produce' },
  { es: 'guindilla', en: 'pepper hot chili red raw', aisle: 'produce' },

  // More vegetables / fruits
  { es: 'limon', en: 'lemons raw', aisle: 'produce', unitWeight: 70 },
  { es: 'lima', en: 'limes raw', aisle: 'produce', unitWeight: 60 },
  { es: 'naranja', en: 'oranges raw', aisle: 'produce', unitWeight: 130 },
  { es: 'pera', en: 'pears raw', aisle: 'produce', unitWeight: 175 },
  { es: 'fresa', en: 'strawberries raw', aisle: 'produce' },
  { es: 'arandanos', en: 'blueberries raw', aisle: 'produce' },
  { es: 'frambuesas', en: 'raspberries raw', aisle: 'produce' },
  { es: 'lechuga', en: 'lettuce iceberg raw', aisle: 'produce' },
  { es: 'rucula', en: 'arugula raw', aisle: 'produce' },
  { es: 'pepino', en: 'cucumber raw', aisle: 'produce', unitWeight: 200 },
  { es: 'apio', en: 'celery raw', aisle: 'produce' },
  { es: 'rabanitos', en: 'radishes raw', aisle: 'produce' },
  { es: 'remolacha', en: 'beets raw', aisle: 'produce' },
  { es: 'champinones', en: 'mushrooms white raw', aisle: 'produce' },
  { es: 'setas', en: 'mushrooms portabella raw', aisle: 'produce' },
  { es: 'calabaza', en: 'pumpkin raw', aisle: 'produce' },
  { es: 'boniato', en: 'sweet potato raw', aisle: 'produce', unitWeight: 130 },
  { es: 'aguacate', en: 'avocados raw', aisle: 'produce', unitWeight: 200 }, // in catalog already; will be deduped
  { es: 'pina', en: 'pineapple raw', aisle: 'produce' },
  { es: 'mango', en: 'mango raw', aisle: 'produce', unitWeight: 200 },
  { es: 'sandia', en: 'watermelon raw', aisle: 'produce' },
  { es: 'melon', en: 'melons cantaloupe raw', aisle: 'produce' },

  // Proteins
  { es: 'pavo', en: 'turkey breast raw', aisle: 'proteinas' },
  { es: 'cerdo', en: 'pork loin raw', aisle: 'proteinas' },
  { es: 'cordero', en: 'lamb leg raw', aisle: 'proteinas' },
  { es: 'gambas', en: 'shrimp raw', aisle: 'proteinas' },
  { es: 'mejillones', en: 'mussels blue raw', aisle: 'proteinas' },
  { es: 'calamares', en: 'squid mixed species raw', aisle: 'proteinas' },
  { es: 'pulpo', en: 'octopus common raw', aisle: 'proteinas' },
  { es: 'merluza', en: 'fish hake raw', aisle: 'proteinas' },
  { es: 'sardinas', en: 'fish sardine atlantic canned', aisle: 'proteinas' },
  { es: 'trucha', en: 'fish trout rainbow raw', aisle: 'proteinas' },
  { es: 'tofu', en: 'tofu raw firm', aisle: 'proteinas' },
  { es: 'tempeh', en: 'tempeh', aisle: 'proteinas' },
  { es: 'seitan', en: 'wheat gluten', aisle: 'proteinas' },

  // Dairy
  { es: 'leche desnatada', en: 'milk nonfat fluid', aisle: 'lacteos', density: 1.03 },
  { es: 'nata liquida', en: 'cream fluid heavy whipping', aisle: 'lacteos', density: 0.99 },
  { es: 'queso fresco', en: 'cheese cottage creamed', aisle: 'lacteos' },
  { es: 'queso de cabra', en: 'cheese goat soft', aisle: 'lacteos' },
  { es: 'mozzarella', en: 'cheese mozzarella whole milk', aisle: 'lacteos' },
  { es: 'feta', en: 'cheese feta', aisle: 'lacteos' },
  { es: 'queso manchego', en: 'cheese manchego', aisle: 'lacteos' },
  { es: 'queso cheddar', en: 'cheese cheddar', aisle: 'lacteos' },
  { es: 'requeson', en: 'cheese ricotta whole milk', aisle: 'lacteos' },

  // Pantry
  { es: 'aceite de girasol', en: 'oil sunflower', aisle: 'despensa', density: 0.92 },
  { es: 'vinagre de vino', en: 'vinegar red wine', aisle: 'despensa', density: 1.01 },
  { es: 'vinagre balsamico', en: 'vinegar balsamic', aisle: 'despensa', density: 1.05 },
  { es: 'vino blanco', en: 'wine table white', aisle: 'despensa', density: 0.99 },
  { es: 'vino tinto', en: 'wine table red', aisle: 'despensa', density: 0.99 },
  { es: 'caldo de pollo', en: 'soup stock chicken', aisle: 'despensa', density: 1.0 },
  { es: 'caldo de verduras', en: 'soup vegetable broth', aisle: 'despensa', density: 1.0 },
  { es: 'salsa de soja', en: 'soy sauce', aisle: 'despensa', density: 1.05 },
  { es: 'mostaza', en: 'mustard prepared yellow', aisle: 'despensa' },
  { es: 'mayonesa', en: 'mayonnaise', aisle: 'despensa' },
  { es: 'ketchup', en: 'catsup', aisle: 'despensa' },
  { es: 'azucar', en: 'sugars granulated', aisle: 'despensa' },
  { es: 'miel', en: 'honey', aisle: 'despensa' },
  { es: 'sirope de arce', en: 'syrups maple', aisle: 'despensa' },
  { es: 'levadura', en: 'leavening agents yeast bakers active dry', aisle: 'despensa' },
  { es: 'tahini', en: 'sesame butter tahini', aisle: 'despensa' },
  { es: 'pasta de tomate', en: 'tomato paste canned', aisle: 'despensa' },
  { es: 'tomate triturado', en: 'tomatoes crushed canned', aisle: 'despensa' },
  { es: 'aceitunas verdes', en: 'olives green canned', aisle: 'despensa' },
  { es: 'aceitunas negras', en: 'olives ripe canned', aisle: 'despensa' },
  { es: 'alcaparras', en: 'capers canned', aisle: 'despensa' },
  { es: 'pasas', en: 'raisins seedless', aisle: 'despensa' },

  // Grains, legumes, nuts
  { es: 'pan blanco', en: 'bread white commercially prepared', aisle: 'panaderia' },
  { es: 'cuscus', en: 'couscous dry', aisle: 'despensa' },
  { es: 'quinoa', en: 'quinoa uncooked', aisle: 'despensa' },
  { es: 'fideos', en: 'noodles egg dry', aisle: 'despensa' },
  { es: 'judias blancas', en: 'beans white mature seeds raw', aisle: 'despensa' },
  { es: 'judias rojas', en: 'beans kidney red mature seeds raw', aisle: 'despensa' },
  { es: 'almendras', en: 'nuts almonds', aisle: 'despensa' },
  { es: 'nueces', en: 'nuts walnuts english', aisle: 'despensa' },
  { es: 'avellanas', en: 'nuts hazelnuts or filberts', aisle: 'despensa' },
  { es: 'piñones', en: 'nuts pine nuts dried', aisle: 'despensa' },
  { es: 'sesamo', en: 'seeds sesame seeds whole dried', aisle: 'despensa' },
  { es: 'pipas de girasol', en: 'seeds sunflower seed kernels dried', aisle: 'despensa' },

  // Eggs (already in the catalog, but document for completeness)
  // { es: 'huevo', ... } — duplicate of existing
]

const ROOT = path.resolve(import.meta.dirname, '..')
const MAIN_MAP = path.join(ROOT, 'src/seed/data/ingredient-fdc-map.yaml')
const OUT_MAP = path.join(ROOT, 'src/seed/data/ingredient-fdc-map.expanded.yaml')

async function main() {
  const client = createUsdaClient()

  // Load existing map to dedupe
  const mainRaw = await fs.readFile(MAIN_MAP, 'utf8')
  const main = yaml.load(mainRaw) as DraftEntry[]
  const existingNames = new Set(main.map((e) => e.name.toLowerCase()))

  const toFetch = CANDIDATES.filter((c) => !existingNames.has(c.es.toLowerCase()))
  console.log(`Total candidates: ${CANDIDATES.length}`)
  console.log(`Already in catalog (skip): ${CANDIDATES.length - toFetch.length}`)
  console.log(`To fetch from USDA: ${toFetch.length}`)
  console.log('')

  const drafts: DraftEntry[] = []
  const failed: { es: string; reason: string }[] = []

  for (const c of toFetch) {
    try {
      const results = await client.searchByName(c.en, {
        limit: 5,
        preferDataTypes: ['Foundation', 'SR Legacy'],
      })
      const best = results.find((r) =>
        r.dataType === 'Foundation' || r.dataType === 'SR Legacy',
      ) ?? results[0]
      if (!best) {
        console.log(`  ✗ ${c.es}: no USDA results for "${c.en}"`)
        failed.push({ es: c.es, reason: 'no results' })
        continue
      }
      // Pre-fetch the profile so the curator's seed:usda run is faster
      try {
        await client.fetchByFdcId(best.fdcId)
      } catch (err: any) {
        console.log(`  ! ${c.es}: search ok (${best.fdcId}) but fetch failed: ${err.message}`)
      }
      const allergens = inferAllergenTagsFromName(c.es)
      drafts.push({
        name: c.es,
        fdcId: best.fdcId,
        aisle: c.aisle,
        density: c.density ?? null,
        unitWeight: c.unitWeight ?? null,
        allergenTags: allergens,
        _usdaDescription: best.description,
      })
      console.log(`  ✓ ${c.es} → fdc=${best.fdcId} (${best.dataType}) "${best.description}"`)
      // Be polite to the API
      await new Promise((r) => setTimeout(r, 120))
    } catch (err: any) {
      console.log(`  ✗ ${c.es}: ${err.message}`)
      failed.push({ es: c.es, reason: err.message })
    }
  }

  // Sort by aisle then name for readable diffs
  drafts.sort(
    (a, b) =>
      a.aisle.localeCompare(b.aisle) || a.name.localeCompare(b.name),
  )

  const yamlOut = yaml.dump(drafts, { lineWidth: 120, noRefs: true })
  const header =
    `# Draft expansion produced by scripts/expandIngredientCatalog.ts.\n` +
    `# Curator: review each entry, in particular _usdaDescription, then merge\n` +
    `# the entries you accept into ingredient-fdc-map.yaml and run seed:usda.\n` +
    `# Drop the _usdaDescription field after the curator review.\n` +
    `#\n` +
    `# Generated: ${new Date().toISOString()}\n` +
    `# Drafts: ${drafts.length} | Failed: ${failed.length}\n\n`
  await fs.writeFile(OUT_MAP, header + yamlOut, 'utf8')

  console.log('')
  console.log(`Wrote ${drafts.length} draft entries to ${OUT_MAP}`)
  if (failed.length > 0) {
    console.log(`${failed.length} failed candidates:`)
    for (const f of failed) console.log(`  - ${f.es}: ${f.reason}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[expand:catalog] Fatal:', err)
    process.exit(1)
  })
