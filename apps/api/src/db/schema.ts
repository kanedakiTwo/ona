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
} from 'drizzle-orm/pg-core'

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
export const ingredients = pgTable('ingredients', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').unique().notNull(),
  category: text('category'),
  calories: real('calories').notNull().default(0),
  protein: real('protein').default(0),
  carbs: real('carbs').default(0),
  fat: real('fat').default(0),
  fiber: real('fiber').default(0),
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
  prepTime: integer('prep_time'),
  meals: text('meals').array().notNull().default([]),
  seasons: text('seasons').array().notNull().default([]),
  tags: text('tags').array().default([]),
  steps: text('steps').array().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
})

// ─── 5. recipe_ingredients (M:N join) ───────────────────────
export const recipeIngredients = pgTable('recipe_ingredients', {
  id: uuid('id').primaryKey().defaultRandom(),
  recipeId: uuid('recipe_id').notNull().references(() => recipes.id, { onDelete: 'cascade' }),
  ingredientId: uuid('ingredient_id').notNull().references(() => ingredients.id, { onDelete: 'restrict' }),
  quantity: real('quantity').notNull(),
  unit: text('unit').default('g'),
}, (table) => [
  uniqueIndex('uq_recipe_ingredient').on(table.recipeId, table.ingredientId),
  index('idx_recipe_ingredients_recipe').on(table.recipeId),
  index('idx_recipe_ingredients_ingredient').on(table.ingredientId),
])

// ─── 6. user_favorites ──────────────────────────────────────
export const userFavorites = pgTable('user_favorites', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  recipeId: uuid('recipe_id').notNull().references(() => recipes.id, { onDelete: 'cascade' }),
}, (table) => [
  uniqueIndex('uq_user_favorite').on(table.userId, table.recipeId),
  index('idx_user_favorites_user').on(table.userId),
])

// ─── 7. menus ───────────────────────────────────────────────
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

// ─── 8. shopping_lists ──────────────────────────────────────
export const shoppingLists = pgTable('shopping_lists', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  menuId: uuid('menu_id').references(() => menus.id, { onDelete: 'set null' }),
  items: jsonb('items').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})

// ─── 9. menu_logs ───────────────────────────────────────────
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

// ─── 10. user_nutrient_balance ──────────────────────────────
export const userNutrientBalance = pgTable('user_nutrient_balance', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }).unique(),
  balance: jsonb('balance').notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
})
