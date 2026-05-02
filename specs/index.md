# Specs Index

Quick reference to all system specs for ONA. Search-optimized with keywords.

---

## [Authentication](./auth.md)

Registration, login, logout, JWT tokens, session management, onboarding flow, password hashing, public vs protected routes, AuthProvider, demo user, username/email login, bcrypt.

**Source**: `apps/api/src/routes/auth.ts`, `apps/api/src/middleware/auth.ts`, `apps/web/src/lib/auth.tsx`, `apps/web/src/app/(auth)/`, `apps/web/src/app/onboarding/`

---

## [Recipes](./recipes.md)

Recipe catalog, recipe detail, ingredients, sectioned ingredient groups ("Para la masa"), rich steps (text + duration + temperature + technique + ingredient refs), photos (Unsplash + Notion), system vs user recipes, public vs internal tags, favorites, search, meal/season/maxTime filters, servings, diner scaler with culinary rounding, prepTime/cookTime/activeTime/totalTime, difficulty, equipment, allergens, notes/tips/substitutions/storage, yield, nutritionPerServing, AI extraction from photo, AI extraction from URL (YouTube video or web article via JSON-LD + Readability + Claude), sourceUrl/sourceType, hero image, RecipeCard, ServingsScaler.

**Source**: `apps/api/src/routes/recipes.ts`, `apps/api/src/services/recipeScaler.ts`, `apps/api/src/seed/recipes.ts`, `apps/web/src/app/recipes/`, `apps/web/src/components/recipes/`, `apps/web/src/hooks/useRecipes.ts`, `apps/web/public/images/recipes/`

---

## [Cooking Mode](./cooking-mode.md)

Hands-free fullscreen cook-along, step-by-step UX, per-step countdown timers, multiple concurrent timers, vibration + chime on timer fire, swipe between steps, ingredient checklist, inline scaled ingredient chips, temperature/technique badges, Wake Lock screen-on, live diner re-scaling inside cooking mode, exits cleanly without mutating the recipe, "Empezar a cocinar" entry point.

**Source**: `apps/web/src/app/recipes/[id]/cook/page.tsx`, `apps/web/src/components/cooking/` (`CookingShell`, `StepCard`, `StepTimer`, `ChecklistPanel`), `apps/web/src/hooks/useWakeLock.ts`, `apps/web/src/hooks/useStepTimers.ts`

---

## [Ingredient Auto-Create](./ingredient-auto-create.md)

USDA-backed flow that lets users add a missing ingredient without leaving the recipe form. `GET /ingredients/suggest` returns Foundation/SR Legacy candidates + per-100 g nutrition, `POST /ingredients/auto-create` persists with full nutrition + inferred allergens. Fuzzy dedupe (Levenshtein ≤ 2 on normalized names), Branded entries filtered out, Spanish-to-English query translation, "Crear sin nutrición" escape hatch. Same pipeline reused by the photo extractor and `apply:recipes --auto-create-missing`.

**Source**: `apps/api/src/services/ingredientAutoCreate.ts`, `apps/api/src/routes/ingredients.ts` (`/suggest`, `/auto-create`), `apps/web/src/components/recipes/IngredientAutocomplete.tsx`, `apps/web/src/hooks/useIngredients.ts`

---

## [Curator Dashboard](./curator-dashboard.md)

Read-mostly admin page at `/curator` that exposes every catalog gap a curator must close: ingredients without USDA mapping (`fdcId IS NULL`), missing density/unitWeight, the "otros" aisle bucket, allergen tag suggestions (heuristic > current), recipes with `nutritionPerServing.kcal` falsy + which ingredients block them, and the latest LLM regen output (`regen-failed.jsonl` / `regen-skipped.jsonl`). Each row offers an inline edit (PATCH `/ingredients/:id`) or a "Re-mapear a USDA" modal that reuses the auto-create modal's USDA candidate flow and writes via PATCH `/ingredients/:id/remap`. Discreet entry from the profile page footer.

**Source**: `apps/api/src/routes/curator.ts`, `apps/web/src/app/curator/page.tsx`, `apps/web/src/hooks/useCurator.ts`

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

Weekly meal planning, menu generation algorithm using cached `nutritionPerServing`, recipe matcher, slot regeneration, meal locking, calorie targets, BMR, season detection, favorites boost, no-repeats, week navigation, WeekStrip, MealPhotoCard, menu history, day index 0-6 (Monday-Sunday), per-recipe servings × householdSize scaling.

**Source**: `apps/api/src/routes/menus.ts`, `apps/api/src/services/menuGenerator.ts`, `apps/api/src/services/recipeMatcher.ts`, `apps/web/src/app/menu/`, `apps/web/src/components/menu/`, `apps/web/src/hooks/useMenu.ts`

---

## [Shopping](./shopping.md)

Auto-generated shopping list, unit-aware ingredient aggregation (g/ml/u/cda/cdita), unit conversion via `density`/`unitWeight`, aisle grouping (produce/proteínas/lácteos/panadería/despensa/congelados), `recipe.servings` × `householdSize` scaling, optional ingredient handling, regenerate endpoint, check-off items, pantry stock manager, inStock toggle, export to clipboard, list vs stock tabs, progress bar.

**Source**: `apps/api/src/routes/shopping.ts`, `apps/api/src/services/shoppingList.ts`, `apps/web/src/app/shopping/`, `apps/web/src/components/shopping/`, `apps/web/src/hooks/useShopping.ts`

---

## [Advisor](./advisor.md)

AI chat assistant, function calling, 27 skills total: menu/recipe reads (get_todays_menu, get_recipe_details, get_weekly_nutrition, get_shopping_list, suggest_recipes, search_recipes, get_my_recipes, get_menu_history, scale_recipe), mutations (generate_weekly_menu, swap_meal, toggle_favorite, mark_meal_eaten, create_recipe, recipe_variation, mark_in_stock, check_shopping_item), pantry (get_pantry_stock), advice grounded in the 10 mandamientos (nutrition_advice, evaluate_food_health, suggest_substitution, get_variety_score, get_eating_window, get_inflammation_index), and cooking-mode voice control (start_cooking_mode, set_timer, cooking_step). Voice input (speech-to-text), text-to-speech, Spanish, conversation history, useVoice hook, suggested prompts, microphone button.

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
