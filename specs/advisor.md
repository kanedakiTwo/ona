# Advisor

AI assistant for nutrition guidance, menu queries, and recipe management via natural language.

## User Capabilities

- Users can chat with an AI assistant via `/advisor`
- Users can type messages or speak (voice input via Web Speech API, Spanish)
- The assistant speaks responses aloud (TTS) when auto-speak is enabled
- Users can tap the speaker icon on any assistant message to replay it
- Users see suggested example prompts when the chat is empty:
  - "Que toca cocinar hoy?"
  - "Quiero crear una receta nueva"
  - "No tengo mantequilla, que uso?"
  - "Como van mis objetivos?"
- The header shows the assistant avatar with "En linea" status
- A microphone button toggles speech-to-text mode; while listening, an animated waveform replaces the input
- A volume button toggles auto-speak globally for assistant replies

## Assistant Skills

The assistant can call back-end skills (function calling). Each skill has a name, description, JSON schema parameters, and an executor. Current skills:

- `get_todays_menu` — read the menu for today (or any day index 0–6)
- `get_recipe_details` — pull a recipe by ID/name including ingredients and steps
- `get_weekly_nutrition` — calorie and macro summary for the week
- `get_shopping_list` — current week's shopping list
- `suggest_recipes` — recommend recipes matching meal/season/restrictions
- `search_recipes` — search by name substring
- `generate_weekly_menu` — full menu generation for the user
- `swap_meal` — replace a single meal slot. Without a `recipeId`/`recipeName` parameter, runs the matcher (auto-picks). When the user names a recipe ("pon la fabada de mi madre el lunes"), the model passes `recipeName` (or `recipeId` when known) and the skill pins that recipe directly without the matcher. Recipes the user owns win over system recipes when names collide
- `toggle_favorite` — favorite/unfavorite a recipe
- `mark_meal_eaten` — log that the user actually ate a meal (records `eatenAt` timestamp)
- `create_recipe` — save a new user recipe
- `edit_recipe` — author-only field edits on a user recipe (name, prepTime, cookTime, difficulty, notes, tips). Voice cannot edit ingredients/steps inline; with `openEditor: true` it returns a hint pointing at `/recipes/<id>/edit` so the user can continue in the form
- `update_household` — set the user's `adults` + `kidsCount` (children 2–10 years; <2 don't count, >10 count as adults). Drives shopping-list portion sizing immediately. Triggered by phrases like "ahora somos 2 adultos y un niño" or "quítame el niño"
- `recipe_variation` — generate a variation of a recipe (e.g., dairy-free version)
- `nutrition_advice` — return advisor summary based on `user_nutrient_balance`
- `get_pantry_stock` — list ingredients currently flagged `inStock` on the latest shopping list
- `mark_in_stock` — set/toggle the `inStock` flag of a shopping-list item by name
- `check_shopping_item` — set/toggle the `checked` flag of a shopping-list item (mark groceries as bought)
- `get_my_recipes` — list recipes authored by the user (`recipes.authorId = user.id`)
- `get_menu_history` — list past weeks' menus to answer "when did I last eat X"
- `scale_recipe` — return ingredient quantities scaled to a different `servings` count without mutating the recipe
- `evaluate_food_health` — frame "is X healthy?" through the 10-mandamientos KB so the model answers with criterion (not neutral)
- `suggest_substitution` — frame ingredient substitutions through the philosophy: never propose margarine, refined vegetable oils, artificial sweeteners
- `get_variety_score` — count distinct ingredients / vegetables / proteins in the current week's menu (principle 7)
- `get_eating_window` — average first/last eating hour and window length from `eatenAt` timestamps (principle 3)
- `get_inflammation_index` — heuristic 0–100 score per recipe (or weekly average) combining `nutritionPerServing.fiberG`/`saltG` with keyword penalties for processed ingredients and fryer/steam techniques
- `start_cooking_mode` — resolve a recipe and emit a `cooking_navigate` hint so the client routes to `/recipes/:id/cook`
- `set_timer` — emit a `cooking_timer` hint that `CookingShell` consumes via `subscribeCookingCommands` to start a timer at the current step
- `cooking_step` — emit a `cooking_step` hint with `direction: 'next' | 'previous' | 'repeat'` to advance the cooking shell

The cooking-mode skills (`start_cooking_mode`, `set_timer`, `cooking_step`) are bridged to the `CookingShell` UI via [`apps/web/src/lib/cookingCommands.ts`](../apps/web/src/lib/cookingCommands.ts) — a tiny pub/sub bus subscribed to from `CookingShell`. If no shell is mounted, commands silently drop (the assistant still spoke the confirmation).

The model responds with either a plain text message or a tool call. After the tool runs, the loop continues until the model produces a final message.

## Voice (`useVoice` hook)

- Uses native `SpeechRecognition` and `speechSynthesis` (no external API)
- Language defaults to `es-ES`
- STT: continuous=false, interimResults=true; final transcript auto-sends
- TTS: prefers a Spanish voice from `getVoices()`; rate 1.0, pitch 1.0
- Both can be unavailable in some browsers (the UI hides voice controls if `sttSupported`/`ttsSupported` is false)

## API

- `POST /assistant/:userId/chat` (auth) — body `{ message, history }`
  - `history` is the recent conversation, capped at 20 messages by the client
  - Response: `{ message, skillUsed?, uiHint?, data? }`

## Constraints

- The chat is single-session in memory (no persistent conversation history in the DB)
- The history is sent with each request (last 20 messages from the client)
- All assistant responses are in Spanish by design
- Voice is browser-side only; if the browser lacks Web Speech API, only text mode works
- The model used (Claude family) is configured via the LLM provider in `services/providers/`
- The advisor has read-write access to the user's data via skills (it can generate menus, swap meals, create recipes, etc.) — destructive intents should ideally be confirmed in copy

## Related specs

- [Menus](./menus.md) — assistant can read and modify menus
- [Recipes](./recipes.md) — assistant can search, suggest, and create recipes
- [Shopping](./shopping.md) — assistant can read the list
- [Voice Mode](./voice-mode.md) — hands-free conversation with wake word "Hola Ona". When the opt-in toggle is on, the legacy mic button in the chat is hidden and conversation turns from the orb overlay are appended to the chat history on close.

## Hooks (client)

- `useAssistant` (new, preferred) — `POST /assistant/:userId/chat` with `{ message, history }`. The component itself uses `api.post` directly with `useState` for messages
- `useAdvisor` (legacy) — wraps `/advisor/:userId/summary` and `/advisor/:userId/ask`; the chat UI no longer uses `useAskAdvisor` but the summary endpoint is still called by the advisor page
- `useVoice` — Web Speech API wrapper (STT + TTS), Spanish by default

## Debug page

`/debug-advisor` exists as a developer utility to inspect the auth token in `localStorage` and ping the assistant endpoint manually. Not linked from the UI; access via direct URL.

## Source

- [apps/api/src/routes/assistant.ts](../apps/api/src/routes/assistant.ts) — `POST /assistant/:userId/chat`
- [apps/api/src/routes/advisor.ts](../apps/api/src/routes/advisor.ts) — legacy advisor routes (summary, ask)
- [apps/api/src/services/assistant/engine.ts](../apps/api/src/services/assistant/engine.ts) — chat loop
- [apps/api/src/services/assistant/skills.ts](../apps/api/src/services/assistant/skills.ts) — skill definitions
- [apps/api/src/services/assistant/contextLoader.ts](../apps/api/src/services/assistant/contextLoader.ts)
- [apps/api/src/services/assistant/systemPrompt.ts](../apps/api/src/services/assistant/systemPrompt.ts)
- [apps/api/src/services/providers/](../apps/api/src/services/providers/) — LLM integration
- [apps/web/src/app/advisor/page.tsx](../apps/web/src/app/advisor/page.tsx)
- [apps/web/src/app/debug-advisor/page.tsx](../apps/web/src/app/debug-advisor/page.tsx)
- [apps/web/src/components/advisor/AdvisorChat.tsx](../apps/web/src/components/advisor/AdvisorChat.tsx)
- [apps/web/src/hooks/useAssistant.ts](../apps/web/src/hooks/useAssistant.ts)
- [apps/web/src/hooks/useAdvisor.ts](../apps/web/src/hooks/useAdvisor.ts) — legacy
- [apps/web/src/hooks/useVoice.ts](../apps/web/src/hooks/useVoice.ts)
