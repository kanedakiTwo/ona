# Ficha del hogar

Everything Mimoia knows about a household, with a section per person (D-064, PRO-150). It is the base the rest of the «ficha viva» builds on: the daily signal collector (PRO-151), the nightly refiner (PRO-152), «Tu ficha» in the app and Mimo / the menu reading it (PRO-153, PRO-139). **Today the data model, the daily signal collector (PRO-151), the nightly refiner (PRO-152) with its passes at the moment and every week (PRO-320), the ficha as the one source of what we know about a person (PRO-316) and the «Tu ficha» API (PRO-317) exist**: the refiner writes the ficha every night, **Mimo and the menu read it** (PRO-253, see «Who reads the ficha»), the API serves it to its reader and **«Tu ficha» shows it in Perfil** (PRO-317/318, see «Tu ficha»). The one exception is **how the household cooks** (PRO-217, below): asked in the sign-up, shown and changed in Perfil and by Mimo.

## Partes

Esta spec está partida por temas (tope de 5.000 palabras por spec, PRO-405); cada parte lleva su texto entero:

- [Cómo aprende la ficha y quién la lee](./household-profile-aprende.md) — las señales diarias, el refinador de cada noche, lo que se guarda al momento y cada semana, y quién lee la ficha.
- [«Tu ficha»: la API, la pantalla y Mimo](./household-profile-tu-ficha.md) — la API de «Tu ficha», su pantalla y lo que hace Mimo con la ficha.

## User Capabilities

- **«¿Cómo cocináis en casa?»** (PRO-217, D-069): «Cocino cada día» · «Cocino unos días y aprovecho para otros» · «Batch cooking: cocino una o dos veces y dejo hecha la semana» · «Improviso: decido cada día». Asked in the web sign-up right after the household, and since 2026-11-03 also in the WhatsApp sign-up (it replaced «¿Cuántas veces a la semana cocinas?», whose `cookingFreq` the API now reads from this answer — [Auth](./auth.md), [WhatsApp](./whatsapp.md)); on `/profile` the card «Estilo», inside «Cómo cocináis» (`profile-cooking-style`), shows the answer (or «Sin contestar») and changes it with one tap, no «Guardar cambios»; Mimo changes it when the household says so («ahora hacemos batch los domingos», tool `set_cooking_style`, web chat, voice and WhatsApp) and reads it in its context (in the «Hogar» line, in place of how often they cook, which since 2026-11-03 is read from this answer: `cookingContextLine`). Only collected and shown: the menu uses it with PRO-219
- Every night, a household that used Mimoia that day gets its ficha refined from what happened (see «Nightly refiner»); and **at once** when it finishes the sign-up or a round of «Afina tu menú», and **every Monday** over the last four weeks for the slow patterns («cada 15 días pedís ceviche») — see «At the moment and every week»
- Mimo knows what the ficha says (portrait and facts in force) in the web chat and on WhatsApp, and the menu respects it: with «sin horno hasta nuevo aviso» in the ficha, no oven recipe comes out (PRO-253)
- **Perfil, by the questions Mimo asks when it plans** (PRO-1202, maqueta del perfil de 2026-11-12, columns 1–3; Miguel 2026-11-12, option A): `/profile` keeps only what changes the menu. On top, «Tu casa», the household's name (h1), the founding badge and a **gear** (`profile-settings-link`, «Ajustes») to `/profile/ajustes`; under it a strip (`profile-ficha`) with the last thing Mimo learnt («Lo último que ha aprendido Mimo: …», `recentlyLearnt`; else the portrait's opening; else «Todavía os conozco poco.»), «Tu ficha · N cosas que sé · 1 pregunta para ti» (→ `/profile/ficha`) and **«Cuéntale más»** (Mimo opens with «Te cuento algo de casa: »); hidden for a `child` member (403) or without a household (404). Then five sections, in this order: **Vuestra semana** (below), **Quién come** ([Household](./household.md), PRO-1203), **Cómo cocináis** (`profile-cooking`: rows «Tiempo» — «30 min entre semana · 90 min el finde» from `time_available` —, «Aparatos» and «Nivel», each to its group of `/profile/memoria` (`#rutina`, `#cocina`), then the «Estilo» card), **Lo que os gusta** (`profile-likes`: «Cocinas» from `cuisine_bias`, ♥ from 70; «No os gusta», what anyone of «Quién come» and the reader's memory dislike, once each, → `/profile/quien/me`; «Lo que os importa», the beliefs of `/profile/creencias`; «Afina tu menú» with «N de M recetas valoradas» → `/afinar`) and **La compra** (`profile-shopping`: «Básicos fijos» → `/profile/staples`, «Tus tiendas» → `/compra/tiendas`). Each row is a link with a one-line status (`lib/profileSummary.ts`); each screen saves its own, there is no «Guardar cambios». «Invitar a otro hogar» closes the page. One column on a phone, two from `lg` in the page's usual width.
- **Ajustes** (`/profile/ajustes`, PRO-1202, maqueta column 2; «‹ Perfil»): four blocks — **Mimo** (`settings-mimo`: WhatsApp when the channel is on or a phone is linked, «Voz» `profile-mimo-voice`, «Cuéntaselo de una vez» → `/onboarding/voz`), **Avisos** (`settings-avisos`: «Qué te llega» with the link to `/profile/avisos`, «Notificaciones del móvil» and the Friday email `profile-newsletter`), **Plan** (`settings-plan`: «Suscripción» with its status → `/profile/suscripcion`) and **Cuenta y privacidad** (`settings-cuenta`: the e-mail; «Permisos · datos de salud», whether the health-data consent was given and how it is withdrawn; the «Enviar a <cadena>» consents; «Tus datos» → `/profile/ficha` with «Descargar mi ficha»; the privacy policy; «Borrar mi cuenta»; **«Cerrar sesión»**; «Panel de admin» for an admin). `/profile/avisos` and `/profile/suscripcion` go back to «‹ Ajustes».
- **Moved out of Perfil** (PRO-1202): «Mis recetas» (`/recipes/mias`) and «Recetarios» (`/recipes/recetarios`; `/profile/cookbooks` redirects there) to the Recetas tab ([My Recipes](./my-recipes.md), [Cookbooks](./cookbooks.md)); the pantry only in Cocinar ([Pantry](./pantry.md)); the «Casa» card (its page `/profile/casa` lives on from «Invitar» in «Quién come»). Where each function of the old profile went:

  | Before (Perfil) | Now |
  |---|---|
  | «Tu ficha» card | strip under the name → `/profile/ficha` |
  | «Casa» card | «Quién come» (people) and its «Invitar» (`/profile/casa`) |
  | «Afina tu menú», «Creencias» | «Lo que os gusta» |
  | «Cómo cocináis» | «Cómo cocináis» → «Estilo», with «Tiempo», «Aparatos», «Nivel» |
  | «Despensa» | Cocinar (`/cocinar#despensa`) |
  | «Fijos» | «La compra» → «Básicos fijos» |
  | «Recetarios», «Mis recetas» | Recetas (`/recipes/recetarios`, `/recipes/mias`) |
  | «Suscripción» | Ajustes → Plan |
  | «Voz», «WhatsApp», «Onboarding por voz» (···) | Ajustes → Mimo |
  | «Recordatorios» (avisos, push, correo de los viernes, «Enviar a <cadena>») | Ajustes → Avisos; the shop consents in Cuenta y privacidad |
  | «Tu cuenta» (Salir, privacidad, borrar la cuenta), «Panel de admin» (···) | Ajustes → Cuenta y privacidad |
  | «Invitar a otro hogar» | end of Perfil |

- **«Vuestra semana» heads Perfil** (PRO-1204, maqueta del perfil de 2026-11-12; Miguel 2026-11-12: «tu semana tipo tiene muy poca relevancia ahora mismo»): first of the five sections, the household's semana tipo drawn small (`WeekTypeHead`): a grid of 7 days × the meals it uses (lunch and dinner always, breakfast and snack when some day has them), each slot in one or two words with a colour per kind — legumbre, pescado, táper, fuera, cole, fijo, another dish type, libre (`summarizeWeekType`, `@ona/shared`, the option of this week's turn) —, today's column marked, and a line with what doesn't change («Comen en el cole de L a V» from the school menu's weekdays, «30 min en total entre semana» when `time_available` is the same Monday to Friday). «Editar» (and a tap on the grid) opens `/profile/semana-tipo`; **«Ajustar con Mimo»** opens Mimo with the message started («Quiero ajustar nuestra semana tipo: »). A household that never touched it sees the default grid and «Así come Mimoia por defecto: cuéntale la tuya.» (Mimo starts with «Te cuento cómo es nuestra semana: »). The old «Tu semana tipo» link card is gone. Same data as the generator (`GET /households/me/week-type`), no other model. Tests: `weekTypeSummary.test.ts`, e2e `week-type-head.spec.ts`
- **«Tu ficha»** (PRO-318, `/profile/ficha`, from the strip under the name in Perfil, PRO-1202): every adult of the house reads what Mimoia knows — the portrait Mimo writes each night, the pending question («Sí» / «No» / «Ahora no»), «Lo último que he aprendido», then a chip per person («La casa», «Tú», each member, each person without an account) with the facts by topic and where each comes from. A tap on a fact opens «¿Por qué lo sé?» (what Mimo saw, how sure, since when, «Cómo lo uso») with «Así es» / «Corregir» / «Olvidar» when the reader may change it; another member's facts are read-only («Esto lo cambia Marta desde su ficha»). The reader's own part adds their health under «Solo lo ves tú», the switch «Aprender de lo que hago», «Editar mis datos uno a uno» (`/profile/memoria`) and «Descargar mi ficha»; a person without an account gets «Editar» (alias, age band) and «Quitar de la casa»; «+ Persona» adds one. «Añadir algo que deba saber» opens Mimo with the message started. `/profile/ficha/historial` lists «Lo que ha cambiado» by day with «Deshacer» on what Mimo did. A `child` member doesn't get it (see «Tu ficha: the screen»)
- **Mimo talks about the ficha** (PRO-319, web chat, voice and WhatsApp): «¿qué sabes de mí?», «apunta que…», «olvida que…», «¿por qué crees que…?», «pausa lo que aprendes de mí», «quiero proteína en cada plato»; and, at most once a week, Mimo asks the pending question at a natural moment (see «Mimo and the ficha»)
- Everything a person tells Mimoia about themselves or their home lands in the household's ficha at once (PRO-316, D-110): what they write in «Lo que recuerdo de ti», what they tell Mimo on the web, by voice or on WhatsApp, what they answer in the sign-up and in «Afina tu menú» — each fact with where it was said («Se lo dijiste a Mimo por WhatsApp: No le gusta: cilantro») and its history row; forgetting a memory key retires the fact

## Model

One ficha per **household** (the menu is the household's), with facts about the household as a whole, about a member with an account, or about a person without one.

- **Facts** (`profile_facts`): household, subject (none = the household; `subject_user_id` = a member; `subject_person_id` = a person without an account; never both), `type`, `value` (jsonb, validated per type), `origin` (`user` · `onboarding` · `ai_realtime` · `ai_nightly` · `ai_weekly`), `confidence` 0–1, `evidence` `[{ signal, date AAAA-MM-DD, summary }]`, `valid_until` (temporary situations), `status` (`active` · `retired`), `source_memory_id` (the `user_memories` row it was copied from)
- **Fact types**: every `user_memories` key, with the same value schema (`MEMORY_VALUE_SCHEMAS`), plus:

| Type | Value | Example |
|---|---|---|
| `fixed_dish` | `{ dish, days?, meal? }` | nos gusta mucho la pizza (with days and a meal it goes to the semana tipo, not here — D-182) |
| `skipped_meal` | `{ days, meal, reason? }` | el fin de semana no se cocina (since D-182 phase 3 Mimo writes «no hay» in the semana tipo instead; the menu never read this one) |
| `dish_frequency` | `{ dish, minWeeks, maxWeeks }` (1–52, min ≤ max) | coliflor gratinada cada 6–10 semanas |
| `affinity` | `{ kind: ingredient\|style, target, score −2..+2 }` | le encanta la cuchara (+2) |
| `effort` | `{ days, meal, activeMinutes, totalMinutes }` (active ≤ total) | entre semana, 15 min de trabajo aunque cueza 3 h |
| `temporary_situation` | `{ description }` + the fact's `valid_until` | sin horno hasta el 2-nov |
| `shopping` | `{ places?, days?, note? }` | frutería del barrio los sábados |
| `batch_cooking` | `{ batches, days?, lunchboxes? }` | cocina por tandas el domingo, con táperes |
| `novelty` | `{ score −2..+2 }` | prefiere la rutina (−2) |
| `cooking_style` | `{ style: daily\|cook_and_reuse\|batch\|improvise }` | «Batch cooking: cocino una o dos veces y dejo hecha la semana» (PRO-217) |
| `shopper` | `{ who: me\|other\|shared }` | «¿Quién hace la compra?» in the sign-up, web and WhatsApp, only with 2 adults or more: «Yo» · «Otra persona de casa» · «Nos turnamos» (PRO-383, about the household, origin onboarding; `services/profile/shopper.ts`; «Tiempo y compra» in «Tu ficha»: «La compra la hace quien se dio de alta» · «…otra persona de casa» · «La compra la hacéis por turnos»). Only collected and shown |
| `menu_rule` | `{ rule: max_per_week, target, times 1–13 }` or `{ rule: light, meal: lunch\|dinner }` | «arroz no más de un día a la semana», «cenas ligeras» (2026-11-19; about the household, multi-valued; the menu and «Cambiar» keep it, see [Menus](./menus.md)) |
| `protein_minimum` | `{ scope: every_dish }` | «Proteína en cada plato»: 80 g de carne, pescado o huevo por ración también en entrantes y platos de arroz, legumbre o pasta (about a person; Miguel, 2026-10-21) |

  Days are `lunes`…`domingo`; meals `breakfast` · `lunch` · `snack` · `dinner`.
- **People without an account** (`household_persons`): `alias` and `age_band` (`0-2` · `3-5` · `6-12` · `13-17` · `adulto`). **A minor's name is never stored**: the schema has no name field (`.strict()`), and a minor's alias must be one of `MINOR_ALIASES` («la pequeña», «el mayor», «hija»…), optionally with a number («hija 2»). An adult (the grandmother) may have any alias up to 40 characters
- **Portrait** (`household_profiles`): one per household, `portrait` text of at most 250 words (`PORTRAIT_MAX_WORDS`, checked in the Zod schema), `version`, `model`, `generated_at`. No health and no judgements (constitution §6)
- **Pending questions** (`profile_questions`): what the AI suspects but doesn't know («¿seguís sin horno?»), with subject, `fact_type`, `origin`, `status` (`pending` · `asked` · `answered` · `dismissed`), `asked_at`, `resolved_at`
- **History** (`profile_changes`): `action` (`fact_added`, `fact_updated`, `fact_retired`, `portrait_updated`, `person_added`/`updated`/`removed`, `question_added`/`resolved`/`asked`), `fact_id`, `fact_type`, `before`, `after`, `reason`, `origin`, `actor_user_id`, date

## Constraints

- **Health rules are today's** (PRO-21, LEG-03): health types are the same keys as the memory's (`physical.*`, `restrictions`; `HEALTH_PROFILE_FACT_TYPES`). Writing one needs the health consent and never comes from WhatsApp (`canWriteProfileFact`). A health fact is about a person, never the whole household, and is never deduced by the nightly or weekly refiner (`origin` `ai_nightly`/`ai_weekly` is rejected for health types)
- **Withdrawing the health consent** also deletes that person's health facts in the ficha and their history rows (`services/healthConsent.ts`); deleting the account deletes the facts about that person (cascade)
- **Visibility per fact** (Miguel, 2026-10-16): a health fact about a member with an account is read only by that member; the rest of the ficha by every adult member (`owner`, `member`); `child` members read nothing; the menu generator and Mimo (`{ kind: 'system' }`) read everything so they can respect it. `visibleProfileFacts(facts, viewer)` is the filter the future API must apply
- **Copy from `user_memories`** (`applyProfileFromMemories`, after `db:migrate` on every boot): each memory row → one fact in the user's primary household (else the first one they joined; users with none are skipped and counted). Origin: `manual` → `user`, `onboarding` → `onboarding`, `inferred` → `ai_realtime`; same confidence; one evidence item (`signal: user_memories`). `household.adults`, `household.kids_2_to_10`, `equipment`, `weekly_budget_eur` and `region` (PRO-226) are about the household; every other key is about the user. Each copy writes a `fact_added` history row. Idempotent: `source_memory_id` is unique and a copied memory is skipped
- **The ficha is the one source; the memory is its mirror** (PRO-316, D-110, `services/profile/writer.ts`): `setMemoryFact`, `setMemoryBatch` and `deleteMemoryFact` write `user_memories` and the ficha **in the same transaction** (`mirrorMemoryWrite` / `mirrorMemoryDelete` → `upsertProfileFact` / `retireProfileFacts`), so the two never disagree. The fact points at its memory row (`source_memory_id`), so the boot copy never duplicates it. A single-valued type (every memory key and the household habits; the multi-valued ones are `MULTI_VALUED_PROFILE_FACT_TYPES`, shared with the refiner) is updated in place; the same value again only adds its evidence. Origin from the memory source as in the copy; evidence `signal` = where it was said (`profile` · `chat` · `whatsapp` · `voice` · `onboarding` · `afina`), passed by each caller (`MemoryWriteOptions`). The ficha's health rules apply on top (`canWriteProfileFact`: never health from WhatsApp). A user without a household is skipped (the boot copy picks the row up later). `user_memories` stays as long as the menu generator reads restrictions, dislikes, equipment and time from it
- The boot copy (`applyProfileFromMemories`) only catches rows written before PRO-316 or by a user who had no household yet, and puts back in step (`refreshed`, with its `fact_updated` row) a copy whose memory value changed after it (`STALE_MEMORY_COPIES_SQL`); idempotent
- Migration `0057_household_profile` only adds tables
- **How the household cooks** (PRO-217, `services/profile/cookingStyle.ts`): one `cooking_style` fact about the household (no subject), single-valued. `GET /household/cooking-style` → `{ style | null, canEdit }` and `PUT /household/cooking-style { style }` → `{ style, changed }` (auth; the caller's primary household; a `child` member gets 403). Perfil calls it directly and Mimo's `set_cooking_style` calls it as the user (loopback), so both write the same fact. The sign-up writes it with origin `onboarding`; Perfil and Mimo with origin `user` (the household said it). Each write adds an evidence item (`onboarding` · `profile` · `chat` · `whatsapp`) and a `fact_added` / `fact_updated` history row; the same answer again changes nothing. No migration (facts are typed by `type` text). The nightly refiner treats it as single-valued (its prompt doesn't list the type yet). Mimo's WhatsApp-first sign-up doesn't ask it (it saves it if the household tells)

## Related specs

- [User Memory](./user-memory.md) — the per-user facts copied into the ficha
- [Household](./household.md) — the household and its members (roles)
- [Privacy](./privacy.md) — health-data consent and what withdrawing deletes

## Source

- [packages/shared/src/types/householdProfile.ts](../packages/shared/src/types/householdProfile.ts) — types, Zod schemas, minors' aliases, health and visibility rules, memory → fact mapping constants
- [apps/api/src/db/schema.ts](../apps/api/src/db/schema.ts) — `household_persons`, `profile_facts`, `household_profiles`, `profile_questions`, `profile_changes`
- [apps/api/src/db/migrations/0057_household_profile.sql](../apps/api/src/db/migrations/0057_household_profile.sql)
- [apps/api/src/routes/householdProfile.ts](../apps/api/src/routes/householdProfile.ts) — «Tu ficha» routes (PRO-317)
- [apps/api/src/services/profile/fichaStore.ts](../apps/api/src/services/profile/fichaStore.ts) — read for a reader, confirm, correct, forget, undo, answer, pause, people, export
- [apps/api/src/services/profile/view.ts](../apps/api/src/services/profile/view.ts) — sentences for the reader, topics, origins, «Cómo lo uso», history
- [apps/api/src/services/profile/correction.ts](../apps/api/src/services/profile/correction.ts) — «Corregir»: the reader's words into the type's value, or a note
- [packages/shared/src/types/fichaView.ts](../packages/shared/src/types/fichaView.ts) — `FichaView` and friends
- [apps/web/src/app/profile/ficha/page.tsx](../apps/web/src/app/profile/ficha/page.tsx), [apps/web/src/app/profile/ficha/historial/page.tsx](../apps/web/src/app/profile/ficha/historial/page.tsx) — «Tu ficha» and «Lo que ha cambiado» (PRO-318)
- [apps/web/src/components/ficha/](../apps/web/src/components/ficha/) — `FichaUI` (shell, rows, badges, status line), `FichaSheets` (why, correct, person), `LearningSwitch`
- [apps/web/src/hooks/useFicha.ts](../apps/web/src/hooks/useFicha.ts) — TanStack hooks and `downloadFicha`; [apps/web/src/lib/ficha.ts](../apps/web/src/lib/ficha.ts) — dates in words, chips, new household, titles
- [apps/web/e2e/profile-ficha.spec.ts](../apps/web/e2e/profile-ficha.spec.ts)
- [apps/api/src/db/migrations/0091_ficha_learning_pause_and_answers.sql](../apps/api/src/db/migrations/0091_ficha_learning_pause_and_answers.sql)
- [apps/api/src/services/assistant/fichaSkills.ts](../apps/api/src/services/assistant/fichaSkills.ts) — Mimo's ficha tools (PRO-319)
- [apps/api/src/tests/fichaMimo.test.ts](../apps/api/src/tests/fichaMimo.test.ts), [apps/api/src/tests/fichaMimo.smoke.ts](../apps/api/src/tests/fichaMimo.smoke.ts)
- [apps/api/src/tests/fichaView.test.ts](../apps/api/src/tests/fichaView.test.ts), [apps/api/src/tests/fichaRoute.smoke.ts](../apps/api/src/tests/fichaRoute.smoke.ts)
- [apps/api/src/services/profile/writer.ts](../apps/api/src/services/profile/writer.ts) — the one way a fact gets in: `upsertProfileFact`, `retireProfileFacts`, `mirrorMemoryWrite` / `mirrorMemoryDelete` (PRO-316)
- [apps/api/src/tests/profileWriter.test.ts](../apps/api/src/tests/profileWriter.test.ts) — add / update / unchanged, multi-valued, retire, the memory mirror (subject, origin, evidence, no health from WhatsApp)
- [apps/api/src/services/profileFromMemories.ts](../apps/api/src/services/profileFromMemories.ts) — idempotent copy from `user_memories` and refresh of stale copies, run from `db/migrate.ts`
- [apps/api/src/services/healthConsent.ts](../apps/api/src/services/healthConsent.ts) — withdrawal deletes health facts
- [apps/api/src/tests/householdProfile.test.ts](../apps/api/src/tests/householdProfile.test.ts) — schema, minors, health, visibility, mapping
- [packages/shared/src/types/cookingStyle.ts](../packages/shared/src/types/cookingStyle.ts) — the question, the four answers, the route path (PRO-217)
- [apps/api/src/services/profile/cookingStyle.ts](../apps/api/src/services/profile/cookingStyle.ts) — read and write the `cooking_style` fact with its history
- [apps/api/src/routes/householdHabits.ts](../apps/api/src/routes/householdHabits.ts) — `GET`/`PUT /household/cooking-style`
- [apps/api/src/services/assistant/householdHabitsSkills.ts](../apps/api/src/services/assistant/householdHabitsSkills.ts) — Mimo's `set_cooking_style`
- [apps/web/src/components/profile/CookingStyleCard.tsx](../apps/web/src/components/profile/CookingStyleCard.tsx) — «Estilo» in «Cómo cocináis» on `/profile` (`hooks/useCookingStyle.ts`)
- [apps/web/src/app/profile/page.tsx](../apps/web/src/app/profile/page.tsx) — Perfil: the name, the gear, the strip and the five sections (PRO-1202); [apps/web/src/lib/profileSummary.ts](../apps/web/src/lib/profileSummary.ts) — the rows' status lines
- [apps/web/src/app/profile/ajustes/page.tsx](../apps/web/src/app/profile/ajustes/page.tsx) — Ajustes: Mimo, Avisos, Plan, Cuenta y privacidad (PRO-1202)
- [apps/web/src/components/recipes/YourRecipesLinks.tsx](../apps/web/src/components/recipes/YourRecipesLinks.tsx) — «Mis recetas» and «Recetarios» on `/recipes`
- Tests: [apps/api/src/tests/profileSummary.test.ts](../apps/api/src/tests/profileSummary.test.ts); e2e [apps/web/e2e/profile-sections.spec.ts](../apps/web/e2e/profile-sections.spec.ts) (390×844: the five sections in order, the gear and Ajustes' four blocks, «Mis recetas» and «Recetarios» in Recetas, the old links, «Cerrar sesión»)
- [apps/api/src/tests/cookingStyle.test.ts](../apps/api/src/tests/cookingStyle.test.ts), [apps/api/src/tests/cookingStyleRoute.smoke.ts](../apps/api/src/tests/cookingStyleRoute.smoke.ts) — answers, schemas, Mimo and Perfil through the same route; sign-up, Perfil and Mimo on the same fact against Postgres
- [apps/web/e2e/onboarding-cooking-style.spec.ts](../apps/web/e2e/onboarding-cooking-style.spec.ts) — the sign-up question and the Perfil card at 390×844
- [apps/api/src/tests/profileFromMemories.smoke.ts](../apps/api/src/tests/profileFromMemories.smoke.ts) — a memory write is in the ficha at once (Perfil, Mimo on WhatsApp), the boot copy catches up and refreshes a stale copy, forgetting retires, consent withdrawal, cascade
- [apps/api/src/services/profile/signals.ts](../apps/api/src/services/profile/signals.ts) — daily signals: builders per source, formatter with the size cap, Postgres loader
- [apps/api/src/services/profile/healthText.ts](../apps/api/src/services/profile/healthText.ts) — health sentences out of WhatsApp text (`HEALTH_TEXT_PATTERNS`, reused by the refiner)
- [apps/api/src/services/activityEvents.ts](../apps/api/src/services/activityEvents.ts) — shopping events with the product (`setActivityDetail`)
- [apps/api/src/db/migrations/0063_activity_item_onboarding_note.sql](../apps/api/src/db/migrations/0063_activity_item_onboarding_note.sql)
- [apps/api/src/tests/profileSignals.test.ts](../apps/api/src/tests/profileSignals.test.ts) — a synthetic day in order and without WhatsApp health, the size cap, the health filter
- [apps/api/src/tests/profileSignals.smoke.ts](../apps/api/src/tests/profileSignals.smoke.ts) — every source read from Postgres, sign-up note and shopping product names saved by the real routes
- [apps/api/src/services/profile/reader.ts](../apps/api/src/services/profile/reader.ts) — who reads the ficha: Mimo's digest and the menu's filters (PRO-253)
- [apps/api/src/tests/profileReader.test.ts](../apps/api/src/tests/profileReader.test.ts)
- [apps/api/src/services/profile/refiner.ts](../apps/api/src/services/profile/refiner.ts) — nightly refiner: eligibility, prompt and batch request, closed format, rules (`planRefinement`), writing, cost, scheduler entry (`runProfileRefinerIfDue`)
- [apps/api/src/services/notificationScheduler.ts](../apps/api/src/services/notificationScheduler.ts) — calls the refiner on every tick
- [apps/api/src/services/costLedger.ts](../apps/api/src/services/costLedger.ts) — `householdId` and `priceFactor` on a cost event
- [apps/api/src/db/migrations/0064_profile_refiner.sql](../apps/api/src/db/migrations/0064_profile_refiner.sql)
- [apps/api/src/tests/profileRefiner.test.ts](../apps/api/src/tests/profileRefiner.test.ts) — simulated model: «sin horno» → fact with evidence, deduced health discarded and recorded, the user's fact becomes a question, more than 10 changes cut, households without activity / paused / over the cap left out, cost at the batch price
- [apps/api/src/tests/profileRefiner.smoke.ts](../apps/api/src/tests/profileRefiner.smoke.ts) — one night end to end against Postgres with a simulated batch
- [apps/api/src/tests/profileRefinerNow.test.ts](../apps/api/src/tests/profileRefinerNow.test.ts), [apps/api/src/tests/profileRefinerNow.smoke.ts](../apps/api/src/tests/profileRefinerNow.smoke.ts) — at the moment and every week (PRO-320)
