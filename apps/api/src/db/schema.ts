import {
  pgTable,
  uuid,
  text,
  integer,
  real,
  boolean,
  timestamp,
  date,
  jsonb,
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { UNITS, type NutritionPerServing } from '@ona/shared'

// ─── 1. users ───────────────────────────────────────────────
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: text('username').unique().notNull(),
  email: text('email').unique().notNull(),
  passwordHash: text('password_hash').notNull(),
  // Physical profile
  sex: text('sex'),
  age: integer('age'),
  weight: real('weight'),
  height: real('height'),
  activityLevel: text('activity_level').default('none'),
  // Onboarding
  householdSize: text('household_size'),
  cookingFreq: text('cooking_freq'),
  restrictions: text('restrictions').array().default([]),
  favoriteDishes: text('favorite_dishes').array().default([]),
  priority: text('priority'),
  onboardingDone: boolean('onboarding_done').default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

// ─── 2. user_settings ───────────────────────────────────────
export const userSettings = pgTable('user_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }).unique(),
  template: jsonb('template').notNull().default([]),
})

// ─── 3. ingredients ─────────────────────────────────────────
// Per-100 g nutrition lives directly on this table (calories, protein, carbs,
// fat, fiber, salt). FoodData Central ID is optional but lets us trace each
// row back to its USDA source.
export const ingredients = pgTable('ingredients', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').unique().notNull(),
  category: text('category'),
  // External provenance + shopping-aisle hint
  fdcId: integer('fdc_id'),
  aisle: text('aisle'),
  // Conversion factors so we can normalize ml/u quantities to grams
  density: real('density'),
  unitWeight: real('unit_weight'),
  // Allergen tags (e.g. "gluten", "lactose", "egg", "fish")
  allergenTags: text('allergen_tags').array().default([]),
  // Per-100 g nutrition (existing columns; salt added here)
  calories: real('calories').notNull().default(0),
  protein: real('protein').default(0),
  carbs: real('carbs').default(0),
  fat: real('fat').default(0),
  fiber: real('fiber').default(0),
  salt: real('salt').default(0),
  seasons: text('seasons').array().default([]),
  vitamins: jsonb('vitamins').default({}),
  minerals: jsonb('minerals').default({}),
  aminoAcids: jsonb('amino_acids').default({}),
  fatAcids: jsonb('fat_acids').default({}),
  carbTypes: jsonb('carb_types').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_ingredients_name').on(table.name),
])

// ─── 4. recipes ─────────────────────────────────────────────
export const recipes = pgTable('recipes', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
  imageUrl: text('image_url'),

  // Yield / portioning — every recipe must declare its diner count
  servings: integer('servings').notNull(),
  yieldText: text('yield_text'),

  // Times (minutes). totalTime is server-derived.
  prepTime: integer('prep_time'),
  cookTime: integer('cook_time'),
  activeTime: integer('active_time'),
  totalTime: integer('total_time'),

  difficulty: text('difficulty').default('medium'),

  meals: text('meals').array().notNull().default([]),
  seasons: text('seasons').array().notNull().default([]),

  equipment: text('equipment').array().default([]),
  /** Auto-aggregated from ingredients on save */
  allergens: text('allergens').array().default([]),

  notes: text('notes'),
  tips: text('tips'),
  substitutions: text('substitutions'),
  storage: text('storage'),

  /** Cached nutrition per serving — recomputed on every save */
  nutritionPerServing: jsonb('nutrition_per_serving').$type<NutritionPerServing>().default({} as NutritionPerServing),

  /** Public-facing tags */
  tags: text('tags').array().default([]),
  /** Hidden from public UI */
  internalTags: text('internal_tags').array().default([]),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
})

// ─── 5. recipe_ingredients (M:N join) ───────────────────────
// CHECK constraint on `unit` enforces the Unit enum from @ona/shared.
// No unique (recipe_id, ingredient_id) — sectioned recipes may legitimately
// list the same ingredient in two sections (e.g. "Para la masa" + "Para la salsa").
export const recipeIngredients = pgTable('recipe_ingredients', {
  id: uuid('id').primaryKey().defaultRandom(),
  recipeId: uuid('recipe_id').notNull().references(() => recipes.id, { onDelete: 'cascade' }),
  ingredientId: uuid('ingredient_id').notNull().references(() => ingredients.id, { onDelete: 'restrict' }),
  section: text('section'),
  quantity: real('quantity').notNull(),
  unit: text('unit').notNull().default('g'),
  optional: boolean('optional').notNull().default(false),
  note: text('note'),
  displayOrder: integer('display_order').notNull().default(0),
}, (table) => [
  index('idx_recipe_ingredients_recipe').on(table.recipeId),
  index('idx_recipe_ingredients_ingredient').on(table.ingredientId),
  check(
    'recipe_ingredients_unit_check',
    sql.raw(`unit IN (${UNITS.map((u) => `'${u}'`).join(', ')})`),
  ),
])

// ─── 6. recipe_steps ────────────────────────────────────────
// One row per step. `ingredientRefs` references recipe_ingredients.id
// (not ingredients.id) so the same ingredient in two sections is unambiguous.
export const recipeSteps = pgTable('recipe_steps', {
  id: uuid('id').primaryKey().defaultRandom(),
  recipeId: uuid('recipe_id').notNull().references(() => recipes.id, { onDelete: 'cascade' }),
  index: integer('index').notNull(),
  text: text('text').notNull(),
  durationMin: integer('duration_min'),
  temperature: integer('temperature'),
  technique: text('technique'),
  ingredientRefs: uuid('ingredient_refs').array().default(sql`ARRAY[]::uuid[]`),
}, (table) => [
  index('idx_recipe_steps_recipe').on(table.recipeId),
  uniqueIndex('uq_recipe_step_order').on(table.recipeId, table.index),
])

// ─── 7. user_favorites ──────────────────────────────────────
export const userFavorites = pgTable('user_favorites', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  recipeId: uuid('recipe_id').notNull().references(() => recipes.id, { onDelete: 'cascade' }),
}, (table) => [
  uniqueIndex('uq_user_favorite').on(table.userId, table.recipeId),
  index('idx_user_favorites_user').on(table.userId),
])

// ─── 8. menus ───────────────────────────────────────────────
export const menus = pgTable('menus', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  weekStart: date('week_start').notNull(),
  days: jsonb('days').notNull(),
  locked: jsonb('locked').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_menus_user_week').on(table.userId, table.weekStart),
])

// ─── 9. shopping_lists ──────────────────────────────────────
export const shoppingLists = pgTable('shopping_lists', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  menuId: uuid('menu_id').references(() => menus.id, { onDelete: 'set null' }),
  items: jsonb('items').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

// ─── 10. menu_logs ──────────────────────────────────────────
export const menuLogs = pgTable('menu_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  menuId: uuid('menu_id').references(() => menus.id, { onDelete: 'set null' }),
  weekStart: date('week_start').notNull(),
  aggregatedNutrients: jsonb('aggregated_nutrients').notNull(),
  caloriesTotal: real('calories_total').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_menu_logs_user').on(table.userId),
])

// ─── 11. user_nutrient_balance ──────────────────────────────
export const userNutrientBalance = pgTable('user_nutrient_balance', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }).unique(),
  balance: jsonb('balance').notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
})
