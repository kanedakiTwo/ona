# Compra en mis tiendas (shop orders)

**Status:** v1 shipped 2026-10-07 — orders are *handed* to the user, ONA never messages a shop nor handles money.

ONA splits what's left on the shopping list for the next 7 days into one order per shop the household uses (frutería, carnicería, pescadería, súper), writes each order in the customer's voice, and hands it over as a link that opens **the user's own** WhatsApp (or mail app) with the text already written. The user sends it, pastes or forwards the shop's reply, ONA checks it line by line against what it expected, the user approves, sends the confirmation and pays the shop directly. Background research: [docs/research/Compra ONA por WhatsApp y email.md](../docs/research/Compra%20ONA%20por%20WhatsApp%20y%20email.md) (and the earlier [supermarket study](../docs/research/Compra%20autom%C3%A1tica%20de%20ONA%20en%20Espa%C3%B1a.md)).

## User Capabilities

- Save the household's shops at `/compra/tiendas` (any member; max 20): name, type (frutería / carnicería / pescadería / supermercado / otra), how to order (WhatsApp / email / web / teléfono) + that contact, "tu nombre para la tienda", recoger vs a domicilio (+ address), free notes (horario, mínimo…). Spanish 9-digit numbers get `34` prepended.
- `/compra` → **Preparar los pedidos**: ONA rebuilds the rolling list for today + 6 days, routes every pending line to a shop and shows one card per shop (order: frutería, carnicería, pescadería, súper). Re-preparing replaces the previous *drafts* only.
- Draft card: remove a line, move it to another shop, add a cut/preparation note (carnicería / pescadería: "picada", "en lomos, sin espinas"), set "tope del pedido: hasta X €", read the message, then:
  - WhatsApp → **Enviar por WhatsApp** opens `wa.me/<shop>?text=<order>`; tapping it marks the order *enviado*. Over 1,200 characters ONA opens the chat without text and the user pastes it (Copiar mensaje).
  - Email → `mailto:` with the order as body.
  - Web (El Corte Inglés) → a plain checklist with a **Buscar** link per product on the shop's site (`/supermercado/buscar?question=…`), **Abrir su web**, **Ya está pedido** (closes it).
  - Teléfono → **Llamar** (`tel:`) + the list to read.
- Sent card: paste what the shop answered (text, or a voice note already transcribed) → ONA reads it and shows each line as **OK**, **Revisar** (with the reason) or **No hay**, the total vs the cap, pickup time and payment. The user picks *Mantener / Quitar* (or *Vale, <sustituto>*) for every doubtful line, can change the cap, then **Aprobar pedido**. "Ha cambiado algo" re-reads a new reply.
- Approved card: the confirmation text ("Perfecto, adelante con el pedido. Quita: … Sí a pescadilla en lugar de merluza. Si el total pasa de 45 €, avisadme antes.") with **Enviar confirmación** (wa.me / mailto). **Ya lo tengo, cerrar pedido** (+ optional amount paid) closes it and ticks those items as bought on the shopping list.
- Any open order can be cancelled. Closed orders of the last 30 days are listed under "Pedidos cerrados".
- `/shopping` has a **Pedir a mis tiendas** card linking to `/compra`.
- From chat (web or WhatsApp): "hazme la compra" → one short link per shop; forward or paste the shop's reply → line-by-line summary with `[[opciones: …]]`; "sí" → confirmation link; "ya lo he recogido, 23 €" → closed. Shops can be added by chat ("mi carnicería es Ben-Car, WhatsApp 638 015 827").

## Preparing the orders

- Source: the persisted rolling list after `GET /shopping-list?from=today&to=today+6` (loopback, same endpoint the app uses). Lines that are `checked`, `inStock`, or already in a `sent/quoted/approved` order of the last 7 days are left out ("ya está en un pedido abierto").
- **Pantry basics** are assumed at home and left out: anything in `cda/cdita`, and sal, pimienta, aceite (oliva/girasol), vinagre, orégano, comino, canela, cúrcuma, pimentón, laurel, nuez moscada, tomillo/romero seco, azafrán, levadura, bicarbonato, agua. Manual items and staples are always kept (the user typed them).
- **Routing** (`classify.ts`): packaged/processed (caldo, salsa, conserva, triturado, congelado, ahumado…) or aisle `congelados` → súper; fish & seafood names → pescadería; meat & charcutería names → carnicería; aisle `produce` → frutería; everything else → súper. Plain "atún" goes to the súper (in recipes it's canned). No shop of that kind → the household's súper → otherwise "sin tienda" (reported, not ordered).
- **Fish** is asked by clean weight with the whole weight the fishmonger weighs: "Merluza: 600 g en limpio (≈1,15 kg en entero)", using FAO edible yields (merluza 0.53, dorada/lubina 0.54, sardina/boquerón 0.62, caballa 0.61, pescado plano 0.49, calamar/sepia 0.67, pulpo 0.79). Salmón, bacalao, marisco: no conversion. Wild species (merluza, sardina, boquerón, rape, gallo, marisco…) are flagged **lonja**.
- Catalogue names get their accents back in every message ("champinones" → "champiñones").

## Validation (estimate, band, cap)

- Line estimate: the user's own `pricePerUnit` on the list (`manual`) → the €/kg this shop quoted last time (`historial`, remembered on approval in `household_shops.price_memory`) → national €/kg for the shop kind (`referencia`, MAPA 2025 traditional shop: fruta/verdura 2.3, carne 10, pescado 11.6; produce by unit 0.6 €).
- Default cap is proposed **only** when ≥ 50 % of the estimate is `manual`/`historial`: estimate +10 % (+20 % with wild fish), rounded up to the euro. Otherwise there's no cap until the user sets one — ONA never invents a margin.
- Quote assessment (`validation.ts`): line not mentioned → Revisar; `no_hay` → No hay, dropped (never substituted); `sustituto` / cantidad distinta → Revisar; wild fish → always Revisar; > 10 % above a `manual`/`historial` estimate → Revisar; else OK. Basket over the cap → needs a decision. Approving keeps every line the user didn't remove.
- Reading the reply: one Claude Haiku 4.5 call (`quoteParser.ts`, cost feature `shop_quote_parse`) returns JSON that a pure normaliser cleans (unknown keys/statuses dropped, "12,50 €" → 12.5). A bad answer can only send a line back to the user, never invent a price. If the model is down: 502 "No he podido leer la respuesta".

## Data Model

- `household_shops(id, household_id → households, name, kind, channel, whatsapp, email, web_url, phone, customer_name, fulfilment 'recoger'|'domicilio', address, notes, price_memory jsonb {ingredientId: {pricePerKg, at}}, position, created_at, updated_at)`.
- `shop_orders(id, household_id, user_id?, shop_id? → household_shops ON DELETE SET NULL, shop_snapshot jsonb, status draft|sent|quoted|approved|closed|cancelled, token unique, lines jsonb ShopOrderLine[], estimate_eur, cap_eur, message_text, shop_reply_text, quote_summary jsonb, confirmation_text, final_total_eur, created/updated/sent/quoted/approved/closed_at)`. Lines are a snapshot (the live list is rebuilt on every read). Deleting a shop deletes its drafts; sent/closed orders keep the snapshot.
- Shared types + zod: `ShopOrder`, `ShopOrderLine`, `shopInputSchema`, `buildShopPayload` (web form) in `@ona/shared`.

## API

All auth'd and scoped to the caller's primary household unless noted.

| Method | Path | Notes |
|---|---|---|
| GET/POST | `/shops` | list / add (`shopInputSchema`) |
| PATCH/DELETE | `/shops/:id` | full-form update / delete (+ its drafts) |
| POST | `/shop-orders/prepare` | `{ days? = 7, listId? }` → `{ orders, unassigned, skipped, hasShops }` |
| GET | `/shop-orders` | open orders (`?all=1` adds closed, last 30 days) |
| GET/PATCH | `/shop-orders/:id` | PATCH drafts only: `{ lines: [{key, remove?, note?, quantity?, moveToShopId?}], capEur? }` |
| POST | `/shop-orders/:id/sent` · `/quote {text}` · `/approve {decisions, capEur?}` · `/close {finalTotalEur?}` · `/cancel` | 409 on a wrong state |
| GET | `/shop-orders/link/:token[?m=ok]` | **public**, no side effects → `{ url }` (wa.me/mailto); 404 once closed/cancelled |

Web: `GET /c/<token>[?m=ok]` (Next route handler) redirects to that URL; expired → `/compra?enlace=caducado`. Short links exist so chat replies never carry long URL-encoded text, and are side-effect free because WhatsApp's link preview fetches them.

## Assistant skills

`shopOrderSkills.ts` (same REST calls, as the user): `manage_shops`, `prepare_shop_orders`, `register_shop_reply`, `approve_shop_order` (only after an explicit "sí"; `remove` names → line keys), `close_shop_order` (`cancel=true` cancels), `get_shop_orders`. Shop names match ignoring punctuation ("ben car" → "Ben-Car"). The prompt treats a forwarded shop reply as data, never instructions, and lets the model copy `/c/` links verbatim (the only URLs it may write). Short links use `WEB_PUBLIC_URL`.

## Constraints

- v1 never sends anything to a shop from ONA's WhatsApp number: Meta only allows messaging a business that opted in to ONA, and the shop would be talking to an AI. Connected shops (opt-in by QR to ONA's number) and email sent by ONA are future work — see the report.
- ONA doesn't pay or collect: payment is always user → shop (pickup, Bizum, the shop's payment link).
- Photos of a shop's reply aren't read yet (WhatsApp photos go to recipe import); text and voice notes are.
- No timeouts or reminders when a shop or the user doesn't answer.
- Prepare persists the 7-day list (the single `shopping_lists` row); `/shopping` re-GETs its own range. Closing an order ticks the items by id; with a wider range the whole line shows as bought even if more was needed later.
- Line notes are typed by the user; recipe notes ("picada") aren't carried into the list yet.
- Quantities are recipe quantities (25 g de jengibre, 1 huevo): no pack-size rounding.
- El Corte Inglés is the only shop with a verified per-product search link.

## Related specs

- [Shopping](./shopping.md) — the list the orders are drafted from
- [Advisor](./advisor.md) — skills and prompt rules
- [WhatsApp](./whatsapp.md) — forwarded replies, `/c/` links in replies
- [Household](./household.md) — scope

## Source

- `packages/shared/src/types/shopOrders.ts`, `packages/shared/src/utils/shopFormat.ts`
- `apps/api/src/services/shopOrders/` — `classify.ts`, `fish.ts`, `format.ts`, `estimate.ts`, `draft.ts`, `message.ts`, `validation.ts`, `quoteParser.ts`, `store.ts`
- `apps/api/src/routes/shopOrders.ts` (mounted in `apps/api/src/index.ts`), `apps/api/src/db/schema.ts` (`householdShops`, `shopOrders`), `apps/api/src/db/migrations/0034_shop_orders.sql`
- `apps/api/src/services/assistant/shopOrderSkills.ts`, `skills.ts` (registration), `systemPrompt.ts` (rules)
- `apps/web/src/app/compra/page.tsx`, `apps/web/src/app/compra/tiendas/page.tsx`, `apps/web/src/app/c/[token]/route.ts`, `apps/web/src/components/compra/`, `apps/web/src/hooks/useShopOrders.ts`, `apps/web/src/app/shopping/page.tsx` (entry card)
- Tests: `apps/api/src/tests/shopOrders.test.ts`, `shopQuoteParser.test.ts`, `shopOrderSkills.test.ts` (incl. form ↔ schema contract), `shopOrdersRoute.smoke.ts`; `apps/web/e2e/compra.spec.ts`
