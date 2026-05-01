import { db, pool } from '../db/connection.js'
import { ingredients, recipes, recipeIngredients } from '../db/schema.js'
import { seedIngredients } from './ingredients.js'
import { seedRecipes } from './recipes.js'
import { eq, sql } from 'drizzle-orm'

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
    // Check if recipe already exists
    const [existing] = await db
      .select({ id: recipes.id })
      .from(recipes)
      .where(eq(recipes.name, recipe.name))
      .limit(1)

    let recipeId: string

    if (existing) {
      // Update imageUrl and tags for existing recipes
      await db
        .update(recipes)
        .set({
          imageUrl: recipe.imageUrl ?? null,
          tags: recipe.tags,
          steps: recipe.steps.length > 0 ? recipe.steps : undefined,
        })
        .where(eq(recipes.id, existing.id))
      recipeId = existing.id
      console.log(`  Updated: ${recipe.name}`)
    } else {
      const [inserted] = await db
        .insert(recipes)
        .values({
          name: recipe.name,
          authorId: null,
          imageUrl: recipe.imageUrl ?? null,
          prepTime: recipe.prepTime,
          meals: recipe.meals,
          seasons: recipe.seasons,
          tags: recipe.tags,
          steps: recipe.steps,
        })
        .returning()
      recipeId = inserted.id
      console.log(`  Inserted: ${recipe.name}`)
    }

    const inserted = existing ? null : { id: recipeId }
    if (existing) continue // skip ingredient insertion for existing recipes

    // Insert recipe_ingredients for new recipes
    const riValues = recipe.ingredients
      .map((ri) => {
        const ingredientId = ingredientMap.get(ri.name)
        if (!ingredientId) {
          console.warn(`  Warning: ingredient "${ri.name}" not found for recipe "${recipe.name}"`)
          return null
        }
        return {
          recipeId: recipeId,
          ingredientId,
          quantity: ri.quantity,
          unit: ri.unit,
        }
      })
      .filter(Boolean) as Array<{ recipeId: string; ingredientId: string; quantity: number; unit: string }>

    if (riValues.length > 0) {
      await db.insert(recipeIngredients).values(riValues).onConflictDoNothing()
    }
  }

  console.log('Seed complete!')
  await pool.end()
}

seed().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
