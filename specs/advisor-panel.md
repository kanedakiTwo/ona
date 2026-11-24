# Advisor · Mimo en la app: el botón, el panel y el chat web

> Parte de [Advisor](./advisor.md) (la portada lista todas las partes): el botón flotante, el panel, Mimo sabe la página, la conversación que sobrevive a la navegación y el chat web guardado 90 días.

## User Capabilities

**One Mimo, a companion on every page** (decision D-023, 2026-10-09). The advisor is no longer a page: Mimo lives in a floating button and a panel that opens over whatever the user is looking at.

- **Floating button** (`MimoButton`, `data-testid="mimo-button"`): a terracotta circle with the Mimoia spoon (the logo, the same symbol as the app icon, the favicon and the WhatsApp profile photo) on every signed-in page. **Inside the chat Mimo has its own face** (D-058, PRO-137): `MimoAvatar`, the spoon upright with two eyes, a smile and the heart as a cheek, cream on a forest circle, in the panel header (40 px) and beside each of Mimo's bubbles (28 px; not beside the user's). Test: `e2e/mimo-companion.spec.ts` (avatar in the panel, the button keeps the logo) and `e2e/brand.spec.ts`. It is hidden on login, register, reset, onboarding, invites and public pages (`mimoHiddenOn`), and while a sheet is open or the keyboard is up (PRO-122, `useFloatingButtonsHidden`, see [design-system.md](./design-system.md)). It stays clear of fixed bars:
  - default: above the 60 px bottom tab bar on mobile; bottom-right, 24 px from the edges, at `md+`;
  - recipe detail (`/recipes/<id>`): above the 84 px sticky action bar until `lg`;
  - cook mode: `z-110`, above the step controls.
- **Panel** (`MimoPanel`, `data-testid="mimo-panel"`):
  - Phones and tablets (< `lg`): a bottom sheet, 88dvh, over a backdrop (tap the backdrop to close).
  - Desktop (`lg+`): a 400 px right column with no backdrop. The page moves aside: `<main>` gets `padding-right: var(--mimo-panel-width)`, set by `MimoProvider` while the panel is open.
  - Header: «Mimo» and a status line («Escribe o habla», «Te escucho…», «Un momento…», «Pensando…», «Hablando… (toca para parar)», «Manos libres»). Buttons: read-aloud toggle, «Empezar de nuevo» (clears the conversation), «Cerrar». Esc also closes.
  - **Options as buttons** (2026-11-24): when Mimo ends a question with its `[[opciones: Comida | Cena]]` line, the panel never shows the line: the options (up to 6) are buttons under Mimo's **last** message (`data-testid="mimo-option"`), and tapping one sends it as the user's answer. They go away once answered or while Mimo is thinking. Read aloud, the question goes without the line. Until then the web showed the line as written (WhatsApp already turned it into reply buttons). `lib/mimoOptions.ts`; tests `mimoOptions.test.ts`, e2e `mimo-options.spec.ts`.
  - A «Voz» picker shows when the API offers several ElevenLabs voices; picking one plays a short preview and is remembered on the device.
  - Empty state: «Soy Mimo. Pregúntame lo que quieras…» with suggestions that depend on the page: cook mode («Siguiente paso», «Pon un temporizador de 10 minutos»…), recipe («¿Puedo hacerla sin horno?», «Adáptala para 4 personas»…), menu («¿Qué toca cocinar hoy?», «Cambia la cena del jueves»…), shopping («Añade leche a la lista», «Hazme la compra»…), or the default set.
  - Composer: «Manos libres» toggle, text input («Escribe a Mimo…»), mic button (tap to talk; tap again to stop and send), send button. While Mimo speaks, a «Parar» link stops it.
  - AI disclosure line under the composer (`data-testid="ai-disclosure"`).
  - **Recipes link to their page (PRO-85, 2026-10-15).** When a reply is about today's menu, the week or one recipe, the recipes come with the turn's `data` (`get_todays_menu` → `day`, a week → `days[]`, `get_recipe_details` → `{ id, name }`, or `{ recipeId, recipeName }`). The first whole-word mention of each recipe's name in Mimo's text (any case; the longer name wins) is a terracotta link to `/recipes/<id>` (`data-testid="mimo-recipe-link"`); tapping it opens the recipe and closes the panel. Notes («cenamos fuera») have no page and never link. If the model writes the dish differently from its recipe name, it stays plain text. The links are kept with the conversation (sessionStorage), not sent back as history.
- **Mimo knows the page.** Each turn sends the current path; Mimo understands «esta receta», «siguiente» or «este menú» (see Page context below).
- **The conversation survives navigation** within the tab (sessionStorage), so users can open Mimo on the menu, go to a recipe and keep talking.
- **Pages refresh after Mimo acts.** When a reply changed something (`actionTaken`), every react-query query is invalidated, so the menu, list or recipe behind the panel shows the change.
- **Old links:** `/advisor` is a client redirect to `/menu?mimo=1`; `?mimo=1` on any page opens the panel.
- **A message started for you** (PRO-318): a page can open Mimo with the first words already in the box (`useMimo().open({ draft })`): «Tu ficha» uses it for «Añadir algo que deba saber» («Recuerda que en casa »), «Cuéntale a Mimo cómo coméis» and «¿Algo no cuadra? Dímelo». Nothing is sent until the person finishes it and taps send; the input gets the focus with the cursor at the end.
- There is no «Asesor» tab any more: the bottom tab bar and the desktop sidebar have 4 entries (see [Design System](./design-system.md)).

## Web chat kept 90 days (PRO-148, D-064)

- Every web turn of `POST /assistant/:userId/chat` (modes `text`, `voice`, `onboarding`) leaves **two rows** in `chat_messages`: the user's own words (without the hidden «Pantalla actual» note; `meta: { mode, path }`) and Mimo's reply with what it did (`meta: { mode, tools, corrections, toolTrace, ms }`, the same trace `whatsapp_messages.meta` keeps). Each row carries the user, their household (`primary_household_id` at that moment) and `channel = 'web'`.
- The route writes them after the model answers (`recordWebChatTurn`, `services/chatMessages.ts`); a failed write is logged and the user still gets the reply. Requests rejected before the model (403, 400, 429 budget) store nothing. The engine is untouched: the trace comes from the engine's response.
- Purpose: the household profile («ficha viva», D-064) learns from the web chat as it already does from WhatsApp, and (D-189, 2026-11-19) the daily conversation reviewer reads the day's web turns with WhatsApp's ([WhatsApp](./whatsapp.md) «Conversation reviewer agent»). Nothing reads the rows back into the chat: the panel keeps using sessionStorage, and a new tab still starts empty.
- Retention: the scheduler tick deletes rows older than **90 days** once a day (`purgeOldChatMessagesIfDue`, `CHAT_RETENTION_DAYS`). Deleting the account deletes them (FK cascade on `user_id`); if a household is deleted while its member stays, the rows stay with `household_id = NULL`.
- Tests: `apps/api/src/tests/chatMessages.test.ts` (rows + route, engine faked) and `chatMessages.smoke.ts` (purge 91 vs 89 days, account deletion, real Postgres).
- Source: [apps/api/src/services/chatMessages.ts](../apps/api/src/services/chatMessages.ts), table `chat_messages` in [schema.ts](../apps/api/src/db/schema.ts) (migration `0055_chat_messages`), purge call in [notificationScheduler.ts](../apps/api/src/services/notificationScheduler.ts).
