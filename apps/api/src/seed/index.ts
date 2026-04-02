import { db, pool } from '../db/connection.js'
import { ingredients, recipes, recipeIngredients } from '../db/schema.js'
import { seedIngredients } from './ingredients.js'
import { seedRecipes } from './recipes.js'
import { eq } from 'drizzle-orm'

async function seed() {
  console.log('Seeding database...')

  // 1. Insert ingredients
  console.log(`Inserting ${seedIngredients.length} ingredients...`)
  const insertedIngredients = await db
    .insert(ingredients)
    .values(seedIngredients)
    .onConflictDoNothing()
    .returning()

  console.log(`Inserted ${insertedIngredients.length} ingredients`)

  // Build name -> id map (including previously existing)
  const allIngredients = await db.select().from(ingredients)
  const ingredientMap = new Map(allIngredients.map((i) => [i.name, i.id]))

  // 2. Insert recipes (catalog, no authorId)
  console.log(`Inserting ${seedRecipes.length} recipes...`)
  for (const recipe of seedRecipes) {
    const [inserted] = await db
      .insert(recipes)
      .values({
        name: recipe.name,
        authorId: null,
        prepTime: recipe.prepTime,
        meals: recipe.meals,
        seasons: recipe.seasons,
        tags: recipe.tags,
        steps: recipe.steps,
      })
      .onConflictDoNothing()
      .returning()

    if (!inserted) {
      console.log(`  Skipped (exists): ${recipe.name}`)
      continue
    }

    // Insert recipe_ingredients
    const riValues = recipe.ingredients
      .map((ri) => {
        const ingredientId = ingredientMap.get(ri.name)
        if (!ingredientId) {
          console.warn(`  Warning: ingredient "${ri.name}" not found for recipe "${recipe.name}"`)
          return null
        }
        return {
          recipeId: inserted.id,
          ingredientId,
          quantity: ri.quantity,
          unit: ri.unit,
        }
      })
      .filter(Boolean) as Array<{ recipeId: string; ingredientId: string; quantity: number; unit: string }>

    if (riValues.length > 0) {
      await db.insert(recipeIngredients).values(riValues).onConflictDoNothing()
    }
    console.log(`  Inserted: ${recipe.name} (${riValues.length} ingredients)`)
  }

  console.log('Seed complete!')
  await pool.end()
}

seed().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
