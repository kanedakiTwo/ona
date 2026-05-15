# Specs Index

Quick reference to all system specs for ONA. Search-optimized with keywords.

---

## [Authentication](./auth.md)

Registration, login, logout, JWT tokens, session management, onboarding flow, password hashing, public vs protected routes, AuthProvider, demo user, username/email login, bcrypt.

**Source**: `apps/api/src/routes/auth.ts`, `apps/api/src/middleware/auth.ts`, `apps/web/src/lib/auth.tsx`, `apps/web/src/app/(auth)/`, `apps/web/src/app/onboarding/`

---

## [Recipes](./recipes.md)

Recipe catalog, recipe detail, ingredients, sectioned ingredient groups ("Para la masa"), rich steps (text + duration + temperature + technique + ingredient refs), photos (Unsplash + Notion), system vs user recipes, public vs internal tags, favorites, search, meal/season/maxTime filters, servings, diner scaler with culinary rounding, prepTime/cookTime/activeTime/totalTime, difficulty, equipment, allergens, notes/tips/substitutions/storage, yield, nutritionPerServing, AI extraction from photo (returns ExtractedRecipe draft for review, no auto-persist), AI extraction from URL (YouTube video or web article via JSON-LD + Readability + Claude), AI hero-photo generation (AiKit Imagen-fal, regenerate-image endpoint, monthly per-user quota, Railway volume storage in prod), sourceUrl/sourceType, hero image, RecipeCard, ServingsScaler. Seed pipeline: `seed/recipes.ts` shells + `handAuthoredRecipes.ts` bodies → `regen-passed.jsonl` → `apply:recipes` (with `--soft-lint` / `--auto-create-missing` flags). Prod maintenance one-offs: `dedupSystemRecipes`, `linkSeedRecipeImages`, `fillSeedCatalogGap`.

**Source**: `apps/api/src/routes/recipes.ts`, `apps/api/src/services/recipeScaler.ts`, `apps/api/src/services/recipeImageGenerator.ts`, `apps/api/scripts/generateRecipeImages.ts`, `apps/api/scripts/handAuthoredRecipes.ts`, `apps/api/scripts/applyRegeneratedRecipes.ts`, `apps/api/scripts/dedupSystemRecipes.ts`, `apps/api/scripts/linkSeedRecipeImages.ts`, `apps/api/scripts/fillSeedCatalogGap.ts`, `apps/api/src/seed/recipes.ts`, `apps/web/src/app/recipes/`, `apps/web/src/components/recipes/`, `apps/web/src/hooks/useRecipes.ts`, `apps/web/src/hooks/useUser.ts`, `apps/web/public/images/recipes/`

---

## [Cooking Mode](./cooking-mode.md)

Hands-free fullscreen cook-along, step-by-step UX, per-step countdown timers, multiple concurrent timers, vibration + chime on timer fire, swipe between steps, ingredient checklist, inline scaled ingredient chips, temperature/technique badges, Wake Lock screen-on, live diner re-scaling inside cooking mode, exits cleanly without mutating the recipe, "Empezar a cocinar" entry point.

**Source**: `apps/web/src/app/recipes/[id]/cook/page.tsx`, `apps/web/src/components/cooking/` (`CookingShell`, `StepCard`, `StepTimer`, `ChecklistPanel`), `apps/web/src/hooks/useWakeLock.ts`, `apps/web/src/hooks/useStepTimers.ts`

---

## [Ingredient Auto-Create](./ingredient-auto-create.md)

USDA-backed flow that lets users add a missing ingredient without leaving the recipe form. `GET /ingredients/suggest` returns Foundation/SR Legacy candidates + per-100 g nutrition, `POST /ingredients/auto-create` persists with full nutrition + inferred allergens. Fuzzy dedupe (Levenshtein ≤ 2 on normalized names), Branded entries filtered out, Spanish-to-English query translation, "Crear sin nutrición" escape hatch. Same pipeline reused by the photo extractor and `apply:recipes --auto-create-missing`.

**Source**: `apps/api/src/services/ingredientAutoCreate.ts`, `apps/api/src/routes/ingredients.ts` (`/suggest`, `/auto-create`), `apps/web/src/components/recipes/IngredientAutocomplete.tsx`, `apps/web/src/hooks/useIngredients.ts`

---

## [Roles & Authorization](./roles.md)

Two-role system: `user` (default) + `admin`. Admin role is bootstrapped via `ADMIN_EMAILS` env var — on every login the server reconciles role to env. `requireAdmin` middleware extends `requireAuth` and checks both `role === 'admin'` and `suspended_at IS NULL` per request. Suspended users get 403 with `code: 'SUSPENDED'`. JWT payload only carries `userId`; role is fetched from DB to avoid stale tokens. Frontend auth context exposes role for navbar gating; server still enforces.

**Source**: `apps/api/src/db/schema.ts` (`users.role`, `users.suspended_at`), `apps/api/src/middleware/auth.ts` (`requireAuth`, `requireAdmin`), `apps/api/src/config/env.ts` (`ADMIN_EMAILS`), `apps/web/src/lib/auth.tsx`

---

## [Admin Dashboard](./admin-dashboard.md)

Admin-only page at `/admin` (renamed from `/curator`, gated by `requireAdmin`). Tabs: catalog gaps (sin USDA, sin pasillo, sin densidad, sin peso por unidad, alérgenos sugeridos), system recipes con kcal=0, regen output, **Usuarios** sub-tab, **Auditoría** sub-tab. Reuses the ingredient auto-create modal's USDA flow (manual search + Spanish translations + BEDCA fallback + LLM estimation). Old `/curator` URL kept as a 301-redirect for back-compat.

**Source**: `apps/api/src/routes/admin.ts`, `apps/web/src/app/admin/`, `apps/web/src/hooks/useAdmin.ts`

---

## [My Recipes](./my-recipes.md)

User-scoped recipe curator inside `/profile` ("Mis recetas" tab). Lists recipes where `authorId === user.id`, filters for quality gaps (sin nutrición, sin equipo, ingredientes pendientes de revisar — entries with note 'añadido automáticamente'), edit / delete inline, counts strip, future "veces cocinada" + calificación propia. No catalog editing or user management — those are admin-only.

**Source**: `apps/web/src/app/profile/sections/MyRecipesSection.tsx`, `apps/web/src/hooks/useMyRecipes.ts`, `apps/api/src/routes/users.ts` (recipes-curator/gaps endpoint)

---

## [Admin Audit Log](./admin-audit-log.md)

Append-only `admin_audit_log` table — every successful admin mutation lands here. Action codes (`ingredient.create/update/remap`, `recipe.update/delete`, `user.suspend/unsuspend`, `user.reset_password.generate`). Payload is a JSONB before/after diff. Browseable from the "Auditoría" sub-tab in `/admin` with filters by admin and action code, paginated 50/page. Reset-token secrets never appear in payloads (only `token_id` + `expires_at`). Action codes are stable forever — never renamed.

**Source**: `apps/api/src/db/schema.ts` (`admin_audit_log`), `apps/api/src/services/auditLog.ts`, `apps/web/src/app/admin/sections/AuditLogSection.tsx`

---

## [User Management](./user-management.md)

Admin sub-tab at `/admin` → "Usuarios": paginated list (search by username/email, filter "solo suspendidos"), per-user detail panel (profile, restrictions, registration date, counts), **suspend** / **unsuspend** with confirm modal, **generar enlace de reset** (24 h one-time token, link copied to clipboard, admin sends manually — no automated email). Suspending an admin is allowed but logged. Out of scope v1: delete user, edit user profile, impersonate. Public `/reset?token=X` consume page.

**Source**: `apps/api/src/db/schema.ts` (`password_reset_tokens`), `apps/api/src/routes/admin.ts` (users endpoints), `apps/api/src/services/passwordReset.ts`, `apps/web/src/app/admin/sections/UsersSection.tsx`, `apps/web/src/app/(auth)/reset/page.tsx`

---

## [Nutrition](./nutrition.md)

Per-serving nutrition (kcal, protein, carbs, fat, fiber, salt), per-ingredient catalog with USDA FoodData Central (FDC) mapping via `fdcId`, per-100 g nutrition columns directly on the `ingredients` table (no separate `ingredient_nutrition` table), density (g/ml), unitWeight (g/u), recipe-level aggregation cached on save, allergen tags (gluten, lactosa, huevo, frutos secos, soja, pescado, marisco, sésamo, sulfitos…), "sin gluten" filtering, advisor + menu generator consume real nutrition, USDA seed cache.

**Source**: `apps/api/src/services/nutrition/`, `apps/api/src/seed/usda.ts`, `apps/api/src/db/schema.ts` (per-100 g columns on `ingredients`)

---

## [Recipe Quality](./recipe-quality.md)

Lint validator for recipe data integrity, blocks save on missing ingredients in steps, orphan ingredients, out-of-range gramajes per serving, broken `ingredientRefs`, time-sum inconsistency, public/internal tag leakage. Warnings for nutrition gaps, missing density, suspicious kcal. Same lint runs on user save, on photo extraction, and on the LLM regeneration pipeline. Curator scripts: `regenerateRecipes.ts` (LLM-driven JSONL output) + `applyRegeneratedRecipes.ts` (human-reviewed apply). Per-ingredient sanity ranges.

**Source**: `apps/api/src/services/recipeLint.ts`, `apps/api/scripts/regenerateRecipes.ts`, `apps/api/scripts/applyRegeneratedRecipes.ts`

---

## [Menus](./menus.md)

Weekly meal planning, menu generation algorithm using cached `nutritionPerServing`, recipe matcher, slot regeneration, meal locking, calorie targets, BMR, season detection, favorites boost, no-repeats, week navigation, WeekStrip, MealPhotoCard, menu history, day index 0-6 (Monday-Sunday), household-weighted scaling (`adults + 0.5 × kidsCount`).

**Source**: `apps/api/src/routes/menus.ts`, `apps/api/src/services/menuGenerator.ts`, `apps/api/src/services/recipeMatcher.ts`, `apps/web/src/app/menu/`, `apps/web/src/components/menu/`, `apps/web/src/hooks/useMenu.ts`

---

## [Shopping](./shopping.md)

Auto-generated shopping list, unit-aware ingredient aggregation (g/ml/u/cda/cdita), unit conversion via `density`/`unitWeight`, aisle grouping (produce/proteínas/lácteos/panadería/despensa/congelados), household-weighted scaling (`adults + 0.5 × kidsCount`) over `recipe.servings`, optional ingredient handling, regenerate endpoint, check-off items, pantry stock manager, inStock toggle, export to clipboard, list vs stock tabs, progress bar.

**Source**: `apps/api/src/routes/shopping.ts`, `apps/api/src/services/shoppingList.ts`, `apps/web/src/app/shopping/`, `apps/web/src/components/shopping/`, `apps/web/src/hooks/useShopping.ts`

---

## [Advisor](./advisor.md)

AI chat assistant, function calling, 30 skills total: menu/recipe reads (get_todays_menu, get_recipe_details, get_weekly_nutrition, get_shopping_list, suggest_recipes, search_recipes, get_my_recipes, get_menu_history, scale_recipe), mutations (generate_weekly_menu, swap_meal, toggle_favorite, mark_meal_eaten, create_recipe, edit_recipe, recipe_variation, mark_in_stock, check_shopping_item, update_household, add_recipe_to_mine), pantry (get_pantry_stock), advice grounded in the 10 mandamientos (nutrition_advice, evaluate_food_health, suggest_substitution, get_variety_score, get_eating_window, get_inflammation_index), and cooking-mode voice control (start_cooking_mode, set_timer, cooking_step). Voice input (speech-to-text), text-to-speech, Spanish, conversation history, useVoice hook, suggested prompts, microphone button.

**Source**: `apps/api/src/routes/assistant.ts`, `apps/api/src/services/assistant/`, `apps/web/src/app/advisor/`, `apps/web/src/components/advisor/`, `apps/web/src/hooks/useVoice.ts`, `apps/web/src/lib/cookingCommands.ts`

---

## [Voice Mode](./voice-mode.md)

**Status: shipped on master.** Hands-free voice conversation, wake word "Hola Ona" (or floating mic FAB while Picovoice access is missing), always-listening, Picovoice Porcupine (WASM), openWakeWord fallback, OpenAI Realtime API, gpt-realtime, WebRTC, server VAD, turn detection, barge-in, echo cancellation, ephemeral session token, full-screen voice overlay, animated orb, typed Spanish error messages on failure with auto-close, cooking mode, extended silence timeout, conversation persistence into AdvisorChat, skill/tool calling, opt-in toggle (Capítulo 04 del perfil), on-device wake-word detection, daily per-user minutes quota, Spanish.

**Source**: `apps/web/src/hooks/useWakeWord.ts`, `apps/web/src/hooks/useRealtimeSession.ts`, `apps/web/src/components/voice/`, `apps/web/src/lib/voiceMessages.ts`, `apps/api/src/routes/realtime.ts`, `apps/api/src/services/realtime/`

---

## [PWA](./pwa.md)

Native-feeling Progressive Web App: installable (Android + iOS), offline-capable (app shell + viewed recipes via next-pwa runtime caching), IndexedDB mutation queue replayed on the `online` event, install prompt bottom sheet (3-visit / second-`/menu`-visit gate, 30/365-day dismissal windows), haptic feedback (Vibration API), Web Share (recipe + shopping export), Wake Lock cooking mode, local meal-time Notifications scheduled via `setTimeout`, View Transitions API + motion/react page transitions, SwipeNavigator pan-gesture between bottom tabs, manifest, service worker (next-pwa / Workbox), apple-touch-icon, 8 splash screens, status bar tinting, safe-area-inset CSS variables, dynamic theme-color per section (cream app / ink public), maskable icons, monochrome adaptive icon, iOS Safari quirks, "sin conexión" banner.

**Source**: `apps/web/public/manifest.webmanifest`, `apps/web/public/icons/`, `apps/web/src/lib/pwa/`, `apps/web/src/components/pwa/`, `apps/web/next.config.ts`

---

## [Design System](./design-system.md)

Editorial design system, design tokens (`@theme` in globals.css), color palette (cream, ink, terracotta, forest, mint), typography (Fraunces variable, Cormorant Garamond italic, Inter, JetBrains Mono), motion/react animations, magnetic buttons, grain texture, link-reveal underlines, marquee, layoutId pill nav, editorial mode pages (landing, como-funciona, recipes), app mode legacy pages (menu, shopping, profile, advisor), Tailwind v4, mobile-first 430px max-width, bottom tab bar, components (RecipeCard, MealPhotoCard, WeekStrip, Navbar, FavoriteButton, AdvisorChat).

**Source**: `apps/web/src/app/globals.css`, `apps/web/src/app/layout.tsx`, `apps/web/src/components/shared/`

---
