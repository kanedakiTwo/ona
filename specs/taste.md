# Afina tu menú (taste cards)

«Afina tu menú» (PRO-146, idea and design by Miguel, 2026-10-16): Mimoia shows catalogue recipes one at a time and the user says whether they fancy each one. Every answer is a **verdict** the weekly menu generator reads (D-061, smart menu). Design: artboards «Afina tu menú · prototipo» and «Cómo se ofrece tras el primer menú» (claude.ai artifact Ekcdm6AvCXNTk1vfWkNjk9).

## User Capabilities

- **`/afinar`** (full screen, no tab bar / Mimo button / «Opinión» pill; centred 480 px column on desktop): intro «Dime qué te *apetece*.» with the three gestures explained and «Empezar» («Puedes parar cuando quieras: lo guardo todo.»); `?empezar=1` skips the intro
- Cards fill the screen: photo, «tipo de plato · tiempo» (`Cuchara · 53 min`) and name, with the next card peeking behind. **Gestures**: drag right «Me apetece», left «No para mí», up «Me encanta»; the matching stamp (ME APETECE / NO PARA MÍ / ME ENCANTA) fades in while dragging (thresholds 100 px sideways, 110 px up). **Buttons** do the same (✕ «No para mí», ♥ «Me encanta», ✓ «Me apetece», all with `aria-label`, keyboard reachable) plus «No la conozco · saltar». Top: «Ya está por hoy» and the counter «N de 78» (rated + 1 of the catalogue) with a terracotta progress bar
- **«¿Qué es lo que no?»** opens with the first «No para mí» and then every 2 (1st, 3rd, 5th…): «No me gusta el cilantro» for the recipe's 3 main ingredients (by weight; basics such as salt, oil, garlic, onion, pepper, water, flour are never offered), «El plato en sí», «Es muy largo», a free field «¿Es otra cosa? Cuéntamelo» + «Enviar», and «Prefiero no decirlo». An ingredient goes to the memory's `dislikes` (so other recipes with it are avoided too); the free text is saved with the verdict and read like Mimo's `update_memory`: an ingredient → `dislikes`, «no tengo horno» → `equipment` (the list of what the user HAS: the stored list without it, or the usual kit without it when there was none), a home habit («a mediodía como fuera») → `prep_habits`, anything else → `notes` («Sobre <receta>: …»). Health data is never stored from here
- **Summary** «Tu menú ya te *conoce* un poco más.»: «Saldrán más a menudo» (Me encanta), «Te apetecen», «No volverán a salir» (plus «todo lo que lleve X» for each ingredient picked), «Lo que me has contado» (the free texts) when there is any; «Ver mi menú» and «Seguir con más recetas»
- **Which recipes**: the first 10 are a **starter deck** chosen to learn the most with few cards — cuchara, pescado, carne, verdura protagonista, horno, rápido, frito, largo, algo de fuera, algo de niños (`TASTE_STARTER_DECK` in `@ona/shared`; each row lists catalogue names, first one found wins, missing rows filled by variety). After that each batch of 10 is **chosen by Claude Haiku** from the answers so far: what we still don't know or doubt («¿pescado al horno sí y frito no?»), avoiding what is already clear. The page asks for it **in the background at card 5** of each batch, so there's no wait. If Claude fails, is slow (8 s) or has no key, the **variety order**: one recipe at a time, the most different from the previous card and from what was already seen, alternating kind of dish, protein and speed. A rated recipe (skips included) never comes back
- **Session adaptation**: after 3 «No para mí» to meat (or fish) — not necessarily adjacent cards — the session stops showing that group, drops it from the queue (refilling it) and flags it; «Lo que recuerdo de ti» then asks «¿No coméis carne? Si es así, añádelo en Restricciones o cuéntaselo a Mimo.»
- **In the sign-up** (`OnboardingFlow.tsx`): right after creating the account and **before** choosing WhatsApp or the web, so everyone does it, also whoever goes on through WhatsApp. Same intro with «Saltar» under «Empezar»; 10 cards with «Saltar» in place of «Ya está por hoy» and a «N de 10» counter; then the channel choice / questions. Never blocks: «Saltar» goes straight on. Shown once (`POST /taste/offers {event:'onboarding'}`), a reload continues with the questions. The **three favourite dishes question is gone** (the web questions are now 4); `favorite_dishes` is no longer filled from the web and «Me encanta» carries the favourites' weight
- **Accounts that finished the sign-up before** (criterion: onboarded and no verdict at all): (a) once, before the menu, a full screen «Novedad · Afina tu menú en un *minuto*.» with «Empezar» (→ `/afinar?empezar=1`) and «Ahora no»; (b) after «Ahora no», the card «Afina tu menú en un minuto» above the menu (3 photos of the next cards, «Empezar» / «Ahora no») until the user rates a recipe or closes it with its «Ahora no», which removes it for good. Both stamped on `users.taste_state`, never repeated, on any device (`components/taste/TasteOffers.tsx`)
- Always in **Perfil → «Afina tu menú»** («N de 78 valoradas») and in **«Lo que recuerdo de ti»** (`/profile/memoria`): every verdict with a selector to change it and «Olvidar», the protein flags, and «Empezar»/«Seguir» to `/afinar`

## Menu generator

- A recipe with «No para mí» from **anyone in the household** never comes out in the automatic menu (weekly generator, «Cambiar al azar», added meal, regenerated dish: everything that reads `loadHouseholdRatingSets`); it can still be picked by hand. It beats a 5-star rating and another member's «Me encanta»
- «Me encanta» weighs like a favourite (2×); «Me apetece» gets a small extra (×1.5 on the recipe's rounded weight, weekly generator only); «No la conozco» changes nothing
- Mimo's `generate_weekly_menu` goes through the same generator, so it respects them; Mimo's single-dish swap (`skills.ts`) does not yet (see Known limitations)

## API

- `GET /taste/next?limit=10&exclude=<ids>&avoid=carne,pescado` → `{ cards: TasteCard[], source: 'starter'|'ai'|'variety', rated, total }`. `exclude` = cards already in the user's hands; `avoid` = groups dropped this session
- `POST /taste` `{ recipeId, verdict: 'love'|'like'|'nope'|'skip', reason?: { kind: 'ingredient'|'dish'|'long'|'other'|'none', text? } }` → upsert, idempotent per recipe (the last verdict wins; a reason is kept only on «nope»). Catalogue recipes only (404 otherwise). Returns the memory facts written
- `DELETE /taste/:recipeId` · `GET /taste/verdicts` (name, photo, verdict, reason) · `GET /taste/status` (`rated`, `total`, `showIntro`, `showCard`, `offeredInOnboarding`, `flags`) · `POST /taste/offers { event: 'intro_start'|'intro_later'|'card_dismiss'|'onboarding' }` · `POST /taste/flags { group }`
- All per-route auth (`routes/taste.ts`)

## Data

- `recipe_verdicts` (migration `0060_recipe_verdicts`): `user_id` (cascade), `recipe_id` (cascade), `verdict` (check `love|like|nope|skip`), `reason` jsonb, `created_at`, `updated_at`; unique `(user_id, recipe_id)`
- `users.taste_state` jsonb (same migration, default `{}`): `introAt`, `introChoice`, `cardDismissedAt`, `onboardingAt`, `whatsappOfferedAt` (reserved), `flags`
- Cost: both Claude calls (`taste_next`, `taste_reason`, `claude-haiku-4-5`) are billed to the household in `cost_events` like every paid call

## Constraints

- Only catalogue recipes (author null, not retired) are shown or accepted; the catalogue count is the «78» of the counter
- Claude only orders recipes from the candidate list it's given (numbers out of range or repeated are dropped, the batch is filled by variety); its free-text reading keeps only `dislikes`, `equipment`, `prep_habits`, `notes`, never health keys
- Writes to memory take confidence 1 (the user said it) and keep a fact's `manual` source
- The e2e helpers mark the sign-up step as shown (`skipTasteOffer`), which also turns «Novedad» off; `{ keepTaste: true }` keeps both

## Known limitations

- Mimo doesn't mention it on WhatsApp yet (the one-time mention with the `/afinar` link to WhatsApp-first users, `whatsappOfferedAt`), nor reads the verdicts in its single-dish swap, nor dropped «tres platos que os gusten mucho» from its WhatsApp sign-up message: those live in `assistant/skills.ts`, `systemPrompt.ts` and `whatsapp/inbound.ts`, which were closed for this change
- «Me apetece» weighs only in the weekly generator, not in the single-slot pickers
- The starter deck was drafted by Producto from the catalogue; Cocina should review it (`TASTE_STARTER_DECK`)

## Source

- [packages/shared/src/types/taste.ts](../packages/shared/src/types/taste.ts) — verdicts, schemas, starter deck, constants
- [apps/api/src/routes/taste.ts](../apps/api/src/routes/taste.ts) — routes + `nextBatch`
- [apps/api/src/services/tasteDeck.ts](../apps/api/src/services/tasteDeck.ts) — cards (meta, main ingredients, protein), starter deck, variety order
- [apps/api/src/services/tasteAI.ts](../apps/api/src/services/tasteAI.ts) — Claude's pick and the free-text reading (rules without Claude)
- [apps/api/src/services/tasteStore.ts](../apps/api/src/services/tasteStore.ts) — catalogue, verdicts, offers, household sets, memory writes
- [apps/api/src/services/householdRatings.ts](../apps/api/src/services/householdRatings.ts) · [recipeMatcher.ts](../apps/api/src/services/recipeMatcher.ts) · [menuGenerator.ts](../apps/api/src/services/menuGenerator.ts)
- [apps/web/src/app/afinar/page.tsx](../apps/web/src/app/afinar/page.tsx) · [components/taste/](../apps/web/src/components/taste/) · [hooks/useTaste.ts](../apps/web/src/hooks/useTaste.ts)
- Tests: `apps/api/src/tests/taste.test.ts`, `apps/api/src/tests/tasteRoute.smoke.ts`, `apps/web/e2e/afina-tu-menu.spec.ts`
