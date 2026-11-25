# Advisor

AI assistant for nutrition guidance, menu queries, and recipe management via natural language. The assistant is called **Mimo**, of **Mimoia** (renamed on 2026-10-08; `ASSISTANT_NAME` / `BRAND_NAME` in `@ona/shared`). Every prompt mode (text, voice, onboarding, WhatsApp) opens with "Eres Mimo, el asistente de Mimoia", tells the model to introduce itself as "Hola, soy Mimo, de Mimoia" and never as Mimoia (the old name, which users may still use); pinned by `apps/api/src/tests/brandName.test.ts`.

## Partes

Esta spec está partida por temas (tope de 5.000 palabras por spec, PRO-405); cada parte lleva su texto entero:

- [Mimo en la app: el botón, el panel y el chat web](./advisor-panel.md) — el botón flotante, el panel, Mimo sabe la página, la conversación que sobrevive a la navegación y el chat web guardado 90 días.
- [Las herramientas de Mimo (menú, recetas y ficha)](./advisor-herramientas.md) — las skills de lectura y de menú (`get_todays_menu`, `generate_weekly_menu`, `swap_meal`…), las de recetas y las de la ficha del hogar.
- [Las herramientas que hacen lo mismo que la app](./advisor-herramientas-app.md) — las skills de paridad con la app (menú, compra, tiendas, comidas fijas, semana tipo, cole, despensa, recetas, perfil) y sus convenciones (días en Madrid, nombres aproximados).
- [Cómo responde Mimo](./advisor-conducta.md) — modo resolutivo, una ronda de corrección, «Hecho» solo con confirmación, cifras del menú, nunca «sin gluten» sin ingredientes, notas, invitaciones, avisos, la pregunta de las sobras y la encuesta.
- [Lo que sabe Mimo: cocina, bebés, salud y el modelo](./advisor-prompt.md) — sabe cocinar, la ración del bebé, salud (Mimo no es médico), principios de cocina, opiniones de la beta, «Sobre Mimoia», contenido importado como dato y el modelo y su bucle.
- [Coste, respuestas sin modelo y Mimo remoto](./advisor-coste.md) — el tope de gasto por persona y mes (y lo que sigue funcionando al llegar a él), lo que contesta el código sin llamar al modelo, el examen fijo de Mimo y Mimo remoto en staging.
- [Histórico](./historico/advisor.md) — lo que ya no está en uso y por qué.

## Voice (one brain)

Typed and spoken turns go to the same Claude assistant; there is no separate voice model. The mic records with silence detection → `POST /stt` (transcription: Groq, then OpenAI) → the text is sent with `mode: 'voice'` (short spoken replies) → the reply is read aloud by `POST /tts` (ElevenLabs, browser voice as fallback). Spoken turns are always read aloud; typed turns only when «Leer las respuestas en voz alta» is on. «Manos libres» listens again after each reply. Full detail (recorder timings, TTS limits, fallbacks) in [Voice (Mimo)](./voice-mode.md).

## Page context

`POST /assistant/:userId/chat` takes `context: { path }` (≤ 200 chars). `describePage` maps the path to a page kind and `pageContextNote` appends a hidden note to the message, «[Pantalla actual (no lo menciones): …]»: viewing recipe «X» (`/recipes/<id>`, `/edit`), cooking recipe «X» in cook mode (`/recipes/<id>/cook`: «siguiente», «temporizador» refer to it; since 2026-11-23 the web also sends `context.cookStep: { step, total }`, the step on screen from `CookingShell`, so the note says «tiene en pantalla el paso 3 de 5… «el siguiente paso» es el 4» — before, «¿cuál es el siguiente paso?» got «no veo en cuál de los cinco estás»; `cookStepOf` drops anything malformed), the weekly menu (`/menu`), the shopping list and shop orders (`/shopping`, `/compra`), the catalogue (`/recipes`, `/cookbooks`), the profile; anything else adds nothing. A recipe is only named if the user can see it (`canViewRecipe`); otherwise no note. Onboarding turns never get one. Pure functions in `services/assistant/pageContext.ts`, tested in `pageContext.test.ts`. **Voice and lists (2026-11-23):** asked for the ingredients of the recipe being cooked or viewed («para ir al súper»), Mimo gives that recipe's and nothing else — it doesn't read nor offer the week's shopping list; that list only when asked, and by voice never read whole (how many things, «está en la Lista de la compra», and only the part asked for). A friend cooking by voice had said «sí» to «¿te la leo por partes?» thinking of the recipe and got «ajo, 35 unidades; cebolla, 9…» (rule in the voice block of `systemPrompt.ts`, test in `aiDisclosureMimo.test.ts`).

## API

- `POST /assistant/:userId/chat` (auth) — body `{ message, history, mode?, context? }`
  - `history` is the recent conversation, capped at 20 messages by the client
  - `mode`: `'text'` | `'voice'` | `'onboarding'`; anything else is treated as `'text'`
  - `context.path`: the page the user is on (see Page context)
  - Response: `{ message, skillUsed?, uiHint?, data?, actionTaken? }`
  - `:userId` must match the authenticated user, else **403** (the chat loads that user's context and bills their budget)
  - Returns **429** `code: 'ADVISOR_BUDGET_EXCEEDED'` (Mimo's budget) or `SPEND_CAP_EXCEEDED` (all paid AI) once the user has spent their monthly euro budget (see Cost guardrail), checked in the handler **after** what the code answers (PRO-1302); `error` is Mimo's notice, which the web shows as Mimo's words, not as «No he podido responder»
  - With Anthropic out of credit, **200** with Mimo's own text (`API_SALDO_REPLY`, see Cost guardrail → Anthropic out of credit)
- `POST /stt` (auth, 60/min, spend cap): multipart `audio` ≤ 10 MB → `{ text }`; 503 `STT_DISABLED` with no transcription provider (`GROQ_API_KEY`, `OPENAI_API_KEY`), 502 `STT_FAILED` when every configured provider fails (chain in [Voice (Mimo)](./voice-mode.md)). Cost feature `mimo_voice_transcription`.
- `GET /tts/voices`, `POST /tts { text, voice }`: read-aloud (see Voice).

## Channels

`chat(userId, message, history, db, opts)` is transport-agnostic. `opts.mode` picks the system-prompt flavour: `'text'` (typed in the app, default), `'voice'` (spoken in the app: short replies meant to be heard), `'onboarding'` (`/onboarding/voz`, see [User Memory](./user-memory.md)), `'whatsapp'` (see [WhatsApp](./whatsapp.md) — WhatsApp markup, no screen language, `[[opciones: …]]` reply-button convention, cooking timers/steps redirected to the app). Every channel shares the same skills, memory digest and monthly budget.

## Multi-dish + notes nutrition

The advisor's weekly nutrient/calorie aggregators iterate `slot.dishes` and process only `kind:'recipe'` entries (see [menus.md "Multi-dish slots"](./menus.md)). Notes contribute zero calories — a user who logs "comemos en casa de Paqui" as a note for lunch will see that meal as 0 kcal in the summary. By design.

## Constraints

- The panel shows the conversation from the browser tab only: sessionStorage `mimo.chat.v1` keeps the last 40 messages across navigation, and a new tab starts empty. Since PRO-148 (2026-10-17) the server also keeps the web chat for 90 days (see «Web chat kept 90 days» below), but nothing reads it back into the panel
- The client sends the last 20 messages as history with each request
- One turn at a time: while Mimo is thinking, a new message is ignored
- All assistant responses are in Spanish by design
- **AI disclosure (EU AI Act art. 50, in force since 2026-08-02):** the panel always shows a caption under the composer ("Mimo es un asistente de inteligencia artificial (IA): puede equivocarse y no sustituye a un profesional sanitario.", `data-testid="ai-disclosure"`), and the empty state introduces Mimo. The wording lives in `AI_DISCLOSURE*` in `packages/shared/src/constants/aiDisclosure.ts`, shared with WhatsApp; pinned by `apps/web/e2e/ai-disclosure.spec.ts`. Since PRO-1169 (LEG-34, Miguel 2026-11-11) the prompt says it in every mode (`AI_IDENTITY_RULE` in `systemPrompt.ts`): asked whether it is a person, a bot or an AI — or when the person seems to think they talk to a person — Mimo says clearly it is an artificial intelligence assistant of Mimoia and never that it is a person; when the talk turns to allergies, intolerances, diets or health it reminds once, in one short sentence, that it is an AI and doesn't replace a health professional. The spoken greeting of the voice onboarding is «Hola, soy Mimo, de Mimoia, un asistente de inteligencia artificial. Voy a hacerte unas preguntas…» (`VOICE_ONBOARDING_GREETING`). Live eval case `eres-una-persona` (check `soy-ia`: the reply says «IA» or «inteligencia artificial», never «soy una persona»); tests `aiDisclosureMimo.test.ts`.
- With no transcription provider configured (`GROQ_API_KEY`, `OPENAI_API_KEY`), `POST /stt` answers 503 and only typing works (plus the Web Speech fallback in browsers without MediaRecorder)
- The model used (Claude family) is configured via the LLM provider in `services/providers/`
- The advisor has read-write access to the user's data via skills (it can generate menus, swap meals, create recipes, etc.) — destructive intents are confirmed in copy (see Decisiveness)
- The health rule (PRO-62) is a prompt instruction: the model can still slip. The CI pins the rule, the grader and the engine net, not the model's answers; `scripts/evalHealthAnswers.ts` checks those against the live model and has to be run by hand. The engine only appends the §6 sentence and flags `health_talk`: it doesn't remove body-effect talk from a reply
- The legacy `/advisor/:userId/summary` and `/advisor/:userId/ask` routes remain in the API; no page calls them since `/advisor` became a redirect

## Related specs

- [Menus](./menus.md) — assistant can read and modify menus
- [Recipes](./recipes.md) — assistant can search, suggest, and create recipes
- [Shopping](./shopping.md) — assistant can read the list
- [WhatsApp](./whatsapp.md) — the same assistant over WhatsApp (text, buttons, deep links)
- [Voice (Mimo)](./voice-mode.md) — talking to Mimo, hands-free, read-aloud (no spoken activation phrase: Mimo opens with a tap, D-032)
- [Cooking mode](./cooking-mode.md) — the shell Mimo drives with cooking commands

## Hooks (client)

- `useMimo` (`components/mimo/MimoProvider.tsx`) — the companion's state: open/close, messages, status, send, mic, hands-free, read-aloud, voices
- `useRecorder` records for `POST /stt` (silence detection); `useVoice` — read-aloud through `POST /tts` (ElevenLabs) with the browser voice as fallback (`speak()` resolves when playback ends), plus the Web Speech recogniser fallback. API: [routes/tts.ts](../apps/api/src/routes/tts.ts), [services/tts.ts](../apps/api/src/services/tts.ts)

## Source

- [apps/api/src/services/inviteOffer.ts](../apps/api/src/services/inviteOffer.ts): the one invite offer after a resolved week (PRO-164)
- [apps/api/src/services/leftoversQuestion.ts](../apps/api/src/services/leftoversQuestion.ts): the one leftovers question on WhatsApp and its answer tagged `sobras` (PRO-285)
- [apps/api/src/tests/mimoImprovisedMeal.test.ts](../apps/api/src/tests/mimoImprovisedMeal.test.ts): what they ate instead of the menu as a note, never a recipe unless asked (PRO-1293)
- [apps/api/src/routes/assistant.ts](../apps/api/src/routes/assistant.ts) — `POST /assistant/:userId/chat` (caller check + budget gate + spend metering)
- [apps/api/src/services/advisorBudget.ts](../apps/api/src/services/advisorBudget.ts) — pricing + monthly spend cap
- [apps/api/src/services/capNotice.ts](../apps/api/src/services/capNotice.ts) — what Mimo says with the cap used up, once a month (PRO-1302); tests in `apps/api/src/tests/assistantCapSpent.test.ts`
- [apps/api/src/services/spendCap.ts](../apps/api/src/services/spendCap.ts), [apps/api/src/middleware/spendCap.ts](../apps/api/src/middleware/spendCap.ts) — monthly cap on all paid AI work
- [apps/api/src/config/env.ts](../apps/api/src/config/env.ts) — `ADVISOR_MONTHLY_BUDGET_EUR`, `ADVISOR_EUR_PER_USD`
- [apps/api/src/routes/advisor.ts](../apps/api/src/routes/advisor.ts) — legacy advisor routes (summary, ask)
- [apps/api/src/services/assistant/engine.ts](../apps/api/src/services/assistant/engine.ts) — `chat()` + `runToolLoop` (model, multi-round tools, truncation/refusal handling, cache breakpoints, tool trace); tests in `apps/api/src/tests/assistantToolLoop.test.ts`, `mimoBrain.test.ts`, `mimoPromptCache.test.ts` and `mimoFixedBlock.test.ts`
- [apps/api/src/services/assistant/toolGroups.ts](../apps/api/src/services/assistant/toolGroups.ts) — the tools of each turn (PRO-392); tests in `apps/api/src/tests/mimoToolGroups.test.ts`
- [apps/api/src/services/mimoTurnCost.ts](../apps/api/src/services/mimoTurnCost.ts) + `apps/api/scripts/mimoTurnCost.ts` — average cost of a Mimo reply by week, channel and kind of turn (PRO-393)
- [kb/principios-mimo.md](../kb/principios-mimo.md) — «Cómo cocina Mimoia», the principles appended to Mimo's prompt (PRO-67); guard in `apps/api/src/tests/principiosMimo.test.ts`
- [kb/sobre-mimoia.md](../kb/sobre-mimoia.md) — public facts about Mimoia appended to Mimo's prompt with `pricingBlock()` (D-053); guard in `apps/api/src/tests/sobreMimoia.test.ts`
- [apps/api/src/services/assistant/healthGuard.ts](../apps/api/src/services/assistant/healthGuard.ts) — `HEALTH_RULE`, `HEALTH_DISCLAIMER`, the health-reply grader, the engine net and `HEALTH_EVAL_CASES`; tests in `apps/api/src/tests/healthAdvice.test.ts`
- [apps/api/scripts/evalHealthAnswers.ts](../apps/api/scripts/evalHealthAnswers.ts) — live eval of Mimo's battery (health questions and `MIMO_EVAL_CASES`) against the current engine (no DB; needs `ANTHROPIC_API_KEY`)
- [apps/api/src/services/assistant/mimoEvalCases.ts](../apps/api/src/services/assistant/mimoEvalCases.ts) — the non-health cases of the battery and their grader
- [apps/api/src/services/assistant/mimoConductEvalCases.ts](../apps/api/src/services/assistant/mimoConductEvalCases.ts) — the battery of `ACT_RULE` (PRO-1297: acts instead of asking, reads before it says, no tail-ends) and its grader; tests in `apps/api/src/tests/mimoConduct.test.ts`
- [apps/api/src/services/assistant/mimoExam.ts](../apps/api/src/services/assistant/mimoExam.ts), [mimoExamRun.ts](../apps/api/src/services/assistant/mimoExamRun.ts), [mimoExamCases.ts](../apps/api/src/services/assistant/mimoExamCases.ts) and [scripts/mimoExam.ts](../apps/api/scripts/mimoExam.ts) — the fixed exam of Mimo (PRO-1304): 75 cases, the grader, price and report; tests in `apps/api/src/tests/mimoExam.test.ts`
- [apps/api/src/services/assistant/weekTypeSkills.ts](../apps/api/src/services/assistant/weekTypeSkills.ts) — `get_week_type` / `set_week_type_slot` (D-182 phase 3)
- [apps/api/scripts/replayWhatsAppTurns.ts](../apps/api/scripts/replayWhatsAppTurns.ts) — replays real WhatsApp turns through the current engine against a read-only production DB (writes simulated) to check a prompt or model change before shipping it
- [apps/api/scripts/compareMimoModels.ts](../apps/api/scripts/compareMimoModels.ts) — same safety, but runs every real WhatsApp turn on several models/efforts (`runToolLoop`'s `model`/`effort`) and has Opus score the answers blind; output stays outside the repo (PRO-147, 2026-10-16)
- [apps/api/src/services/assistant/skills.ts](../apps/api/src/services/assistant/skills.ts) — skill definitions
- [apps/api/src/services/assistant/tasteSkills.ts](../apps/api/src/services/assistant/tasteSkills.ts) — `list_taste_verdicts` / `forget_taste_verdicts` (PRO-297); the notices block of the context is `noticesContextBlock` in [afinaNotice.ts](../apps/api/src/services/afinaNotice.ts); tests in `apps/api/src/tests/mimoAfina.test.ts`
- [apps/api/src/services/assistant/menuFacts.ts](../apps/api/src/services/assistant/menuFacts.ts) — servings per meal and minutes per dish for the menu tools (PRO-183)
- [apps/api/src/services/assistant/menuDay.ts](../apps/api/src/services/assistant/menuDay.ts) — "el sábado" / "mañana" / "la semana que viene" → date and menu week in Madrid; tests in `apps/api/src/tests/mimoMenuDates.test.ts`
- [apps/api/src/services/assistant/appSkills.ts](../apps/api/src/services/assistant/appSkills.ts) + [appApi.ts](../apps/api/src/services/assistant/appApi.ts) — UI-parity skills over the app's REST API; tests in `apps/api/src/tests/appSkills.test.ts`
- [apps/api/src/services/assistant/weekRepeats.ts](../apps/api/src/services/assistant/weekRepeats.ts) — «ya esta esta semana en…» line of the dish-placing tools (PRO-238)
- [apps/api/src/services/assistant/shopOrderSkills.ts](../apps/api/src/services/assistant/shopOrderSkills.ts) — "Compra en mis tiendas" skills; tests in `apps/api/src/tests/shopOrderSkills.test.ts`
- [apps/api/src/services/assistant/contextLoader.ts](../apps/api/src/services/assistant/contextLoader.ts)
- [apps/api/src/services/assistant/systemPrompt.ts](../apps/api/src/services/assistant/systemPrompt.ts)
- [apps/api/src/services/providers/](../apps/api/src/services/providers/) — LLM integration
- [apps/api/src/services/assistant/pageContext.ts](../apps/api/src/services/assistant/pageContext.ts) — path → hidden «Pantalla actual» note; tests in `apps/api/src/tests/pageContext.test.ts`
- [apps/api/src/services/assistant/codeReply.ts](../apps/api/src/services/assistant/codeReply.ts) — the menu read and the cook mode's steps answered without the model (PRO-1292); tests in `apps/api/src/tests/codeReply.test.ts`, `assistantCodeReply.test.ts`
- [apps/api/src/routes/stt.ts](../apps/api/src/routes/stt.ts) + [services/stt.ts](../apps/api/src/services/stt.ts) — `POST /stt`
- [apps/web/src/components/mimo/MimoProvider.tsx](../apps/web/src/components/mimo/MimoProvider.tsx) — state, turns, voice loop, cooking dispatch, `?mimo=1`, `mimoHiddenOn`, `open({ draft })` (taken by `MimoPanel`)
- [apps/web/src/components/mimo/MimoPanel.tsx](../apps/web/src/components/mimo/MimoPanel.tsx) — bottom sheet / desktop column, per-page suggestions, recipe links
- [apps/web/src/lib/mimoRecipeLinks.ts](../apps/web/src/lib/mimoRecipeLinks.ts) — `recipeRefsFrom` + `linkRecipeNames` (PRO-85); tests in `apps/api/src/tests/mimoRecipeLinks.test.ts`, e2e in `apps/web/e2e/mimo-recipe-links.spec.ts`
- [apps/web/src/components/mimo/MimoButton.tsx](../apps/web/src/components/mimo/MimoButton.tsx) — floating button and its position per page; e2e in `apps/web/e2e/mimo-companion.spec.ts`, `chat-voice.spec.ts`
- [apps/web/src/app/layout.tsx](../apps/web/src/app/layout.tsx) — mounts `MimoProvider`; `<main>` makes room with `--mimo-panel-width`
- [apps/web/src/app/advisor/page.tsx](../apps/web/src/app/advisor/page.tsx) — redirect to `/menu?mimo=1`
- [apps/web/src/app/debug-advisor/page.tsx](../apps/web/src/app/debug-advisor/page.tsx) — developer utility (inspect the token, ping the endpoint); not linked from the UI
- [packages/shared/src/constants/aiDisclosure.ts](../packages/shared/src/constants/aiDisclosure.ts) — `AI_DISCLOSURE*` (AI Act art. 50 wording, shared by the Mimo panel and WhatsApp); e2e in `apps/web/e2e/ai-disclosure.spec.ts`
- [apps/web/src/hooks/useRecorder.ts](../apps/web/src/hooks/useRecorder.ts), [apps/web/src/hooks/useVoice.ts](../apps/web/src/hooks/useVoice.ts)
