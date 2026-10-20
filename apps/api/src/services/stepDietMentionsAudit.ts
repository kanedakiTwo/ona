/**
 * PRO-268 — the catalogue pass behind `scripts/auditStepDietMentions.ts`:
 * which recipes' steps name meat, fish, shellfish or an allergen their
 * ingredients don't account for, plus any other catalogue ingredient the
 * steps name unlisted. Pure (recipes and catalogue names in, findings out);
 * the script reads them from the seed files or the database.
 */
import { lintRecipe, type CatalogIngredient } from './recipeLint.js'
import { DIET_CATEGORY_LABEL, unlistedDietMentions, type DietCategory } from './stepDietMentions.js'

export interface AuditRecipe {
  id?: string
  name: string
  status: string
  ingredients: string[]
  steps: string[]
}

export interface DietFinding {
  id?: string
  name: string
  status: string
  mentions: Array<{ step: number; term: string; category: DietCategory; text: string }>
}

export interface OtherFinding {
  id?: string
  name: string
  status: string
  mentions: Array<{ step: number; ingredient: string; text: string }>
}

export interface StepMentionsAudit {
  checked: number
  diet: DietFinding[]
  other: OtherFinding[]
}

export function auditStepMentions(recipes: readonly AuditRecipe[], catalogNames: readonly string[]): StepMentionsAudit {
  const catalog: CatalogIngredient[] = [...new Set(catalogNames)].map((name) => ({ id: name, name }))
  const diet: DietFinding[] = []
  const other: OtherFinding[] = []
  for (const r of recipes) {
    const base = { ...(r.id ? { id: r.id } : {}), name: r.name, status: r.status }
    const dm = unlistedDietMentions(r.steps, r.ingredients)
    if (dm.length > 0) diet.push({ ...base, mentions: dm.map((m) => ({ ...m, step: m.step + 1, text: r.steps[m.step] })) })

    const lint = lintRecipe(
      {
        name: r.name,
        servings: 4,
        ingredients: r.ingredients.map((name, i) => ({ id: `row-${i}`, ingredientId: name, quantity: 1, unit: 'u' })),
        steps: r.steps.map((text, index) => ({ index, text })),
      },
      { ingredientCatalog: catalog, force: true },
    )
    const dietTerms = new Set(dm.map((m) => `${m.step}|${m.term}`))
    const om = lint.errors
      .filter((e) => e.code === 'STEP_INGREDIENT_NOT_LISTED')
      .map((e) => {
        const step = Number(/steps\[(\d+)\]/.exec(e.path ?? '')?.[1] ?? -1)
        const ingredient = /menciona "([^"]+)"/.exec(e.message)?.[1] ?? ''
        return { step, ingredient }
      })
      .filter((m) => m.step >= 0 && m.ingredient && !dietTerms.has(`${m.step}|${m.ingredient}`))
    if (om.length > 0) other.push({ ...base, mentions: om.map((m) => ({ step: m.step + 1, ingredient: m.ingredient, text: r.steps[m.step] })) })
  }
  return { checked: recipes.length, diet, other }
}

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()

/** The report for Cocina, in Spanish (recipe names and step texts of the catalogue only). */
export function renderStepMentionsReport(a: StepMentionsAudit, meta: { date: string; source: string }): string {
  const mentions = a.diet.reduce((n, r) => n + r.mentions.length, 0)
  const byCat = new Map<DietCategory, number>()
  for (const r of a.diet) for (const m of r.mentions) byCat.set(m.category, (byCat.get(m.category) ?? 0) + 1)
  const lines: string[] = [
    `# Pasos que nombran ingredientes que la receta no tiene · ${meta.date}`,
    '',
    `PRO-268. Fuente: ${meta.source}. Solo lectura: no se ha cambiado nada.`,
    '',
    `- Recetas revisadas: **${a.checked}**`,
    `- Con carne, pescado, marisco o alérgenos en los pasos que no están en los ingredientes: **${a.diet.length}** (${mentions} menciones${byCat.size ? `: ${[...byCat].map(([c, n]) => `${DIET_CATEGORY_LABEL[c]} ${n}`).join(', ')}` : ''})`,
    `- Con otros ingredientes del catálogo en los pasos que no están en la lista: **${a.other.length}**`,
    '',
    'Para Cocina: en cada una, o se añade el ingrediente (con su cantidad) o se quita del paso. Las correcciones van por tandas para el OK de Miguel, como PRO-131.',
    '',
    '## 1. Dieta y alérgenos (lo urgente)',
    '',
  ]
  if (a.diet.length === 0) lines.push('Ninguna.', '')
  else {
    lines.push('| Receta | Estado | Paso | Menciona | Tipo | Texto del paso |', '|---|---|---|---|---|---|')
    for (const r of a.diet) {
      for (const m of r.mentions) lines.push(`| ${cell(r.name)} | ${r.status} | ${m.step} | ${m.term} | ${DIET_CATEGORY_LABEL[m.category]} | ${cell(m.text)} |`)
    }
    lines.push('')
  }
  lines.push('## 2. Otros ingredientes que nombran los pasos y no están en la lista', '')
  if (a.other.length === 0) lines.push('Ninguna.', '')
  else {
    lines.push('| Receta | Estado | Paso | Menciona | Texto del paso |', '|---|---|---|---|---|')
    for (const r of a.other) for (const m of r.mentions) lines.push(`| ${cell(r.name)} | ${r.status} | ${m.step} | ${m.ingredient} | ${cell(m.text)} |`)
    lines.push('')
  }
  return lines.join('\n')
}
