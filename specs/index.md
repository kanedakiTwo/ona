# Specs Index

Quick reference to all system specs for ONA. Search-optimized with keywords.

---

## [Authentication](./auth.md)

Registration, login, logout, JWT tokens, session management, onboarding flow, password hashing, public vs protected routes, AuthProvider, demo user, username/email login, bcrypt.

**Source**: `apps/api/src/routes/auth.ts`, `apps/api/src/middleware/auth.ts`, `apps/web/src/lib/auth.tsx`, `apps/web/src/app/(auth)/`, `apps/web/src/app/onboarding/`

---

## [Recipes](./recipes.md)

Recipe catalog, recipe detail, ingredients, sectioned ingredient groups ("Para la masa"), rich steps (text + duration + temperature + technique + ingredient refs), photos (Unsplash + Notion), system vs user recipes, public vs internal tags, favorites, search, meal/season/maxTime filters, servings, diner scaler with culinary rounding, prepTime/cookTime/activeTime/totalTime, difficulty, equipment, allergens, notes/tips/substitutions/storage, yield, nutritionPerServing, AI extraction from photo, hero image, RecipeCard, ServingsScaler.

**Source**: `apps/api/src/routes/recipes.ts`, `apps/api/src/services/recipeScaler.ts`, `apps/api/src/seed/recipes.ts`, `apps/web/src/app/recipes/`, `apps/web/src/components/recipes/`, `apps/web/src/hooks/useRecipes.ts`, `apps/web/public/images/recipes/`

---

## [Cooking Mode](./cooking-mode.md)

Hands-free fullscreen cook-along, step-by-step UX, per-step countdown timers, multiple concurrent timers, vibration + chime on timer fire, swipe between steps, ingredient checklist, inline scaled ingredient chips, temperature/technique badges, Wake Lock screen-on, live diner re-scaling inside cooking mode, exits cleanly without mutating the recipe, "Empezar a cocinar" entry point.

**Source (planned)**: `apps/web/src/app/recipes/[id]/cook/page.tsx`, `apps/web/src/components/cooking/`, `apps/web/src/hooks/useWakeLock.ts`, `apps/web/src/hooks/useStepTimers.ts`

---

## [Nutrition](./nutrition.md)

Per-serving nutrition (kcal, protein, carbs, fat, fiber, salt), per-ingredient catalog with USDA FoodData Central (FDC) mapping via `fdcId`, `ingredient_nutrition` table per 100 g, density (g/ml), unitWeight (g/u), recipe-level aggregation cached on save, allergen tags (gluten, lactosa, huevo, frutos secos, soja, pescado, marisco, sésamo, sulfitos…), "sin gluten" filtering, advisor + menu generator consume real nutrition, USDA seed cache.

**Source**: `apps/api/src/services/nutrition/`, `apps/api/src/seed/usda.ts`, `apps/api/src/db/schema.ts` (`ingredient_nutrition`)

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

AI chat assistant, function calling, skills (get_todays_menu, search_recipes, swap_meal, etc.), voice input (speech-to-text), text-to-speech, Spanish, conversation history, useVoice hook, suggested prompts, microphone button.

**Source**: `apps/api/src/routes/assistant.ts`, `apps/api/src/services/assistant/`, `apps/web/src/app/advisor/`, `apps/web/src/components/advisor/`, `apps/web/src/hooks/useVoice.ts`

---

## [Voice Mode](./voice-mode.md)

**Status: code complete on `feat/voice-mode`; runtime verification pending.** Hands-free voice conversation, wake word "Hola Ona", always-listening, Picovoice Porcupine (WASM), openWakeWord fallback, OpenAI Realtime API, gpt-realtime, WebRTC, server VAD, turn detection, barge-in, echo cancellation, ephemeral session token, full-screen voice overlay, animated orb, cooking mode, extended silence timeout, conversation persistence into AdvisorChat, skill/tool calling, opt-in toggle (Capítulo 04 del perfil), on-device wake-word detection, daily per-user minutes quota, Spanish.

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
