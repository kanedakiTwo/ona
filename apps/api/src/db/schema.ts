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
  bigint,
  smallint,
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { UNITS, type MenuFit, type NutritionPerServing } from '@ona/shared'

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
  /** @deprecated Replaced by `adults` + `kidsCount`. Kept while consumers backfill. */
  householdSize: text('household_size'),
  /** Adults plus children > 10 years (≥ 1). */
  adults: integer('adults').notNull().default(2),
  /** Children aged 2 to 10. <2 don't count, >10 count as adults. */
  kidsCount: integer('kids_2_to_10').notNull().default(0),
  cookingFreq: text('cooking_freq'),
  restrictions: text('restrictions').array().default([]),
  favoriteDishes: text('favorite_dishes').array().default([]),
  priority: text('priority'),
  onboardingDone: boolean('onboarding_done').default(false),
  /**
   * «Primeros pasos» guide on /menu (PRO-07). Only POST /register sets it to
   * true; the column default is false, so accounts created before it existed
   * never see the guide. Seeing it (or skipping it) sets it back to false.
   */
  firstStepsPending: boolean('first_steps_pending').notNull().default(false),
  /**
   * The one WhatsApp reminder card on /menu (PRO-107): stamped the first time
   * it is shown, so it never shows again (nor after «Ahora no»).
   */
  whatsappNudgeAt: timestamp('whatsapp_nudge_at', { withTimezone: true }),
  /**
   * Mimo's one offer to invite another household after a resolved week
   * (PRO-164): stamped when it is appended to a reply, so it never repeats.
   */
  inviteOfferAt: timestamp('invite_offer_at', { withTimezone: true }),
  /** A «no» to that offer (PRO-164): it stays off for good. */
  inviteOfferDeclinedAt: timestamp('invite_offer_declined_at', { withTimezone: true }),
  /**
   * «Afina tu menú» (PRO-146) offers: `{ introAt?, introChoice?: 'start'|'later',
   * cardDismissedAt?, onboardingAt?, whatsappOfferedAt?, flags?: ('carne'|'pescado')[] }`.
   * Each offer is stamped once so it never repeats.
   */
  tasteState: jsonb('taste_state').notNull().default(sql`'{}'::jsonb`),
  /**
   * «Familia en el mismo hogar» offers (D-088): `{ alta?, compra?, mimo?,
   * mimoDeclined? }` ISO dates. Each moment is stamped the first time it is
   * shown, so it never repeats (PRO-261 sign-up and list, PRO-262 Mimo).
   */
  familyInviteOffers: jsonb('family_invite_offers').notNull().default(sql`'{}'::jsonb`),
  /**
   * Mimo's one question about leftovers (PRO-285, WhatsApp beta until
   * 2026-11-07): stamped when it goes at the end of a reply, so it never repeats.
   */
  leftoversQuestionAt: timestamp('leftovers_question_at', { withTimezone: true }),
  // Authorization
  role: text('role').notNull().default('user'),
  // Suspension (admin gate). NULL = active.
  suspendedAt: timestamp('suspended_at', { withTimezone: true }),
  /** When the user ticked «Tengo 14 años o más» at sign-up (LOPDGDD art. 7, PRO-23). */
  ageConfirmedAt: timestamp('age_confirmed_at', { withTimezone: true }),
  /**
   * «El menú de los viernes» newsletter (PRO-95, specs/newsletter.md): a
   * separate, optional consent (LSSI art. 21–22) from /register or the
   * profile. Date + text version stored when given; turning it off keeps them.
   */
  newsletterOptIn: boolean('newsletter_opt_in').notNull().default(false),
  newsletterConsentAt: timestamp('newsletter_consent_at', { withTimezone: true }),
  newsletterConsentVersion: text('newsletter_consent_version'),
  /**
   * The «Avisos» screen's switches per alert kind (PRO-237, D-080;
   * specs/notifications.md): `{ prep_alerts: false }` = off on every channel.
   * Missing key = on. Kept in sync with `whatsapp_links.prefs` on every write.
   */
  alertPrefs: jsonb('alert_prefs').notNull().default({}).$type<Record<string, boolean>>(),
  /**
   * «Aprender de lo que hago» off (PRO-317, D-110; RGPD art. 21): since when
   * the nightly refiner leaves this person's signals out and deduces nothing
   * new about them. What the ficha already knows stays. Null = on.
   */
  profileLearningPausedAt: timestamp('profile_learning_paused_at', { withTimezone: true }),
  /**
   * Explicit consent for health data (RGPD art. 9, PRO-21): when it was given,
   * which text version, and when it was withdrawn. Both dates stay as the
   * record; it is in force when consent_at is later than withdrawn_at.
   */
  healthConsentAt: timestamp('health_consent_at', { withTimezone: true }),
  healthConsentVersion: text('health_consent_version'),
  healthConsentWithdrawnAt: timestamp('health_consent_withdrawn_at', { withTimezone: true }),
  /**
   * «No tengo ninguna» on «Tus alergias y tu dieta» (PRO-347): the person
   * said they have no allergy nor diet. Not health data, so it needs no
   * consent; cleared when restrictions are saved or the consent withdrawn.
   */
  allergiesNoneAt: timestamp('allergies_none_at', { withTimezone: true }),
  /**
   * Personal invitation code (PRO-162): `<web>/?invita=<code>`, same format
   * as the waitlist's. Reuses the person's waitlist code when they came from
   * the list; assigned on sign-up or the first time it's asked for.
   */
  referralCode: text('referral_code'),
  /** Code of whoever invited this account (an account's or a waitlist person's), never their email. */
  invitedByCode: text('invited_by_code'),
  /** Where the sign-up came from: `?ref` and `utm_*` carried from the landing (PRO-162). */
  signupAttribution: jsonb('signup_attribution').$type<{ source: string | null; utmSource: string | null; utmMedium: string | null; utmCampaign: string | null }>(),
  /** Campaign invitation link the account signed up with (PRO-27); null = none. */
  inviteCampaignId: uuid('invite_campaign_id').references(() => inviteCampaigns.id, { onDelete: 'set null' }),
  /**
   * AI image-generation quota. `imageGenMonthKey` stores the YYYY-MM that
   * `imageGenCount` belongs to. On any generation, if the key doesn't match
   * the current month the count is reset to 1 atomically — stateless monthly
   * reset, no cron job. See POST /recipes/:id/regenerate-image.
   */
  imageGenMonthKey: text('image_gen_month_key'),
  imageGenCount: integer('image_gen_count').notNull().default(0),
  /**
   * Advisor (text-AI chat) monthly spend cap. `advisorSpendMonthKey` stores
   * the YYYY-MM that `advisorSpendMicros` belongs to; on the first chat of a
   * new month the running total resets to that turn's cost atomically — same
   * stateless monthly reset as the image quota, no cron. Spend is accumulated
   * in micro-euros (1e-6 €) so we never lose sub-cent token costs to integer
   * rounding. See services/advisorBudget.ts + POST /assistant/:userId/chat.
   */
  advisorSpendMonthKey: text('advisor_spend_month_key'),
  advisorSpendMicros: bigint('advisor_spend_micros', { mode: 'number' })
    .notNull()
    .default(0),
  /**
   * The household this user reads from by default — set automatically on
   * registration and reassigned when the user joins another household via
   * invite or leaves their current one. Nullable during the migration
   * window; the auth middleware will fail with `code: 'NO_HOUSEHOLD'` if
   * a fully-migrated user somehow lands here without a primary household.
   */
  primaryHouseholdId: uuid('primary_household_id'),
  /**
   * When the first-steps answers were saved (web or WhatsApp, PRO-151): the
   * day the household's ficha reads the sign-up answers as signals. Kept from
   * the first time; null for accounts onboarded before 0063.
   */
  onboardingCompletedAt: timestamp('onboarding_completed_at', { withTimezone: true }),
  /** The free «tu caso» text of the sign-up (PRO-138), ≤ 500 chars, as typed. */
  onboardingNote: text('onboarding_note'),
  /**
   * The web sign-up in progress (PRO-178): step + answers so far
   * (`onboardingDraftSchema`, never health data), so a return visit resumes
   * there. Cleared when the sign-up is saved.
   */
  onboardingDraft: jsonb('onboarding_draft'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  check('users_role_check', sql.raw("role IN ('user','admin')")),
  uniqueIndex('uq_users_referral_code').on(table.referralCode),
  index('idx_users_suspended').on(table.suspendedAt),
])

// ─── 1b. user_memories ──────────────────────────────────────
// Typed fact storage the assistant reads on every skill call. One row per
// (user_id, key) — upsert semantics. Keys come from `MEMORY_KEYS` in
// `@ona/shared`; values are JSONB validated against the registry's per-
// key Zod schema at the route layer. The advisor composes a Spanish
// digest from these rows and injects it as a cached prompt chunk so
// every skill call gets the user's profile context.
export const userMemories = pgTable('user_memories', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  value: jsonb('value').notNull(),
  /** 'onboarding' | 'manual' | 'inferred'. See @ona/shared MEMORY_SOURCES. */
  source: text('source').notNull().default('manual'),
  /** 0..1 — lets inferred facts be downgraded vs. manual ones. */
  confidence: real('confidence').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('uq_user_memory_user_key').on(table.userId, table.key),
  index('idx_user_memory_user').on(table.userId),
])

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
  /**
   * PRO-194: share of the weight as bought that is eaten (0–1, default 1).
   * Bone-in cuts (gallina, muslo, alitas, costillas, chuletón, manitas…)
   * carry the USDA refuse: the per-100 g values are of the edible part.
   * Nutrition and the catalogue audit multiply grams by it.
   */
  edibleFraction: real('edible_fraction').notNull().default(1),
  // Allergen tags (e.g. "gluten", "lactose", "egg", "fish")
  allergenTags: text('allergen_tags').array().default([]),
  /**
   * PRO-198: what a compound ingredient is made of («Sobras del cocido» →
   * cerdo, ternera, pollo, gluten), from `CONTAINS_TAGS`
   * (services/compoundIngredients.ts). The diet filter reads these tags like
   * words of the name, so «sin cerdo» sees pork its name doesn't say.
   */
  containsTags: text('contains_tags').array().notNull().default([]),
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
  /**
   * Prep-time requirements that need anticipating in advance. Populated by
   * the LLM script `pnpm prep-requirements:populate` over the catalogue; the
   * notification scheduler (PR-D) reads it to enqueue "saca el pescado del
   * congelador" alerts. Shape:
   *   { method: 'thaw_24h' | 'thaw_48h' | 'soak_overnight' | ..., notes?: string }
   * Null for ingredients that need nothing special (most produce).
   */
  prepRequirements: jsonb('prep_requirements').$type<{ method: string; notes?: string } | null>(),
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

  /** Course classification: 'starter' | 'main' | 'dessert' | null; validated at app layer. */
  course: text('course'),

  meals: text('meals').array().notNull().default([]),
  seasons: text('seasons').array().notNull().default([]),

  /**
   * Three-state fit per meal/season: `{ [meal]: 'mid' | 'perfect' }`.
   * Absent key = 'none' (matcher excludes the slot). Null on legacy rows;
   * the API derives 'perfect' for every entry in the legacy `meals` /
   * `seasons` arrays so old data still matches.
   */
  mealFit: jsonb('meal_fit'),
  seasonFit: jsonb('season_fit'),

  equipment: text('equipment').array().default([]),
  /** Auto-aggregated from ingredients on save */
  allergens: text('allergens').array().default([]),

  notes: text('notes'),
  tips: text('tips'),
  substitutions: text('substitutions'),
  storage: text('storage'),
  /**
   * PRO-372: «Se puede congelar» / «No se congela» and «Aguanta N días en
   * nevera» seals on the ficha. Null = no data yet (no seal). Filled by
   * Cocina in the batch, by the rewriter, or by the boot backfill
   * (`catalogStorageLabels.ts`) for catalogue recipes.
   */
  freezable: boolean('freezable'),
  fridgeDays: smallint('fridge_days'),
  /**
   * PRO-220 (D-069): «preparativos con antelación» of the recipe itself —
   * `[{ text: 'Saca el filete del frigorífico', hoursBefore: 1.5 }]`. Prep
   * alerts come from these without the household's prep habits. Filled by
   * Cocina (COC-12). Empty = none.
   */
  advancePrep: jsonb('advance_prep').notNull().default([]).$type<Array<{ text: string; hoursBefore: number }>>(),

  /** Cached nutrition per serving — recomputed on every save. NULL until first compute. */
  nutritionPerServing: jsonb('nutrition_per_serving').$type<NutritionPerServing>(),
  /**
   * PRO-176: true when the last compute had to skip an ingredient that
   * matters (no unit weight / density / catalogue row; salt, water, spices
   * and «al gusto» don't count). The ficha then shows no figures. Set on
   * save and recomputed on every boot (`nutritionCompleteness.ts`).
   */
  nutritionIncomplete: boolean('nutrition_incomplete').notNull().default(false),

  /** Public-facing tags */
  tags: text('tags').array().default([]),
  /** Hidden from public UI */
  internalTags: text('internal_tags').array().default([]),

  /** Origin URL when imported from an article / YouTube video (null otherwise). */
  sourceUrl: text('source_url'),
  /** Provenance enum: 'manual' | 'image' | 'article' | 'youtube'. */
  sourceType: text('source_type'),
  /**
   * Back-reference from a user-owned copy to the recipe it was copied from.
   * Set by `POST /recipes/:id/copy`. The catalogue listing uses this to
   * suppress the original from the user's view when they already have a
   * copy — see migration 0025.
   */
  copiedFromRecipeId: uuid('copied_from_recipe_id'),

  /**
   * Per-recipe scheduling hint for the menu matcher. Null = the default
   * "normal" weight. `frequent` doubles the pool weight, `occasional`
   * reduces it to 0.4×, `weekends_only` excludes the recipe from Mon-Fri
   * slots entirely. Constraint-checked at the DB layer (migration 0026).
   */
  frequency: text('frequency'),

  /** How confident was the extractor about the servings count. */
  servingsConfidence: text('servings_confidence', { enum: ['explicit', 'estimated'] })
    .notNull()
    .default('explicit'),

  /**
   * PRO-154 (specs/catalog-import.md): a catalogue recipe brought in by the
   * batch import starts as 'draft' — nobody sees it and the menu never picks
   * it — until the batch is published. Everything else is 'published'.
   */
  status: text('status').notNull().default('published'),
  /**
   * Where a batch-imported catalogue recipe comes from (book and page, never
   * its text), whose source it is (`miguel` | `cocina`), the credit line the
   * recipe page shows, the batch, and the review state:
   * `{ origin, book?, page?, file?, credit?, batch, auditIssues[],
   * allergenDoubt, sampled?, reviewedAt? }`. Null for every other recipe.
   */
  catalogSource: jsonb('catalog_source').$type<CatalogSourceInfo>(),
  /** Batch id of the catalogue import (PRO-154); null otherwise. */
  importBatch: text('import_batch'),

  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => [
  index('idx_recipes_import_batch').on(t.importBatch),
  check('recipes_status_check', sql.raw("status IN ('draft','published')")),
])

/** `recipes.catalog_source` (PRO-154). */
export interface CatalogSourceInfo {
  origin: 'miguel' | 'cocina'
  book?: string | null
  page?: string | null
  file?: string | null
  /**
   * D-067: the line the recipe page shows under the title («Receta de la
   * Yaya», «Inspirada en una receta de <autor>, «<libro>»»). Only this —
   * through `catalogSourceCredit` — ever leaves the API; the rest stays inside.
   */
  credit?: string | null
  batch: string
  auditIssues: string[]
  allergenDoubt: boolean
  /** Picked for Miguel's one-in-ten review (Cocina batches). */
  sampled?: boolean
  /** Miguel's verdict on a sampled recipe (true OK / false not OK). */
  reviewOk?: boolean
  /** When Miguel gave it. */
  reviewedAt?: string | null
  /**
   * Publishing was asked for while the photo wasn't made yet: catalogPhotos.ts
   * publishes it as soon as the photo is saved (if the rule still allows it).
   */
  publishWhenPhoto?: boolean
}

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
  /** Human-readable quantity as the recipe originally stated it (e.g. 1.5 for "1½"). */
  displayQuantity: real('display_quantity'),
  /** Human-readable unit as the recipe originally stated it (e.g. "taza", "cucharada"). */
  displayUnit: text('display_unit'),
}, (table) => [
  index('idx_recipe_ingredients_recipe').on(table.recipeId),
  index('idx_recipe_ingredients_ingredient').on(table.ingredientId),
  // Sourced from UNITS in @ona/shared at codegen time. If UNITS changes,
  // re-run `pnpm --filter @ona/api db:generate` to regenerate this CHECK.
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
  /**
   * PR 1B: scope key. Backfilled from `users.primary_household_id`. New
   * inserts must populate. When `SHARED_HOUSEHOLD_SCOPE=true`, reads filter
   * by `householdId` so every member of a household sees the same favorites.
   * Nullable for the migration window; once prod is fully backfilled and the
   * flag is permanently on, we'll flip to NOT NULL in a follow-up.
   */
  householdId: uuid('household_id').references(() => households.id, { onDelete: 'cascade' }),
  recipeId: uuid('recipe_id').notNull().references(() => recipes.id, { onDelete: 'cascade' }),
}, (table) => [
  uniqueIndex('uq_user_favorite').on(table.userId, table.recipeId),
  index('idx_user_favorites_user').on(table.userId),
  index('idx_user_favorites_household').on(table.householdId),
])

// ─── 8. menus ───────────────────────────────────────────────
export const menus = pgTable('menus', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** PR 1B scope key. See `user_favorites.householdId` for the lifecycle note. */
  householdId: uuid('household_id').references(() => households.id, { onDelete: 'cascade' }),
  weekStart: date('week_start').notNull(),
  days: jsonb('days').notNull(),
  locked: jsonb('locked').default({}),
  /**
   * Per-week veto list. The recipe matcher excludes these ids when picking
   * candidates for any slot in this menu. Scoped to one menu — the user's
   * profile is unchanged, so next week's menu starts with an empty veto list.
   */
  bannedRecipeIds: text('banned_recipe_ids').array().notNull().default(sql`ARRAY[]::text[]`),
  /**
   * Day indices (0-6) the user marked as "sin cocinar". Whole-week
   * regeneration skips these — slots stay empty until the user adds them
   * back manually.
   */
  skippedDays: integer('skipped_days').array().notNull().default(sql`ARRAY[]::integer[]`),
  /**
   * «Cuánto ha acertado» (PRO-155, services/menuFit.ts): the evaluator's
   * verdict on the week as generated. Null when it didn't run or failed.
   */
  fit: jsonb('fit').$type<MenuFit>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_menus_user_week').on(table.userId, table.weekStart),
  index('idx_menus_household_week').on(table.householdId, table.weekStart),
])

// ─── 9. shopping_lists ──────────────────────────────────────
export const shoppingLists = pgTable('shopping_lists', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** PR 1B scope key. See `user_favorites.householdId` for the lifecycle note. */
  householdId: uuid('household_id').references(() => households.id, { onDelete: 'cascade' }),
  /** Reference to *a* covering menu — kept for backwards compat with the
   *  old single-menu listing model. The new aggregator finds every menu in
   *  the date range via `(userId, weekStart)` matching, so this column is
   *  only filled with the first menu in range as a soft hint. */
  menuId: uuid('menu_id').references(() => menus.id, { onDelete: 'set null' }),
  /**
   * Inclusive date range the list covers. Both columns are filled on every
   * regenerate; the route uses them to decide which menus to aggregate
   * across. Pre-migration rows have NULL — the route falls back to the
   * "current week" default the first time the list is touched.
   */
  rangeStartDate: date('range_start_date'),
  rangeEndDate: date('range_end_date'),
  items: jsonb('items').notNull(),
  /**
   * State the user gave each product `(ingredientId|unit)` → { checked,
   * inStock, pricePerUnit }, remembered across rebuilds so a product absent
   * from the range on screen keeps it (2026-10-10). See shoppingItemState.ts.
   */
  itemState: jsonb('item_state'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_shopping_lists_household').on(table.householdId),
])

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

// ─── 12. voice_transcripts ──────────────────────────────────
// Append-only log of every voice-mode turn (user + assistant), so we can
// analyse how the assistant performs in conversation: where the model is
// over-verbose, which skills fire, which user phrasings the model misses.
//
// Populated by the client (`useRealtimeSession`) via POST /realtime/:userId/transcript.
// One row per turn; group by `sessionId` to reconstruct a conversation.
export const voiceTranscripts = pgTable('voice_transcripts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** Client-generated UUID per overlay open. Multiple turns share one sessionId. */
  sessionId: text('session_id').notNull(),
  /** 'user' | 'assistant' — role of the turn being logged. */
  role: text('role').notNull(),
  content: text('content').notNull(),
  /** Skill the assistant invoked during this turn, if any. */
  skillUsed: text('skill_used'),
  /** Free-form metadata: model, latency, error, etc. */
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_voice_transcripts_user_session').on(table.userId, table.sessionId),
  index('idx_voice_transcripts_created').on(table.createdAt),
])

// ─── 13. password_reset_tokens ──────────────────────────────
// Single-use opaque tokens. Admin generates one and pastes the link to
// the user out-of-band; the user trades it in at /reset?token=X.
export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  index('idx_password_reset_user').on(table.userId),
])

// ─── 14. admin_audit_log ────────────────────────────────────
// Append-only. Every successful admin mutation lands here.
// Action codes are stable forever — never rename, only add.
export const adminAuditLog = pgTable('admin_audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  adminId: uuid('admin_id').notNull().references(() => users.id),
  action: text('action').notNull(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id'),
  payload: jsonb('payload').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('idx_admin_audit_log_created').on(table.createdAt),
  index('idx_admin_audit_log_admin').on(table.adminId, table.createdAt),
  index('idx_admin_audit_log_action').on(table.action),
])

// ─── 15. unit_conversion_cache ──────────────────────────────
// Maps a display unit (e.g. "taza", "cucharada") to canonical grams or ml.
// Rows are keyed on (display_unit, ingredient_id): a NULL ingredient_id means
// the conversion is generic (water-density assumption). We use a synthetic uuid
// PK plus a partial-unique index with COALESCE to handle nullability — Postgres
// rejects NULL in composite primary keys.
export const unitConversionCache = pgTable('unit_conversion_cache', {
  id: uuid('id').defaultRandom().primaryKey(),
  displayUnit: text('display_unit').notNull(),
  ingredientId: uuid('ingredient_id').references(() => ingredients.id, { onDelete: 'cascade' }),
  gramsPerUnit: real('grams_per_unit'),
  mlPerUnit: real('ml_per_unit'),
  source: text('source', { enum: ['llm', 'manual'] }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_unit_cache_unit').on(t.displayUnit),
  // NULL-safe uniqueness: same display_unit can have one generic + N per-ingredient rows.
  uniqueIndex('idx_unit_cache_key').on(
    t.displayUnit,
    sql`COALESCE(${t.ingredientId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
  ),
  check('unit_conversion_cache_value_check', sql`${t.gramsPerUnit} IS NOT NULL OR ${t.mlPerUnit} IS NOT NULL`),
])

// ─── 16. households ─────────────────────────────────────────
// Owner of every household-scoped resource (menus, shopping, pantry,
// favorites, cook_logs, recipe-collection rows). Every user is backfilled
// into a solo household on first deploy; joining/leaving is via invitation
// + accept (see `household_invites`). The owner can rename + invite + remove
// members. Members can leave.
export const households = pgTable('households', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().default('Mi casa'),
  ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  /** PRO-135: when the «te quedan 2 días de prueba» email went to the owner (once). */
  trialEndingEmailAt: timestamp('trial_ending_email_at', { withTimezone: true }),
  /** PRO-136: when the day-7 founder-price offer went out by email / WhatsApp (once). */
  founderOfferAt: timestamp('founder_offer_at', { withTimezone: true }),
}, (t) => [
  index('idx_households_owner').on(t.ownerId),
])

// ─── 17. household_members ──────────────────────────────────
// M:N join between users + households. A user can belong to multiple
// households (e.g., student living at home + new flat); their
// `users.primary_household_id` decides which one drives every read.
export const householdMembers = pgTable('household_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** 'owner' | 'member' | 'child'. Owner can manage members; children can read everything but can't suspend/invite. */
  role: text('role').notNull().default('member'),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_household_member').on(t.householdId, t.userId),
  index('idx_household_members_user').on(t.userId),
  check('household_members_role_check', sql.raw("role IN ('owner','member','child')")),
])

// PRO-230 (D-069): «hoy cocina Pablo» — who cooks a given day, only when
// someone asks Mimo. That day's prep alerts go to this person.
export const cookOfDay = pgTable('cook_of_day', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  /** Madrid calendar day (YYYY-MM-DD). */
  day: date('day').notNull(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  assignedBy: uuid('assigned_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('uq_cook_of_day').on(t.householdId, t.day)])

// ─── 18. household_invites ──────────────────────────────────
// One-time tokens the owner generates and shares manually (mirrors the
// admin password-reset flow — no email is auto-sent). Token is a 32-char
// random string; `consumed_at` flips once the recipient accepts.
export const householdInvites = pgTable('household_invites', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  invitedByUserId: uuid('invited_by_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** Optional preview email so the owner remembers who they invited. */
  email: text('email'),
  /** Random 32-char string the recipient pastes into /invites/:token. */
  token: text('token').notNull(),
  /** Role the new member assumes on accept. */
  role: text('role').notNull().default('member'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  consumedByUserId: uuid('consumed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  /**
   * Where it was prepared (PRO-260/263, `HOUSEHOLD_INVITE_SOURCES`): `casa`
   * (Mi casa; also every invite before 2026-10-20), `alta`, `compra`, `mimo`.
   */
  source: text('source').notNull().default('casa'),
  /**
   * First time it was handed on: «Enviar por WhatsApp» or «Copiar» tapped,
   * or Mimo giving the link (PRO-260). Null = prepared but never sent.
   */
  sharedAt: timestamp('shared_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_household_invite_token').on(t.token),
  index('idx_household_invites_household').on(t.householdId),
  check('household_invites_role_check', sql.raw("role IN ('member','child')")),
])

// ─── 17. cook_logs (PR 6) ────────────────────────────────────────
// Append-only log of every "we cooked this" event. Feeds the times-cooked
// counter on recipe cards, the last-cooked badge, and the adherence
// analytics ("planeaste 21, cocinaste 15"). Always household-scoped — a
// recipe cooked by anyone in the household counts for the whole house.
//
// `menuId`/`dayIndex`/`meal` are nullable so off-menu cooking (made an old
// favourite, didn't put it on the weekly plan) still logs cleanly.
//
// We never UPDATE rows here; corrections happen via DELETE + new INSERT.
export const cookLogs = pgTable('cook_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  householdId: uuid('household_id').references(() => households.id, { onDelete: 'cascade' }),
  recipeId: uuid('recipe_id').notNull().references(() => recipes.id, { onDelete: 'cascade' }),
  menuId: uuid('menu_id').references(() => menus.id, { onDelete: 'set null' }),
  /** 0=Monday … 6=Sunday — matches `menus.days` ordering. */
  dayIndex: integer('day_index'),
  /** breakfast | lunch | dinner | snack — same canonical set as the menu. */
  meal: text('meal'),
  cookedAt: timestamp('cooked_at', { withTimezone: true }).notNull().defaultNow(),
  /** Measured cooking time in minutes — populated from cooking mode or manual entry. */
  durationMin: integer('duration_min'),
  /** Short free-form note ("Sin cebolla, le faltó sal"). Max 500 chars at the API layer. */
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_cook_logs_household_cooked').on(t.householdId, t.cookedAt),
  index('idx_cook_logs_recipe').on(t.recipeId),
])

// ─── 24. recipe_photos (PR 8C) ────────────────────────────────
// Multi-photo gallery per recipe. `recipes.image_url` stays as the
// canonical hero shot; this table layers additional photos (cook
// results, plating variations, "look how it came out"). Household-shared
// so any member can upload; `uploaded_by_user_id` keeps the audit trail.
//
// Storage: same Railway volume as the AI-generated hero images
// (`IMAGE_STORAGE_DIR` + `IMAGE_PUBLIC_URL_BASE`). One JPEG per row,
// keyed by a UUID-named file.
export const recipePhotos = pgTable('recipe_photos', {
  id: uuid('id').primaryKey().defaultRandom(),
  recipeId: uuid('recipe_id').notNull().references(() => recipes.id, { onDelete: 'cascade' }),
  /** Scope key — only callers in this household see / edit the photo. */
  householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  /** Author of the upload — kept for the audit even if the user is later deleted. */
  uploadedByUserId: uuid('uploaded_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  /** Public URL (`${IMAGE_PUBLIC_URL_BASE}/<uuid>.jpg`) — written by the upload route. */
  imageUrl: text('image_url').notNull(),
  /** Optional caption ("salió crujiente esta vez"). Up to 280 chars. */
  caption: text('caption'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_recipe_photos_recipe').on(t.recipeId),
  index('idx_recipe_photos_household').on(t.householdId),
])

// ─── 23. cookbooks (PR 8A) ────────────────────────────────────
// Named groupings of recipes ("Favoritos de Sara", "Para diabéticos",
// "Recetas de mi madre"). Household-shared — any member can create,
// rename, add / remove recipes, delete. Recipes can belong to many
// cookbooks; the join table `cookbook_recipes` enforces uniqueness per
// (cookbook, recipe).
export const cookbooks = pgTable('cookbooks', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  /** Single emoji or short symbol (≤ 8 chars) for the cover tile. */
  emoji: text('emoji'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_cookbooks_household').on(t.householdId),
])

export const cookbookRecipes = pgTable('cookbook_recipes', {
  id: uuid('id').primaryKey().defaultRandom(),
  cookbookId: uuid('cookbook_id').notNull().references(() => cookbooks.id, { onDelete: 'cascade' }),
  recipeId: uuid('recipe_id').notNull().references(() => recipes.id, { onDelete: 'cascade' }),
  addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_cookbook_recipes_cookbook_recipe').on(t.cookbookId, t.recipeId),
  index('idx_cookbook_recipes_recipe').on(t.recipeId),
])

// ─── 22. pantry_items (PR 11) ─────────────────────────────────
// Real pantry register — household-shared. Each row tracks quantity, unit,
// and optional expiry for one ingredient (catalog row) OR one free-text
// item (no `ingredientId`). The cook-log handler auto-decrements matching
// rows when the user marks a meal cooked. With unit mismatch, we no-op
// silently (cross-unit conversion lands in a follow-up).
//
// `(household_id, ingredient_id)` is unique when the catalog reference is
// set — partial unique index — so a household can't accumulate duplicate
// "100g rice" rows for the same catalog ingredient.
export const pantryItems = pgTable('pantry_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  ingredientId: uuid('ingredient_id').references(() => ingredients.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  quantity: real('quantity').notNull().default(0),
  unit: text('unit').notNull().default('u'),
  /** Best-before date the user entered. null = no expiry tracked. */
  expiresAt: date('expires_at'),
  /** PRO-228: where it is — 'nevera' | 'congelador' | 'despensa' (PANTRY_LOCATIONS). */
  location: text('location').notNull().default('despensa'),
  /** PRO-228: when it went into that place (reset when it moves); null = created_at. */
  storedAt: timestamp('stored_at', { withTimezone: true }),
  /** Bumped every time we decrement or the user edits. */
  lastUpdatedAt: timestamp('last_updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_pantry_items_household').on(t.householdId),
  // Partial unique index can't be expressed in drizzle today — enforced via
  // a raw `CREATE UNIQUE INDEX … WHERE` in the migration file.
])

// ─── 21. recipe_notes (PR 7) ──────────────────────────────────
// Per-household personal notes / 1-5 rating / substitutions on a recipe.
// One row per (household, recipe). Household-scoped (not per-user) — a
// couple sees one shared note. `last_edited_by_user_id` carries the
// audit trail. The author-side `recipes.notes` / `recipes.substitutions`
// columns are unchanged; this is the *consumer's* note about the recipe.
export const recipeNotes = pgTable('recipe_notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  recipeId: uuid('recipe_id').notNull().references(() => recipes.id, { onDelete: 'cascade' }),
  /** Personal cooking notes. Up to 1000 chars (enforced at the route). */
  notes: text('notes'),
  /** 1..5 stars; null = not rated. Range enforced by check constraint. */
  rating: integer('rating'),
  /** Free-form swaps ("sin cebolla / con puerro"). Up to 1000 chars. */
  substitutions: text('substitutions'),
  /**
   * PR 8B: per-(household, recipe) free-form tags. Lowercased + deduped
   * at the route. Up to 10 tags, 30 chars each. Surfaced as filter chips
   * in the catalog (follow-up). Default empty array.
   */
  customTags: text('custom_tags').array().notNull().default(sql`ARRAY[]::text[]`),
  /**
   * Structured per-(household, recipe) ingredient edits. Replaces the older
   * free-form `substitutions` text for visual rendering — the recipe detail
   * uses this list to render removed lines struck-through, modified lines
   * with the original next to the new value, and added lines with a subtle
   * highlight. Stored as a jsonb array of `IngredientOverride` (see the
   * type in `recipeNotesStore.ts`). Default empty array; capped at 50
   * entries by the sanitizer.
   */
  ingredientOverrides: jsonb('ingredient_overrides').notNull().default(sql`'[]'::jsonb`),
  /**
   * "Esta receta siempre la cocino para al menos N" (guardo o congelo lo que
   * sobra). Each time the recipe is cooked, the shopping list buys for at
   * least this many servings. Null = no minimum. 1..24 (check constraint).
   */
  minServings: integer('min_servings'),
  /** Last user to touch this row — for the audit / future "edited by X" UX. */
  lastEditedByUserId: uuid('last_edited_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_recipe_notes_household_recipe').on(t.householdId, t.recipeId),
  index('idx_recipe_notes_recipe').on(t.recipeId),
  check('recipe_notes_rating_check', sql.raw('rating IS NULL OR (rating >= 1 AND rating <= 5)')),
  check('recipe_notes_min_servings_check', sql.raw('min_servings IS NULL OR (min_servings >= 1 AND min_servings <= 24)')),
])

// ─── 20. household_staples (PR 10B) ───────────────────────────
// "We always need these" — bread, milk, coffee — that the shopping-list
// aggregator pre-pends to every freshly generated list. Per-household
// (any member can edit). Soft-toggleable via `active=false` (a staple you
// skip this week without losing the row).
export const householdStaples = pgTable('household_staples', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** Default quantity to pull in when materialising into a shopping list. */
  quantity: real('quantity').notNull().default(1),
  /** Buyable unit (`g | ml | u | cda | cdita`). Enforced at the route. */
  unit: text('unit').notNull().default('u'),
  /** Aisle hint so it lands in the right group on /shopping. */
  aisle: text('aisle').notNull().default('otros'),
  /** Optional last known price per unit — copied onto the shopping item. */
  pricePerUnit: real('price_per_unit'),
  /** Pause without deleting (e.g., "skip the milk this week"). */
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_household_staples_household').on(t.householdId),
])

// ─── Notification schedule (PR-D) ─────────────────────────────────
//
// Queue of "send this push at fireAt" rows. The scheduler tick in
// `services/notificationScheduler.ts` polls every N minutes and
// dispatches the due ones via `pushNotifier.sendPushToUser`. The
// `dedupKey` (unique) lets enqueue idempotently retry an event: the
// same recipe in the same slot + the same prep method computes to the
// same key, so re-running `enqueuePrepAlertsForMenu` after a swap
// doesn't double-fire.
export const notificationSchedule = pgTable('notification_schedule', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** Stable hash of the event the row represents, e.g.
   * `menu:<menuId>:day:<n>:meal:<m>:ing:<ingId>:method:<thaw_24h>`. */
  dedupKey: text('dedup_key').notNull().unique(),
  fireAt: timestamp('fire_at', { withTimezone: true }).notNull(),
  /** JSON payload passed directly to `sendPushToUser` at dispatch time. */
  payload: jsonb('payload').notNull().$type<{ title: string; body: string; url?: string; tag?: string; /** Weekly-cap priority (PRO-215); prep alerts are 1. */ priority?: number }>(),
  /** 'pending' | 'sent' | 'failed' | 'cancelled' */
  status: text('status').notNull().default('pending'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  /** Last error message when status='failed'. */
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_notif_sched_due').on(t.fireAt, t.status),
  index('idx_notif_sched_user').on(t.userId),
])

// ─── Avisos candidatos (PRO-215 / PRO-216) ────────────────────────
//
// One row per aviso Mimo could have sent by itself (prep alert, cooking
// reminder, Sunday nudge…) and what happened to it under the weekly budget
// (`services/notifications/budget.ts`). The budget is counted from here:
// rows with `counted = true` are the messages that spent one unit of the
// household's week. Read in aggregate only (GET /admin/metrics).
export const noticeCandidates = pgTable('notice_candidates', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** The household (primary) the budget belongs to, or the user when there is none. */
  budgetKey: uuid('budget_key').notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  /** `prep_alerts`, `cooking_reminder`, `weekly_nudge`… (see NOTICE_PRIORITY). */
  kind: text('kind').notNull(),
  /** 1–4, see `noticePriority`. */
  priority: integer('priority').notNull(),
  /** enviado | fusionado | descartado_tope | fuera_ventana | fallido */
  outcome: text('outcome').notNull(),
  /** This row spent one unit of the weekly budget. */
  counted: boolean('counted').notNull().default(false),
  /** whatsapp | push | both */
  channel: text('channel'),
  /** Monday (YYYY-MM-DD, Europe/Madrid) of the ISO week. */
  week: text('week').notNull(),
  /** The scheduler tick it belongs to: avisos of the same moment share it. */
  momentAt: timestamp('moment_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_notice_candidates_key_week').on(t.budgetKey, t.week),
  index('idx_notice_candidates_user_created').on(t.userId, t.createdAt),
  index('idx_notice_candidates_week').on(t.week),
])

// ─── Web Push subscriptions (PR-B) ────────────────────────────────
//
// One row per (user, browser endpoint). Browsers identify themselves by
// the unique endpoint URL returned from `pushManager.subscribe(...)`,
// and we hold the auth + p256dh keys we need to encrypt the payload
// before dispatching via `web-push`. When the user revokes permission
// (or the endpoint goes stale, e.g. browser cleared its storage), we
// delete the row on the next failed send so the table stays warm.
export const pushSubscriptions = pgTable('push_subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** Unique per browser. Acts as the natural key after `id`. */
  endpoint: text('endpoint').notNull().unique(),
  /** ECDH public key from `subscription.toJSON().keys.p256dh`. */
  p256dh: text('p256dh').notNull(),
  /** Subscription auth secret from `subscription.toJSON().keys.auth`. */
  auth: text('auth').notNull(),
  /** Best-effort hint for the UI; never used for routing. */
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  /** Updated on every successful dispatch — handy for "last delivered" displays. */
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
}, (t) => [
  index('idx_push_subs_user').on(t.userId),
])

// ─── WhatsApp channel ─────────────────────────────────────────────
//
// ─── referral_rewards (PRO-165) ──────────────────────────────
// One pending reward per (inviter code, invited account) once the invited
// household resolves a week in its 3rd week since sign-up (D-059). Nothing is
// given yet: giving it is PRO-166. No emails, only the codes and the account.
export const referralRewards = pgTable('referral_rewards', {
  id: uuid('id').primaryKey().defaultRandom(),
  inviterCode: text('inviter_code').notNull(),
  /** The inviter's account when the code is an account's (null for a waitlist person without one). */
  inviterUserId: uuid('inviter_user_id').references(() => users.id, { onDelete: 'set null' }),
  inviteeUserId: uuid('invitee_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** 'pendiente' until PRO-166 gives it. */
  status: text('status').notNull().default('pendiente'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_referral_rewards_pair').on(t.inviterCode, t.inviteeUserId),
  check('referral_rewards_status_check', sql.raw("status IN ('pendiente','dado')")),
])

// WhatsApp is another transport for the assistant (see specs/whatsapp.md).
// A phone is linked to exactly one user and vice versa; the link is proven
// by sending a one-time code (generated in /profile) from the phone.

export const whatsappLinks = pgTable('whatsapp_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
  /** wa_id as Meta reports it: digits only, country code included (e.g. 34600111222). */
  phone: text('phone').notNull().unique(),
  /** WhatsApp profile name at link time — display only. */
  profileName: text('profile_name'),
  /** Opt-in for proactive messages (master switch). */
  notify: boolean('notify').notNull().default(true),
  /**
   * Per-kind switches for proactive messages, e.g. `{ daily_brief: false }`.
   * Missing key = on. Kinds: see PROACTIVE_KINDS in whatsapp/proactive.ts.
   */
  prefs: jsonb('prefs').notNull().default({}).$type<Record<string, boolean>>(),
  linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
  /** Last inbound message — Meta's 24 h customer-service window starts here. */
  lastInboundAt: timestamp('last_inbound_at', { withTimezone: true }),
  /**
   * PRO-248: when the person said no to the avisos («No, gracias» or BAJA).
   * Older answers are read from the messages (`optInDeclinedSql`).
   */
  optInDeclinedAt: timestamp('opt_in_declined_at', { withTimezone: true }),
  /** PRO-248: when Mimo offered the avisos the one extra time (WhatsApp or web chat). */
  optInReofferedAt: timestamp('opt_in_reoffered_at', { withTimezone: true }),
})

export const whatsappLinkCodes = pgTable('whatsapp_link_codes', {
  code: text('code').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_wa_link_codes_user').on(t.userId),
])

/**
 * Mimo on Telegram (PRO-313, piece 1; specs/telegram.md): one Telegram
 * private chat per account. Off unless `TELEGRAM_BOT_TOKEN` (and the webhook
 * secret and bot username) are set. `history` keeps only the last 12 h of
 * the conversation (the same window WhatsApp reads back), as the rows
 * `whatsapp/history.ts` takes, so the same history builder serves both
 * channels; unlinking deletes it with the row.
 */
export const telegramLinks = pgTable('telegram_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
  /** Telegram chat id of the private chat with the bot (as text: it can exceed 32 bits). */
  chatId: text('chat_id').notNull().unique(),
  linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
  lastInboundAt: timestamp('last_inbound_at', { withTimezone: true }),
  /** Highest `update_id` handled: a repeated or older update is dropped. */
  lastUpdateId: bigint('last_update_id', { mode: 'number' }),
  history: jsonb('history').notNull().default([]).$type<Array<{
    direction: 'in' | 'out'
    kind: string
    body: string
    status: string
    createdAt: string
    meta?: { toolTrace?: Array<{ name: string; input?: string; summary?: string; error?: boolean }> }
  }>>(),
})

/** One-time codes for `t.me/<bot>?start=<code>` (10 minutes, like WhatsApp's). */
export const telegramLinkCodes = pgTable('telegram_link_codes', {
  code: text('code').primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_tg_link_codes_user').on(t.userId),
])

/**
 * Every inbound + outbound WhatsApp message. Serves three jobs: dedupe Meta's
 * webhook retries (unique `wamid`), server-side chat history (the web keeps
 * history in the client; WhatsApp has no client), and an audit trail.
 */
export const whatsappMessages = pgTable('whatsapp_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Meta message id. Null only for outbound sends that failed before Meta assigned one. */
  wamid: text('wamid').unique(),
  phone: text('phone').notNull(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  /** 'in' | 'out' */
  direction: text('direction').notNull(),
  /** in: text|audio|image|interactive|unsupported · out: reply|link|system|alert|weekly_nudge */
  kind: text('kind').notNull(),
  /** Text used for chat history: the message, the voice-note transcript, or a "[foto]" marker. */
  body: text('body'),
  /** in: received|processed|failed|ignored · out: sent|failed */
  status: text('status').notNull(),
  errorMessage: text('error_message'),
  /**
   * Inbound turns: what the assistant did — `{ tools, corrections, ms }` —
   * so the daily conversation review has objective signals. Outbound
   * messages written from a guide (PRO-156): `{ guided, guidedReason }`.
   */
  meta: jsonb('meta').$type<{ tools?: string[]; corrections?: string[]; ms?: number; guided?: 'guide' | 'fallback'; guidedReason?: string }>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_wa_messages_phone_created').on(t.phone, t.createdAt),
])

/**
 * Mimo's web chat (PRO-148, D-064): every web turn is kept server-side for
 * 90 days so the household profile can learn from it, like WhatsApp already
 * does with `whatsapp_messages`. Purged by the scheduler tick
 * (`purgeOldChatMessagesIfDue`); deleting the account deletes the rows
 * (cascade). The companion panel still shows the conversation from
 * `sessionStorage`: nothing reads this table back into the chat.
 */
export const chatMessages = pgTable('chat_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** The user's household at the time of the turn (null if none). */
  householdId: uuid('household_id').references(() => households.id, { onDelete: 'set null' }),
  /** 'web' for now (WhatsApp keeps its own table). */
  channel: text('channel').notNull().default('web'),
  /** 'user' | 'assistant' */
  role: text('role').notNull(),
  /** What the user typed or said (without the page note), or Mimo's reply. */
  body: text('body').notNull(),
  /**
   * Assistant rows: what Mimo did this turn — `{ mode, tools, corrections,
   * toolTrace, ms }` — as in `whatsapp_messages.meta`. User rows: `{ mode, path }`.
   */
  meta: jsonb('meta').$type<{
    mode?: string
    path?: string | null
    tools?: string[]
    corrections?: string[]
    toolTrace?: { name: string; input: string; summary: string; error?: boolean }[]
    ms?: number
  }>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_chat_messages_user_created').on(t.userId, t.createdAt),
  index('idx_chat_messages_created').on(t.createdAt),
])

/**
 * Daily review of WhatsApp conversations by an LLM "reviewer agent"
 * (services/whatsapp/reviewer.ts): what went wrong and what to fix.
 * One row per Madrid day reviewed.
 */
export const assistantReviews = pgTable('assistant_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** YYYY-MM-DD (Europe/Madrid) of the conversations reviewed. */
  day: text('day').notNull().unique(),
  /** ok | empty | failed */
  status: text('status').notNull(),
  stats: jsonb('stats').$type<Record<string, number>>(),
  findings: jsonb('findings').$type<unknown[]>(),
  summary: text('summary'),
  model: text('model'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── Business metrics: cost ledger + activity log ────────────
// See specs/metrics.md. Both are append-only; GET /admin/metrics aggregates
// them per Europe/Madrid ISO week.

/**
 * One row per paid provider call (Anthropic, OpenAI, Meta WhatsApp templates,
 * AIKIT images). Written fire-and-forget by services/costLedger.ts with the
 * price from config/pricing.ts. `userId` is null for system jobs (daily
 * reviewer, catalog scripts); `householdId` is the user's primary household at
 * record time. `costMicros` is null when the model is not in the price table.
 */
export const costEvents = pgTable('cost_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  householdId: uuid('household_id').references(() => households.id, { onDelete: 'set null' }),
  /** Product feature that spent it: assistant_chat, whatsapp_chat, voice_realtime… */
  feature: text('feature').notNull(),
  /** anthropic | openai | meta_whatsapp | aikit */
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  /** { inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens, audioInputTokens, minutes, messages, images } */
  units: jsonb('units').notNull().default({}).$type<Record<string, number>>(),
  /** Estimated cost in micro-euros (1e-6 €). */
  costMicros: bigint('cost_micros', { mode: 'number' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_cost_events_created').on(t.createdAt),
  index('idx_cost_events_household_created').on(t.householdId, t.createdAt),
  index('idx_cost_events_user_created').on(t.userId, t.createdAt),
])

/**
 * Product-activity signals that no other table timestamps durably. Today:
 * shopping-list use (the `shopping_lists` row is rewritten on every read, so
 * it can't say WHEN a household shopped). Kinds: shopping_check (item
 * check toggled), shopping_stock (in-stock toggled), shopping_add (manual
 * item added). Written by services/activityEvents.ts.
 */
export const activityEvents = pgTable('activity_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  householdId: uuid('household_id').references(() => households.id, { onDelete: 'set null' }),
  kind: text('kind').notNull(),
  /**
   * The product touched (≤ 80 chars, PRO-151): «leche», «tomate». A signal
   * for the household's ficha; null on rows from before 0063 and on Mimo's
   * skills that don't report it.
   */
  item: text('item'),
  /** check / stock toggles: the new state (true = marked / at home). Null otherwise. */
  toggledOn: boolean('toggled_on'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_activity_events_created').on(t.createdAt),
  index('idx_activity_events_household_created').on(t.householdId, t.createdAt),
])

/**
 * Product analytics (own table, no third party): one row per thing a user did
 * — signup_completed, menu_generated, mimo_message… (catalogue in
 * services/usageEvents.ts). `props` holds small enums/counts only, never free
 * text. Users and households are SET NULL on delete, so a deleted account
 * leaves anonymous counts. Purged after 180 days. GET /admin/usage reads it.
 */
export const usageEvents = pgTable('usage_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  householdId: uuid('household_id').references(() => households.id, { onDelete: 'set null' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  name: text('name').notNull(),
  /** web | whatsapp | voice (null = unknown / system) */
  channel: text('channel'),
  props: jsonb('props').$type<Record<string, string | number | boolean>>(),
}, (t) => [
  index('idx_usage_events_created').on(t.createdAt),
  index('idx_usage_events_household_created').on(t.householdId, t.createdAt),
])

/**
 * Uso de cada función por hogar (PRO-1023, specs/feature-usage.md): una fila
 * por hogar (o persona, `user_id`) y función del catálogo
 * (`FEATURE_CATALOG`, @ona/shared). La rellena cada noche
 * `services/featureUsage.ts` desde `usage_events`, que se borran a los 180
 * días: `uses_total` sigue sumando después. Guarda cifras y fechas, nada
 * más; CASCADE con el hogar y con la cuenta.
 */
export const householdFeatureUsage = pgTable('household_feature_usage', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  /** null = fila del hogar; con valor = la de esa persona en ese hogar. */
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  feature: text('feature').notNull(),
  firstUsedAt: timestamp('first_used_at', { withTimezone: true }).notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull(),
  /** Usos en los 30 días antes de `counted_until` (un ajuste: semanas en que actuó). */
  uses30d: integer('uses_30d').notNull().default(0),
  usesTotal: integer('uses_total').notNull().default(0),
  /** Los eventos anteriores a este instante ya están contados. */
  countedUntil: timestamp('counted_until', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_household_feature_usage').on(t.householdId, sql`COALESCE(${t.userId}, '00000000-0000-0000-0000-000000000000'::uuid)`, t.feature),
  index('idx_household_feature_usage_feature').on(t.feature),
  index('idx_household_feature_usage_user').on(t.userId),
])

// ─── "Compra en mis tiendas" (specs/shop-orders.md) ──────────────────
//
// The household's own shops (frutería, carnicería, pescadería, súper) and
// the per-shop orders Mimoia drafts from the shopping list. v1 never messages
// a shop itself: the user sends Mimoia's ready-made message from their own
// WhatsApp / mail (wa.me / mailto), pastes or forwards the shop's reply,
// approves, and pays the shop directly.
export const householdShops = pgTable('household_shops', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  /** fruteria | carniceria | pescaderia | supermercado | otra */
  kind: text('kind').notNull(),
  /** whatsapp | email | web | telefono */
  channel: text('channel').notNull(),
  /** Digits with country code (34…), for wa.me. */
  whatsapp: text('whatsapp'),
  email: text('email'),
  webUrl: text('web_url'),
  phone: text('phone'),
  /** How the shop knows the customer ("Miguel Martín"). */
  customerName: text('customer_name'),
  /** recoger | domicilio */
  fulfilment: text('fulfilment').notNull().default('recoger'),
  address: text('address'),
  notes: text('notes'),
  /** { [ingredientId]: { pricePerKg, at } } — last €/kg this shop quoted. */
  priceMemory: jsonb('price_memory').notNull().default({}),
  /** Home-delivery minimum order and fee, when the shop has them. */
  deliveryMinEur: real('delivery_min_eur'),
  deliveryFeeEur: real('delivery_fee_eur'),
  position: integer('position').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_household_shops_household').on(t.householdId),
])

export const shopOrders = pgTable('shop_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  shopId: uuid('shop_id').references(() => householdShops.id, { onDelete: 'set null' }),
  /** The shop as it was when the order was drafted (name, kind, channel, contact). */
  shopSnapshot: jsonb('shop_snapshot').notNull(),
  /** draft | sent | quoted | approved | closed | cancelled */
  status: text('status').notNull().default('draft'),
  /** Unguessable id for the public short link /c/:token → wa.me. */
  token: text('token').notNull(),
  /** ShopOrderLine[] snapshot (the live list is rebuilt on every read). */
  lines: jsonb('lines').notNull(),
  estimateEur: real('estimate_eur'),
  capEur: real('cap_eur'),
  messageText: text('message_text').notNull(),
  /** recoger | domicilio for this order (null on v1 rows → the shop's). */
  fulfilment: text('fulfilment'),
  /** Delivery address for this order. */
  address: text('address'),
  shopReplyText: text('shop_reply_text'),
  quoteSummary: jsonb('quote_summary'),
  confirmationText: text('confirmation_text'),
  finalTotalEur: real('final_total_eur'),
  /** Último envío a la extensión del navegador (StoredBasketResult); null si nunca. */
  extensionResult: jsonb('extension_result'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  quotedAt: timestamp('quoted_at', { withTimezone: true }),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('uq_shop_orders_token').on(t.token),
  index('idx_shop_orders_household_status').on(t.householdId, t.status),
])

// ─── In-house error tracker (specs/errors.md) ────────────────────────
//
// One row per error *group* (same kind + normalised message + top stack
// frame = same fingerprint), not per event: `count` / `last_seen` move on
// every occurrence and the sample fields keep the latest one. Every text
// field is scrubbed (emails, phones, tokens, query strings) before it is
// written; no request bodies, no IP addresses. Written by
// services/appErrors.ts (client reports via POST /client-errors, API 5xx).
export const appErrors = pgTable('app_errors', {
  id: uuid('id').primaryKey().defaultRandom(),
  fingerprint: text('fingerprint').notNull(),
  /** client | server */
  kind: text('kind').notNull(),
  /** Normalised + scrubbed message, ≤ 500 chars. */
  message: text('message').notNull(),
  /** Latest scrubbed stack, ≤ 4 KB. */
  sampleStack: text('sample_stack'),
  /** Latest page path (client) or `METHOD /route/:pattern` (server); never a query string. */
  samplePath: text('sample_path'),
  /** Commit SHA / deploy id of the build that last hit it, when known. */
  release: text('release'),
  /** "Chrome · Android" — browser + OS family only, never the full UA. */
  userAgentFamily: text('user_agent_family'),
  lastUserId: uuid('last_user_id').references(() => users.id, { onDelete: 'set null' }),
  count: bigint('count', { mode: 'number' }).notNull().default(1),
  firstSeen: timestamp('first_seen', { withTimezone: true }).notNull().defaultNow(),
  lastSeen: timestamp('last_seen', { withTimezone: true }).notNull().defaultNow(),
  /** Set by an admin; a new occurrence clears it (regression). */
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('uq_app_errors_fingerprint').on(t.fingerprint),
  index('idx_app_errors_last_seen').on(t.lastSeen),
  check('app_errors_kind_check', sql.raw("kind IN ('client','server')")),
])

// ─── Pre-launch waitlist (specs/waitlist.md) ─────────────────────────
//
// One row per person on the public waitlist (landing form → POST /waitlist).
// No health data. `email` is lowercased + trimmed by the shared zod schema;
// unsubscribing anonymises the row (email, first_name and supermarket go to
// NULL — Postgres lets several NULLs share the unique index) and keeps only
// the anonymous answers for the counts. `referral_code` is the person's
// public link (?invita=); `unsubscribe_token` is their private opt-out link.
export const waitlistEntries = pgTable('waitlist_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email'),
  firstName: text('first_name'),
  /** 1 | 2 | 3-4 | 5+ */
  householdSize: text('household_size').notNull(),
  /** yo | otra_persona | compartido — who plans and shops */
  plannerRole: text('planner_role').notNull(),
  /** improviso | lista | app | menu_fijo | no_cocino — how they plan today */
  currentMethod: text('current_method').notNull(),
  supermarket: text('supermarket'),
  /** ios | android | otro */
  platform: text('platform').notNull(),
  wantsWhatsapp: boolean('wants_whatsapp').notNull().default(false),
  referralCode: text('referral_code').notNull(),
  /** Code of the entry whose link brought this person (validated on insert). */
  referredByCode: text('referred_by_code'),
  /** `?ref=` slug (menu, receta, lista…), 'invita', or 'directo'. */
  source: text('source').notNull().default('directo'),
  utmSource: text('utm_source'),
  utmMedium: text('utm_medium'),
  utmCampaign: text('utm_campaign'),
  consentVersion: text('consent_version').notNull(),
  consentAt: timestamp('consent_at', { withTimezone: true }).notNull(),
  /**
   * Separate, optional marketing consent (LSSI art. 21–22): "el menú de la
   * semana por email cada viernes". Never implied by the waitlist consent;
   * the opt-out link turns it off too.
   */
  newsletterOptIn: boolean('newsletter_opt_in').notNull().default(false),
  newsletterConsentAt: timestamp('newsletter_consent_at', { withTimezone: true }),
  newsletterConsentVersion: text('newsletter_consent_version'),
  /** waiting | invited | joined | unsubscribed */
  status: text('status').notNull().default('waiting'),
  batch: integer('batch'),
  invitedAt: timestamp('invited_at', { withTimezone: true }),
  /**
   * One-time invitation link `/entrar/<token>` (PRO-97). Only the SHA-256 of
   * the token is stored; the token itself is an HMAC of the entry id, so the
   * reminder can rebuild the same link. NULL = invited before PRO-97 (or not invited).
   */
  inviteTokenHash: text('invite_token_hash'),
  /** When the link created the account (a second use is rejected). */
  inviteTokenUsedAt: timestamp('invite_token_used_at', { withTimezone: true }),
  /** The single reminder, 3 days after the invitation, if they haven't registered. */
  inviteReminderSentAt: timestamp('invite_reminder_sent_at', { withTimezone: true }),
  unsubscribeToken: text('unsubscribe_token').notNull(),
  // Founder pricing signal (PRO-26): optional Van Westendorp answers in
  // €/month, then the reserved plan + period, or «Ninguno me encaja» + why.
  priceTooCheapEur: real('price_too_cheap_eur'),
  priceGoodEur: real('price_good_eur'),
  priceExpensiveEur: real('price_expensive_eur'),
  priceTooExpensiveEur: real('price_too_expensive_eur'),
  priceAnsweredAt: timestamp('price_answered_at', { withTimezone: true }),
  /** esencial | plus */
  reservedPlan: text('reserved_plan'),
  /** mensual | anual */
  reservedPeriod: text('reserved_period'),
  reservedAt: timestamp('reserved_at', { withTimezone: true }),
  /** caro | no_lo_usaria | me_falta_algo | otro */
  declinedReason: text('declined_reason'),
  declinedAt: timestamp('declined_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_waitlist_entries_email').on(t.email),
  uniqueIndex('uq_waitlist_entries_referral_code').on(t.referralCode),
  uniqueIndex('uq_waitlist_entries_unsubscribe_token').on(t.unsubscribeToken),
  uniqueIndex('uq_waitlist_entries_invite_token_hash').on(t.inviteTokenHash),
  index('idx_waitlist_entries_referred_by').on(t.referredByCode),
  index('idx_waitlist_entries_status_created').on(t.status, t.createdAt),
  check('waitlist_entries_household_size_check', sql.raw("household_size IN ('1','2','3-4','5+')")),
  check('waitlist_entries_planner_role_check', sql.raw("planner_role IN ('yo','otra_persona','compartido')")),
  check('waitlist_entries_current_method_check', sql.raw("current_method IN ('improviso','lista','app','menu_fijo','no_cocino')")),
  check('waitlist_entries_platform_check', sql.raw("platform IN ('ios','android','otro')")),
  check('waitlist_entries_status_check', sql.raw("status IN ('waiting','invited','joined','unsubscribed')")),
])

/**
 * Newsletter «El menú de los viernes» (PRO-94, specs/newsletter.md): one row
 * per issue and recipient, claimed before sending, so re-running the same
 * issue never emails anyone twice. The recipient is the sha256 of the
 * lowercased email: the idempotency key without a second copy of the address.
 */
export const newsletterSends = pgTable('newsletter_sends', {
  id: uuid('id').primaryKey().defaultRandom(),
  issueId: text('issue_id').notNull(),
  recipientHash: text('recipient_hash').notNull(),
  /** waitlist | user */
  source: text('source').notNull(),
  /** pending (claimed, being sent) | sent */
  status: text('status').notNull().default('pending'),
  providerId: text('provider_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('uq_newsletter_sends_issue_recipient').on(t.issueId, t.recipientHash),
  check('newsletter_sends_status_check', sql.raw("status IN ('pending','sent')")),
])

/**
 * PRO-191: our own aggregated click counter for the newsletter. One row per
 * issue and link (the links of the content, rewritten at send to
 * `<web>/n/<issue>/<index>`); the redirect goes only to `destination`, saved
 * here at send, never to a URL that comes in the request. No IP, browser or
 * recipient: just how many times each link was opened.
 */
export const newsletterClicks = pgTable('newsletter_clicks', {
  id: uuid('id').primaryKey().defaultRandom(),
  issueId: text('issue_id').notNull(),
  linkIndex: integer('link_index').notNull(),
  destination: text('destination').notNull(),
  clicks: integer('clicks').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_newsletter_clicks_issue_link').on(t.issueId, t.linkIndex),
])

/**
 * PRO-191: one row per newsletter opt-out done from an issue's link (counts
 * only: the issue, whether it was an account or a waitlist entry, and when).
 * `issue_id` is null when the link carried no issue (older emails) or named
 * an issue that wasn't sent to that address (the issue comes in the link).
 */
export const newsletterUnsubscribes = pgTable('newsletter_unsubscribes', {
  id: uuid('id').primaryKey().defaultRandom(),
  issueId: text('issue_id'),
  /** user | waitlist */
  source: text('source').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_newsletter_unsubscribes_issue').on(t.issueId),
])

/**
 * What this household chose when a product needs a choice (jamón → serrano,
 * pescado entero → lubina, carne picada → de ternera). Applied the next time
 * Mimoia drafts an order (specs/shop-orders.md → Buy rules).
 */
export const householdBuyPrefs = pgTable('household_buy_prefs', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  ruleKey: text('rule_key').notNull(),
  choice: text('choice').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_household_buy_prefs').on(t.householdId, t.ruleKey),
])

// ─── Invitation links by campaign (PRO-27) ──────────────────
// `mimoia.com/i/<code>` → /register. During the closed beta a valid link
// (not expired, uses left) is one of the ways in; the account keeps the
// campaign so /admin/metrics can count signups, activation and week 3 per
// campaign (Miguel's circle vs strangers).
export const inviteCampaigns = pgTable('invite_campaigns', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  code: text('code').notNull(),
  /** null = unlimited. */
  maxUses: integer('max_uses'),
  uses: integer('uses').notNull().default(0),
  /** null = never expires. */
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  /** Admin who created it (no FK: audit trail survives account deletion). */
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('uq_invite_campaigns_code').on(t.code)])

// ─── Subscriptions (specs/billing.md) ───────────────────────
// One row per Stripe subscription, kept in sync by the Stripe webhook. A
// plan is per household; the payer is the household owner who subscribed.
// Paid during the beta → status 'trialing' until launch day (first charge).
export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  /** Who subscribed and pays. null once their account is deleted (the Stripe subscription is cancelled then). */
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  stripeCustomerId: text('stripe_customer_id').notNull(),
  stripeSubscriptionId: text('stripe_subscription_id').notNull(),
  /** 'esencial' | 'plus'. */
  plan: text('plan').notNull(),
  /** 'mensual' | 'anual'. */
  period: text('period').notNull(),
  /** Stripe's status, as is: trialing, active, past_due, unpaid, canceled, incomplete, incomplete_expired, paused. */
  status: text('status').notNull(),
  /** First charge while trialing (launch day), else the next renewal. */
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  trialEnd: timestamp('trial_end', { withTimezone: true }),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  canceledAt: timestamp('canceled_at', { withTimezone: true }),
  /** PRO-136: founder price (from the Stripe metadata `founder_price`): never moved to a new price. */
  founderPrice: boolean('founder_price').notNull().default(false),
  /** PRO-136: when the legal notice «15 días antes del primer cobro» went out (once; never written by the webhook). */
  chargeNoticeAt: timestamp('charge_notice_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_subscriptions_stripe_id').on(t.stripeSubscriptionId),
  index('idx_subscriptions_household').on(t.householdId),
  check('subscriptions_plan_check', sql.raw("plan IN ('esencial','plus')")),
  check('subscriptions_period_check', sql.raw("period IN ('mensual','anual')")),
])

// ─── Beta price survey (specs/billing.md) ───────────────────
// The four Van Westendorp questions, asked to beta users once, from day 7
// after sign-up until launch day (moved off the waitlist on 2026-10-15).
// One row per user: answered or dismissed («Ahora no»).
export const priceSurveyResponses = pgTable('price_survey_responses', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tooCheapEur: real('too_cheap_eur'),
  goodEur: real('good_eur'),
  expensiveEur: real('expensive_eur'),
  tooExpensiveEur: real('too_expensive_eur'),
  answeredAt: timestamp('answered_at', { withTimezone: true }),
  dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('uq_price_survey_user').on(t.userId)])

// ─── User feedback (specs/feedback.md) ──────────────────────
// What beta users tell us about Mimoia itself: from the floating «Opinión»
// button, from the web chat or from WhatsApp (Mimo's leave_feedback tool).
// Verbatim; deleted with the account.
export const userFeedback = pgTable('user_feedback', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** 'app' (the button) | 'chat' (Mimo on the web) | 'whatsapp' (Mimo on WhatsApp). */
  channel: text('channel').notNull(),
  text: text('text').notNull(),
  /** The page the button was pressed on (app only). */
  page: text('page'),
  /** What it answers, when it answers one of Mimo's questions: 'sobras' (PRO-285). */
  tag: text('tag'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_user_feedback_created').on(t.createdAt),
  check('user_feedback_channel_check', sql.raw("channel IN ('app','chat','whatsapp')")),
])

// ─── «Afina tu menú» (specs/taste.md, PRO-146) ──────────────
// One row per user and recipe: the last verdict wins. «nope» keeps the
// recipe out of the automatic menu of the whole household; «love» weighs
// like a favourite; «like» a little more than nothing.
export const recipeVerdicts = pgTable('recipe_verdicts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  recipeId: uuid('recipe_id').notNull().references(() => recipes.id, { onDelete: 'cascade' }),
  /** 'love' | 'like' | 'nope' | 'skip' */
  verdict: text('verdict').notNull(),
  /** «¿Qué es lo que no?»: `{ kind: 'ingredient'|'dish'|'long'|'other'|'none', text? }`. */
  reason: jsonb('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_recipe_verdicts_user_recipe').on(t.userId, t.recipeId),
  check('recipe_verdicts_verdict_check', sql.raw("verdict IN ('love','like','nope','skip')")),
])

// ─── Ficha del hogar (specs/household-profile.md, PRO-150) ──
// Everything Mimoia knows about a household, with a section per person.
// Types and value schemas live in `@ona/shared` (householdProfile.ts).

/** People without an account: an alias and an age band. A minor's name is never stored. */
export const householdPersons = pgTable('household_persons', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  /** «la pequeña», «la abuela». For minors only a generic alias (`MINOR_ALIASES`). */
  alias: text('alias').notNull(),
  /** '0-2' | '3-5' | '6-12' | '13-17' | 'adulto'. */
  ageBand: text('age_band').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_household_persons_household').on(t.householdId),
  check('household_persons_age_band_check', sql.raw("age_band IN ('0-2','3-5','6-12','13-17','adulto')")),
])

/** One fact of the ficha. No subject = about the whole household. */
export const profileFacts = pgTable('profile_facts', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  /** About a person with an account. */
  subjectUserId: uuid('subject_user_id').references(() => users.id, { onDelete: 'cascade' }),
  /** About a person without one. */
  subjectPersonId: uuid('subject_person_id').references(() => householdPersons.id, { onDelete: 'cascade' }),
  /** `PROFILE_FACT_TYPES` in @ona/shared. */
  type: text('type').notNull(),
  value: jsonb('value').notNull(),
  /** 'user' | 'onboarding' | 'ai_realtime' | 'ai_nightly' | 'ai_weekly'. */
  origin: text('origin').notNull(),
  confidence: real('confidence').notNull().default(1),
  /** [{ signal, date, summary }]. */
  evidence: jsonb('evidence').notNull().default([]),
  validUntil: timestamp('valid_until', { withTimezone: true }),
  /** 'active' | 'retired'. */
  status: text('status').notNull().default('active'),
  /** The `user_memories` row this fact was copied from (PRO-150 migration); keeps the copy idempotent. */
  sourceMemoryId: uuid('source_memory_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_profile_facts_household_status').on(t.householdId, t.status),
  index('idx_profile_facts_subject_user').on(t.subjectUserId),
  uniqueIndex('uq_profile_facts_source_memory').on(t.sourceMemoryId),
  check('profile_facts_origin_check', sql.raw("origin IN ('user','onboarding','ai_realtime','ai_nightly','ai_weekly')")),
  check('profile_facts_status_check', sql.raw("status IN ('active','retired')")),
  check('profile_facts_confidence_check', sql.raw('confidence >= 0 AND confidence <= 1')),
  check('profile_facts_one_subject_check', sql.raw('subject_user_id IS NULL OR subject_person_id IS NULL')),
])

/** The portrait: ≤ 250 words, one row per household, versioned. */
export const householdProfiles = pgTable('household_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  portrait: text('portrait').notNull(),
  version: integer('version').notNull().default(1),
  /** Model that wrote it. */
  model: text('model').notNull(),
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_household_profiles_household').on(t.householdId),
])

/** What the AI suspects but doesn't know («¿seguís sin horno?»). */
export const profileQuestions = pgTable('profile_questions', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  subjectUserId: uuid('subject_user_id').references(() => users.id, { onDelete: 'cascade' }),
  subjectPersonId: uuid('subject_person_id').references(() => householdPersons.id, { onDelete: 'cascade' }),
  question: text('question').notNull(),
  factType: text('fact_type'),
  origin: text('origin').notNull(),
  /** 'pending' | 'asked' | 'answered' | 'dismissed'. */
  status: text('status').notNull().default('pending'),
  askedAt: timestamp('asked_at', { withTimezone: true }),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  /** What the person answered in «Tu ficha» (PRO-317): 'yes' | 'no'; the next night's signals carry it. */
  answer: text('answer'),
  /** Who answered. */
  answeredByUserId: uuid('answered_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_profile_questions_household_status').on(t.householdId, t.status),
  check('profile_questions_status_check', sql.raw("status IN ('pending','asked','answered','dismissed')")),
  check('profile_questions_origin_check', sql.raw("origin IN ('user','onboarding','ai_realtime','ai_nightly','ai_weekly')")),
])

/** History of the ficha: what changed, before, after, why, who. */
export const profileChanges = pgTable('profile_changes', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  factId: uuid('fact_id').references(() => profileFacts.id, { onDelete: 'set null' }),
  /** `PROFILE_CHANGE_ACTIONS` in @ona/shared. */
  action: text('action').notNull(),
  factType: text('fact_type'),
  before: jsonb('before'),
  after: jsonb('after'),
  reason: text('reason').notNull(),
  origin: text('origin').notNull(),
  /** Who made it, when it was a person. */
  actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_profile_changes_household_created').on(t.householdId, t.createdAt),
  check('profile_changes_origin_check', sql.raw("origin IN ('user','onboarding','ai_realtime','ai_nightly','ai_weekly')")),
])

// ─── Refinador de la ficha (PRO-152, services/profile/refiner.ts) ──
/**
 * One nightly run of the refiner: the Madrid day it read and the Anthropic
 * Message Batch it sent. `empty` = no household to refine that night.
 * Unique per (day, kind) so a run is sent once.
 */
export const profileRefinerRuns = pgTable('profile_refiner_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** AAAA-MM-DD, Europe/Madrid. */
  day: text('day').notNull(),
  /** 'nightly' (weekly and real-time come later). */
  kind: text('kind').notNull().default('nightly'),
  /** 'empty' | 'submitted' | 'ended' | 'failed'. */
  status: text('status').notNull(),
  batchId: text('batch_id'),
  model: text('model').notNull(),
  /** Households sent in the batch. */
  requested: integer('requested').notNull().default(0),
  /** Why the other households were left out: { no_activity, paused, not_subscribed, spend_cap, no_members }. */
  skipped: jsonb('skipped').notNull().default({}),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('uq_profile_refiner_runs_day_kind').on(t.day, t.kind),
  index('idx_profile_refiner_runs_status').on(t.status),
  check('profile_refiner_runs_status_check', sql.raw("status IN ('empty','submitted','ended','failed')")),
])

/**
 * One household inside a run: whether its changes were applied, how many,
 * and what the rules threw away (reason and type only — never the content,
 * so a discarded health deduction is not stored anywhere).
 */
export const profileRefinements = pgTable('profile_refinements', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id').notNull().references(() => profileRefinerRuns.id, { onDelete: 'cascade' }),
  householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  /** Who the cost goes to (the household's owner). */
  billedUserId: uuid('billed_user_id').references(() => users.id, { onDelete: 'set null' }),
  /** 'pending' | 'applied' | 'failed'. */
  status: text('status').notNull().default('pending'),
  /** Changes written to the ficha. */
  applied: integer('applied').notNull().default(0),
  /**
   * The short references the model saw (F1 → fact id, P1 → user id, X1 →
   * person id), so its answer is read against the ficha as it was sent.
   */
  refs: jsonb('refs').notNull().default({}),
  /** [{ reason, op, type }] — see `DiscardReason` in refiner.ts. */
  discarded: jsonb('discarded').notNull().default([]),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('uq_profile_refinements_run_household').on(t.runId, t.householdId),
  index('idx_profile_refinements_household').on(t.householdId),
  check('profile_refinements_status_check', sql.raw("status IN ('pending','applied','failed')")),
])

// ─── Menu edits (specs/menus.md "Registro de cambios", PRO-149) ─────
// One row per recipe that a change to a menu touched: which plate went out
// and which came in, on which day and meal, who did it (the user in the app
// or Mimo) and where (web or WhatsApp). Generating a menu is not an edit.
// Signal for the household's «ficha viva» (D-064). Recipe names are copied so
// the row still reads well if the recipe is deleted later.
export const menuEdits = pgTable('menu_edits', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id').references(() => households.id, { onDelete: 'cascade' }),
  menuId: uuid('menu_id').notNull().references(() => menus.id, { onDelete: 'cascade' }),
  /** Account that made the change (Mimo acts as the user it talks to). */
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  /** Day index 0-6 (Monday = 0); null for a week-wide veto (`ban`). */
  day: integer('day'),
  meal: text('meal'),
  /** Origin slot for `move` and `leftover`. */
  fromDay: integer('from_day'),
  fromMeal: text('from_meal'),
  action: text('action').notNull(),
  beforeRecipeId: uuid('before_recipe_id'),
  beforeRecipeName: text('before_recipe_name'),
  afterRecipeId: uuid('after_recipe_id'),
  afterRecipeName: text('after_recipe_name'),
  actor: text('actor').notNull(),
  channel: text('channel').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_menu_edits_household_created').on(t.householdId, t.createdAt),
  index('idx_menu_edits_menu').on(t.menuId),
  check('menu_edits_action_check', sql.raw("action IN ('swap','add','remove','ban','skip_day','move','leftover','freezer')")),
  check('menu_edits_actor_check', sql.raw("actor IN ('user','mimo')")),
  check('menu_edits_channel_check', sql.raw("channel IN ('web','whatsapp')")),
])

// ─── Catalogue wishes (PRO-154, specs/catalog-import.md) ────
// Dishes someone wants and the catalogue doesn't have: favourites from the
// sign-up with no similar recipe, a menu's «no está en el catálogo» (PRO-155),
// requests to Mimo that end as a note. One row per dish (normalised key);
// one vote per household, so the count is «cuántos hogares lo piden». No
// personal data leaves through the read: dish, sources and household count.
export const catalogWishes = pgTable('catalog_wishes', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** The dish as first written (trimmed), e.g. «Croquetas de cocido». */
  dish: text('dish').notNull(),
  /** Normalised key (accents, plurals, stopwords out) — one row per dish. */
  dishKey: text('dish_key').notNull(),
  /** 'abierto' (we don't have it) | 'cubierto' (a recipe now covers it) | 'descartado'. */
  status: text('status').notNull().default('abierto'),
  /** The catalogue recipe that covered it, once there is one. */
  recipeId: uuid('recipe_id').references(() => recipes.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_catalog_wishes_key').on(t.dishKey),
  check('catalog_wishes_status_check', sql.raw("status IN ('abierto','cubierto','descartado')")),
])

export const catalogWishVotes = pgTable('catalog_wish_votes', {
  id: uuid('id').primaryKey().defaultRandom(),
  wishId: uuid('wish_id').notNull().references(() => catalogWishes.id, { onDelete: 'cascade' }),
  /** Household id, or the user id when the user has no household — one vote each. */
  voterKey: text('voter_key').notNull(),
  householdId: uuid('household_id').references(() => households.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  /** 'alta' | 'me_encanta' | 'mimo' | 'evaluador'. */
  source: text('source').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_catalog_wish_votes_voter').on(t.wishId, t.voterKey, t.source),
  index('idx_catalog_wish_votes_wish').on(t.wishId),
  check('catalog_wish_votes_source_check', sql.raw("source IN ('alta','me_encanta','mimo','evaluador')")),
])

// ─── catalog_import_jobs (admin «Recetas pendientes») ────────
// One row per import of a Cocina batch file launched from the admin page
// (specs/catalog-import.md). The import runs in the background of the API
// process; this row is its progress: how many recipes are done and what
// happened to each (in draft, repeated, rejected and why). Never the file's
// text. A job still `running` when the API boots is marked `interrupted`.
export const catalogImportJobs = pgTable('catalog_import_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** `recipes.import_batch` of the drafts it creates. */
  batch: text('batch').notNull(),
  /** 'cocina' | 'miguel' — the file's `source.origin` (default cocina). */
  origin: text('origin').notNull(),
  fileName: text('file_name'),
  /** 'running' | 'done' | 'failed' | 'interrupted'. */
  status: text('status').notNull().default('running'),
  total: integer('total').notNull(),
  done: integer('done').notNull().default(0),
  /** Per recipe: `{ name, status, recipeId?, duplicateOf?, reason?, detail?, allergenDoubt?, auditIssues? }`. */
  outcomes: jsonb('outcomes').notNull().default([]).$type<CatalogImportOutcomeRecord[]>(),
  error: text('error'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
}, (t) => [
  index('idx_catalog_import_jobs_created').on(t.createdAt),
  check('catalog_import_jobs_status_check', sql.raw("status IN ('running','done','failed','interrupted')")),
])

// ─── catalog_collections (PRO-374) ───────────────────────────
// Editorial collections of the catalogue («Vuelta al cole», «Otoño»), made by
// Cocina as a JSON file and uploaded from Admin → «Recetas pendientes»
// (specs/catalog-import.md → «Colecciones»). Shown as a row on `/recipes` and
// at `/recipes/coleccion/<slug>`. `recipe_ids` keeps Cocina's order; a recipe
// retired or turned back into a draft later just stops showing.
// PRO-378 «Menú del mes»: `kind = 'menu_mes'`, one per `month` (YYYY-MM), and
// `week` = 7 days (Monday first), per meal the recipe ids (services/monthMenus.ts).
// Migration 0099 only adds those columns. The collections' row and pages read
// only `kind = 'coleccion'`.
export const catalogCollections = pgTable('catalog_collections', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  subtitle: text('subtitle'),
  /** 'spring' | 'summer' | 'autumn' | 'winter', or null (not tied to one). */
  season: text('season'),
  recipeIds: jsonb('recipe_ids').notNull().default([]).$type<string[]>(),
  published: boolean('published').notNull().default(true),
  /** 'coleccion' (PRO-374) | 'menu_mes' (PRO-378). */
  kind: text('kind').notNull().default('coleccion'),
  /** YYYY-MM, only for `menu_mes`. */
  month: text('month'),
  /** `menu_mes`: `[{ lunch: [recipeId…], dinner: […] }, …]`, Monday to Sunday. */
  week: jsonb('week').$type<Array<Partial<Record<'breakfast' | 'lunch' | 'dinner' | 'snack', string[]>>>>(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/** One recipe's result in `catalog_import_jobs.outcomes`. */
export interface CatalogImportOutcomeRecord {
  name: string
  status: 'draft' | 'duplicate' | 'rejected'
  recipeId?: string
  duplicateOf?: string
  reason?: string
  detail?: string
  allergenDoubt?: boolean
  auditIssues?: string[]
}

// ─── household_notices (PRO-205) ────────────────────────────
// One-off notices to a household, once per (key, household): the apology for
// «Afina tu menú» showing dishes that broke allergies or diets (PRO-197).
// `household_id` null = the key's scan marker (its `created_at` is the cutoff).
// `user_id` = the member Mimo writes to on WhatsApp (null = app only).
export const householdNotices = pgTable('household_notices', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull(),
  householdId: uuid('household_id').references(() => households.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  whatsappSentAt: timestamp('whatsapp_sent_at', { withTimezone: true }),
  /** From when the card shows in the app (no WhatsApp, or 3 days without it going out). */
  appSince: timestamp('app_since', { withTimezone: true }),
  dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('uq_household_notices_key_household').on(t.key, t.householdId),
  index('idx_household_notices_household').on(t.householdId),
])

// ─── school_lunches (PRO-224) ─────────────────────────────────
// Menú del comedor escolar: per household and school day, the main dish the
// kids eat at lunch and its group. The dinner that day doesn't repeat the
// group. Read from a photo/PDF of the school's monthly menu and corrected by
// the household. No child data: only the dish of a date.
export const schoolLunches = pgTable('school_lunches', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  date: date('date', { mode: 'string' }).notNull(),
  dish: text('dish').notNull(),
  /** legumbre | pescado | carne | huevo | pasta_arroz | verdura; null = unknown. */
  foodGroup: text('food_group'),
  createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_school_lunches_household_date').on(t.householdId, t.date),
  check('school_lunches_group_check', sql.raw("food_group IS NULL OR food_group IN ('legumbre','pescado','carne','huevo','pasta_arroz','verdura')")),
])

// ─── Menú inteligente (specs/smart-menu.md, PRO-255) ─────────
/**
 * Mimo's proposal for a generated menu, made in the shadow next to today's
 * generator: what Claude chose, what the fixed checker said and what the
 * household would have seen. One row per generated menu.
 */
export const menuPlans = pgTable('menu_plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  menuId: uuid('menu_id').notNull().references(() => menus.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  householdId: uuid('household_id').references(() => households.id, { onDelete: 'cascade' }),
  /** 'shadow' (PRO-255); 'live' once PRO-257 turns it on. */
  mode: text('mode').notNull().default('shadow'),
  /** 'ok' | 'partial' | 'fallback' | 'skipped'. */
  status: text('status').notNull(),
  /** Why it fell back or was skipped: no_key, spend_cap, no_slots, no_candidates, timeout, error, refusal, invalid. */
  reason: text('reason'),
  /** The week as it would have been shown (planner slots that passed + the generator's for the rest). */
  days: jsonb('days'),
  /** Per planned slot: day, meal, recipeId, recipeName, why, leftoverOf, problems, source. */
  slots: jsonb('slots').notNull().default([]),
  /** Checker summary: problems by kind, extra slots. */
  check: jsonb('check'),
  /** The generator's week as it was when the plan was made (PRO-256: the household may edit the menu afterwards). */
  generatorDays: jsonb('generator_days'),
  /** `scoreWeek` of the proposal and of the generator's week (PRO-254), for the blind comparison. */
  plannerScore: jsonb('planner_score'),
  generatorScore: jsonb('generator_score'),
  candidates: integer('candidates').notNull().default(0),
  model: text('model'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  costMicros: integer('cost_micros'),
  durationMs: integer('duration_ms'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_menu_plans_menu').on(t.menuId),
  index('idx_menu_plans_household_created').on(t.householdId, t.createdAt),
  check('menu_plans_status_check', sql.raw("status IN ('ok','partial','fallback','skipped')")),
])

/**
 * PRO-258: the week is thought on Saturday night, in one Message Batch (half
 * price). One run per target week (the Monday after); while PRO-257 is off
 * it runs in the shadow, like `menu_plans`.
 */
export const menuPlannerRuns = pgTable('menu_planner_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Monday of the week being planned, AAAA-MM-DD (Europe/Madrid). */
  weekStart: text('week_start').notNull(),
  /** 'empty' | 'submitted' | 'ended' | 'failed'. */
  status: text('status').notNull(),
  batchId: text('batch_id'),
  model: text('model').notNull(),
  requested: integer('requested').notNull().default(0),
  /** Why the other households were left out: { paused, not_subscribed, suspended, spend_cap, inactive, no_slots, no_candidates, error }. */
  skipped: jsonb('skipped').notNull().default({}),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('uq_menu_planner_runs_week').on(t.weekStart),
  index('idx_menu_planner_runs_status').on(t.status),
  check('menu_planner_runs_status_check', sql.raw("status IN ('empty','submitted','ended','failed')")),
])

/** One household of a Saturday run: what was sent, and the plan once the batch ends (same fields as `menu_plans`). */
export const menuPlannerRunItems = pgTable('menu_planner_run_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id').notNull().references(() => menuPlannerRuns.id, { onDelete: 'cascade' }),
  householdId: uuid('household_id').notNull().references(() => households.id, { onDelete: 'cascade' }),
  /** The owner: whose recipes, memory and AI cap. */
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** 'pending' | 'ok' | 'partial' | 'fallback' | 'failed'. */
  status: text('status').notNull().default('pending'),
  /** What the checker needs when the result arrives: the generator's week, slots, candidate refs, filters. */
  context: jsonb('context').notNull(),
  days: jsonb('days'),
  slots: jsonb('slots').notNull().default([]),
  check: jsonb('check'),
  plannerScore: jsonb('planner_score'),
  generatorScore: jsonb('generator_score'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  costMicros: integer('cost_micros'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('uq_menu_planner_run_items_run_household').on(t.runId, t.householdId),
  index('idx_menu_planner_run_items_household').on(t.householdId),
  check('menu_planner_run_items_status_check', sql.raw("status IN ('pending','ok','partial','fallback','failed')")),
])

/**
 * PRO-256: the blind comparison in the test households. Which of the two
 * weeks (A/B, the planner's and the generator's, in an order fixed per menu)
 * the household preferred, and why.
 */
export const menuBlindVotes = pgTable('menu_blind_votes', {
  id: uuid('id').primaryKey().defaultRandom(),
  planId: uuid('plan_id').notNull().references(() => menuPlans.id, { onDelete: 'cascade' }),
  menuId: uuid('menu_id').notNull().references(() => menus.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  householdId: uuid('household_id').references(() => households.id, { onDelete: 'cascade' }),
  /** What the household saw: 'A' | 'B' | 'igual'. */
  label: text('label').notNull(),
  /** What it means: 'planner' | 'generator' | 'tie'. */
  preferred: text('preferred').notNull(),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_menu_blind_votes_plan_user').on(t.planId, t.userId),
  check('menu_blind_votes_label_check', sql.raw("label IN ('A','B','igual')")),
  check('menu_blind_votes_preferred_check', sql.raw("preferred IN ('planner','generator','tie')")),
])
