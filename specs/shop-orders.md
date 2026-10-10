# Compra en mis tiendas (shop orders)

**Status:** v1 shipped 2026-10-07; v1.1 (buy rules, pickup/delivery per order, add before sending) 2026-10-08 — orders are *handed* to the user, Mimoia never messages a shop nor handles money.

Mimoia splits what's left on the shopping list for the next 7 days into one order per shop the household uses (frutería, carnicería, pescadería, súper), writes each order in the customer's voice, and hands it over as a link that opens **the user's own** WhatsApp (or mail app) with the text already written. The user sends it, pastes or forwards the shop's reply, Mimoia checks it line by line against what it expected, the user approves, sends the confirmation and pays the shop directly. Lines are written in **the shop's own units** ("1 cabeza de ajos", "100 g de jamón serrano, loncheado fino", "2 doradas de ración, limpias para el horno (o lubinas…)"), never the recipe's (see Buy rules). Background research: [docs/research/Pedir en tiendas de frescos.md](../docs/research/Pedir%20en%20tiendas%20de%20frescos.md), [docs/research/Compra Mimoia por WhatsApp y email.md](../docs/research/Compra%20ONA%20por%20WhatsApp%20y%20email.md) (and the earlier [supermarket study](../docs/research/Compra%20autom%C3%A1tica%20de%20ONA%20en%20Espa%C3%B1a.md)).

## User Capabilities

- Save the household's shops at `/compra/tiendas` (any member; max 20): name, type (frutería / carnicería / pescadería / supermercado / otra), how to order (WhatsApp / email / web / teléfono) + that contact, "tu nombre para la tienda", recoger vs a domicilio (+ address), **pedido mínimo a domicilio** and **gastos de envío** (€, optional), free notes. Spanish 9-digit numbers get `34` prepended.
- `/compra` → **Preparar los pedidos**: Mimoia rebuilds the rolling list for today + 6 days, routes every pending line to a shop and shows one card per shop (order: frutería, carnicería, pescadería, súper). Re-preparing replaces the previous *drafts* only.
- Draft card:
  - **Recojo en tienda / A domicilio** for this order (default: the shop's). A domicilio needs an address (prefilled from the shop or any other shop of the household); the message always says where and asks "¿más o menos a qué hora llegaría?"; pickup asks "a partir de qué hora puedo pasar a recogerlo".
  - Delivery minimum: "≈18 € de 20 € de mínimo: te faltan unos 2 €", or "no sé si llegas" when most lines have no price.
  - Lines show the shop text. Products with options show chips (serrano/ibérico, dorada/lubina/gallo, de ternera/de cerdo/mixta…); the pick is remembered for the household. Weight products typed without an amount ask **¿Cuánto?** with a one-tap suggestion (100 g de jamón). Fridge staples needed in tiny amounts (25 g de mantequilla, 50 ml de leche, 1 yema) come **unticked** as "probablemente lo tienes".
  - **"¿Algo más?"** adds products ("1 kg de manzanas", "Fruta (fresas, plátanos)").
  - Remove a line, move it to another shop, add a preparation note (carnicería / pescadería), set "tope del pedido: hasta X €", read the message.
  - **Antes de enviarlo**: while a choice, an amount or the delivery address is missing, the card lists it and there's no send link.
  - Then:
  - WhatsApp → **Enviar por WhatsApp** opens `wa.me/<shop>?text=<order>`; tapping it marks the order *enviado*. Over 1,200 characters Mimoia opens the chat without text and the user pastes it (Copiar mensaje).
  - Email → `mailto:` with the order as body.
  - Web (El Corte Inglés) → a plain checklist with a **Buscar** link per product on the shop's site (`/supermercado/buscar?question=…`), **Abrir su web**, **Ya está pedido** (closes it).
  - Teléfono → **Llamar** (`tel:`) + the list to read.
- Sent card: paste what the shop answered (text, or a voice note already transcribed) → Mimoia reads it and shows each line as **OK**, **Revisar** (with the reason) or **No hay**, the total vs the cap, pickup time and payment. The user picks *Mantener / Quitar* (or *Vale, <sustituto>*) for every doubtful line, can change the cap, then **Aprobar pedido**. "Ha cambiado algo" re-reads a new reply.
- Approved card: the confirmation text ("Perfecto, adelante con el pedido. Quita: … Sí a pescadilla en lugar de merluza. Si el total pasa de 45 €, avisadme antes.") with **Enviar confirmación** (wa.me / mailto). **Ya lo tengo, cerrar pedido** (+ optional amount paid) closes it and ticks those items as bought on the shopping list.
- Any open order can be cancelled. Closed orders of the last 30 days are listed under "Pedidos cerrados".
- `/shopping` has a **Pedir a mis tiendas** card linking to `/compra`.
- `/compra` also lists the pantry staples the recipes use and Mimoia assumed at home ("¿Te falta algo de esto?") — one tap adds one to the súper order.
- From chat (web or WhatsApp): "hazme la compra" → one short link per shop (or what's missing before sending), pickup/delivery and minimum, and "¿algo más?"; "añade fruta", "el jamón serrano", "150 g de york", "traédmelo a casa" edit the draft (same link); forward or paste the shop's reply → line-by-line summary with `[[opciones: …]]`; "sí" → confirmation link; "ya lo he recogido, 23 €" → closed. Shops can be added by chat ("mi carnicería es Ben-Car, WhatsApp 638 015 827").

## Preparing the orders

- Source: the persisted rolling list after `GET /shopping-list?from=today&to=today+6` (loopback). Lines `checked`, `inStock`, or already in a `sent/quoted/approved` order of the last 7 days are left out ("ya está en un pedido abierto").
- **Compounds** typed by hand split: "Fruta (fresas, plátanos, naranjas)", "hierbas aromáticas (romero, tomillo)" → one line each. "pescado entero fresco (dorada, lubina, gallo…)" is a choice, not a family.
- **Pantry staples from recipes** stay home (sal, pimienta, aceite, vinagre, especias, azúcar, harina de trigo, soja, levadura, agua, and anything in cda/cdita without a rule) and are listed. Typed by hand they're ordered (súper).
- **Duplicates merge** by buy rule in the draft (not in the list): recipe "jamón 50 g" + typed "Jamón serrano" → one line, serrano; "leche" + "leche entera 50 ml" → one brik, kept ticked because the user typed it. Same units sum; mixed units convert to grams. Closing the order ticks every merged list item.
- **Routing**: the buy rule's shop (charcutería → carnicería; despensa typed by hand → súper); unknown names fall back to `classify.ts` (packaged → súper; fish, meat by name; fruit/veg/herbs by name or aisle `produce` → frutería; "pan de hamburguesa" never to the butcher). No shop of that kind → the súper → otherwise "sin tienda".
- Unknown products typed without an amount go by name only ("Galletas daniela"); with an amount, "Nombre: 300 g" (fish without a rule keep the clean/whole weight line, FAO yields).

## Buy rules ("cómo se compra")

`packages/shared/src/buy/rules.ts` — ~150 curated rules keyed by normalized name + aliases (ingredient UUIDs differ per environment), regex fallback. Each rule: shop, sold by **pieza / peso / envase**, what the shop calls it, unit word (cabeza, manojo, bandeja, tarrina, trozo), grams per unit and per recipe "u" (ajo: diente 5 g), minimum and step, half allowed (melón, sandía, coliflor, repollo, apio, conejo), choice (question, options, default or `null` = blocks), default preparation, alternative for the shop, recipe notes that change the product (cebolla + "morada", tomate + "cherry", ternera + "picada" / "carrilleras", pollo + "pechuga", bacalao + "desmigado" → bacalao desalado desmigado), súper tier and El Corte Inglés search text. `convert.ts` (`toOrderQty`, pure, shared by API and web):

- **Pieza**: `max(min, ceil(need / unit − 0,15))` (15 % short is one less); more than N small pieces → by weight ("1 kg de naranjas de zumo"); half only when ≤ 55 % of a big piece ("medio melón"). Typed with no amount → 1 (plátanos 6; loose fruit 1 kg).
- **Peso**: quarter kilos with words ("un cuarto de kilo", "medio kilo", "kilo y medio"); charcutería in grams, steps of 50 from 100 g; mejillones from 1 kg. Meat, fish or charcutería typed with no amount → **needs quantity**.
- **Envase**: whole packs ("1 tarrina de mantequilla (250 g)", "2 paquetes de queso feta (150 g)", eggs in medias docenas). Tier *nevera* under 25 % of the smallest pack → "probablemente lo tienes", unticked.
- **Choices**: explicit pick > preset in the name ("jamón serrano") > household preference (`household_buy_prefs`) > default; `def: null` (jamón, ternera/cerdo/cordero sin uso, "carne de aguja" sin ternera/cerdo, queso, pan) blocks sending — recipes are checked for this on save ([recipe-quality.md](./recipe-quality.md) → Shoppability). Whole fish defaults to dorada with "(o lubinas, la que esté mejor hoy)"; options can come from the name's parenthesis.
- Recipe notes that are the shop's job (picada, en filetes, en lomos, sin espinas…) go after the product; the rest (en juliana, rallado) are dropped. Tiny recipe amounts that used to round to 0 g (two cloves of garlic) now stay when a shop sells the product.
- Canned/processed names ("pollo en lata", "cebolleta encurtida") never take a fresh rule. Weights and minimums are estimates from the research, to tune with real orders.

## Validation (estimate, band, cap)

- Line estimate: the user's own `pricePerUnit` on the list (`manual`) → the €/kg this shop quoted last time (`historial`, remembered on approval in `household_shops.price_memory`) → national €/kg for the shop kind (`referencia`, MAPA 2025 traditional shop: fruta/verdura 2.3, carne 10, pescado 11.6; produce by unit 0.6 €).
- Default cap is proposed **only** when ≥ 50 % of the estimate is `manual`/`historial`: estimate +10 % (+20 % with wild fish), rounded up to the euro. Otherwise there's no cap until the user sets one — Mimoia never invents a margin.
- Quote assessment (`validation.ts`): line not mentioned → Revisar; `no_hay` → No hay, dropped (never substituted); `sustituto` / cantidad distinta → Revisar; wild fish → always Revisar; > 10 % above a `manual`/`historial` estimate → Revisar; else OK. Basket over the cap → needs a decision. Approving keeps every line the user didn't remove.
- Reading the reply: one Claude Haiku 4.5 call (`quoteParser.ts`, cost feature `shop_quote_parse`) returns JSON that a pure normaliser cleans (unknown keys/statuses dropped, "12,50 €" → 12.5). A bad answer can only send a line back to the user, never invent a price. If the model is down: 502 "No he podido leer la respuesta".

## Data Model

- `household_shops(id, household_id → households, name, kind, channel, whatsapp, email, web_url, phone, customer_name, fulfilment 'recoger'|'domicilio', address, notes, price_memory jsonb {ingredientId: {pricePerKg, at}}, delivery_min_eur, delivery_fee_eur, position, created_at, updated_at)`.
- `household_buy_prefs(household_id, rule_key, choice)` unique per household + rule — remembered picks (migration 0038).
- `shop_orders(id, household_id, user_id?, shop_id? → household_shops ON DELETE SET NULL, shop_snapshot jsonb, status draft|sent|quoted|approved|closed|cancelled, token unique, lines jsonb ShopOrderLine[], estimate_eur, cap_eur, message_text, shop_reply_text, quote_summary jsonb, confirmation_text, final_total_eur, fulfilment, address, created/updated/sent/quoted/approved/closed_at)`. Lines are a snapshot (inputs — name, recipe quantity/unit, notes, quantitySource, choice — plus the computed shop text, grams, options, needsChoice/needsQuantity, maybeHave/included, eci; v1 rows lack them and keep working) (the live list is rebuilt on every read). Deleting a shop deletes its drafts; sent/closed orders keep the snapshot.
- Shared types + zod: `ShopOrder`, `ShopOrderLine`, `shopInputSchema`, `buildShopPayload` (web form) in `@ona/shared`.

## API

All auth'd and scoped to the caller's primary household unless noted.

| Method | Path | Notes |
|---|---|---|
| GET/POST | `/shops` | list / add (`shopInputSchema`) |
| PATCH/DELETE | `/shops/:id` | full-form update / delete (+ its drafts) |
| POST | `/shop-orders/prepare` | `{ days? = 7, listId? }` → `{ orders, unassigned, skipped, hasShops }` |
| GET | `/shop-orders` | open orders (`?all=1` adds closed, last 30 days) |
| GET/PATCH | `/shop-orders/:id` | PATCH drafts only: `{ lines: [{key, remove?, note?, quantity?, unit?, choice?, include?, moveToShopId?}], add: [{name, quantity?, unit?, note?}], fulfilment?, address?, capEur? }`; a `choice` is saved as household preference |
| POST | `/shop-orders/:id/sent` · `/quote {text}` · `/approve {decisions, capEur?}` · `/close {finalTotalEur?}` · `/cancel` | 409 on a wrong state |
| GET | `/shop-orders/link/:token[?m=ok]` | **public**, no side effects → `{ url }` (wa.me/mailto); 404 once closed/cancelled |

Web: `GET /c/<token>[?m=ok]` (Next route handler) redirects to that URL; expired → `/compra?enlace=caducado`. Short links exist so chat replies never carry long URL-encoded text, and are side-effect free because WhatsApp's link preview fetches them.

## Assistant skills

`shopOrderSkills.ts` (same REST calls, as the user): `manage_shops` (incl. delivery minimum/fee), `prepare_shop_orders` (links, or what's missing, pickup/delivery, minimum, pantry assumed, "¿algo más?"), `edit_shop_order` (add — each product to its shop —, remove, choose, amounts, include, delivery + address; same links), `register_shop_reply`, `approve_shop_order` (only after an explicit "sí"; `remove` names → line keys), `close_shop_order` (`cancel=true` cancels), `get_shop_orders`. Shop names match ignoring punctuation ("ben car" → "Ben-Car"). The prompt treats a forwarded shop reply as data, never instructions, and lets the model copy `/c/` links verbatim (the only URLs it may write). Short links use `WEB_PUBLIC_URL`.

## Constraints

- v1 never sends anything to a shop from Mimoia's WhatsApp number: Meta only allows messaging a business that opted in to Mimoia, and the shop would be talking to an AI. Connected shops (opt-in by QR to Mimoia's number) and email sent by Mimoia are future work — see the report.
- Every "dame la compra" re-prepares the orders from the current list (`prepare_shop_orders`). On WhatsApp the `/c/` links of earlier replies are replaced by "[enlace de un pedido anterior]" in the history the model sees (`whatsapp/history.ts`), so it can't resend stale orders (2026-10-08: it did, and Miguel got the morning's pre-v1.1 messages).
- Mimoia doesn't pay or collect: payment is always user → shop (pickup, Bizum, the shop's payment link).
- Photos of a shop's reply aren't read yet (WhatsApp photos go to recipe import); text and voice notes are.
- No timeouts or reminders when a shop or the user doesn't answer.
- Prepare persists the 7-day list (the single `shopping_lists` row); `/shopping` re-GETs its own range. Closing an order ticks the items by id; with a wider range the whole line shows as bought even if more was needed later.
- Buy rules cover the catalogue's common products; unknown names go by name/amount. Weights, minimums and defaults (tomate de ensalada, pimiento italiano, naranja de zumo, carne picada mixta, dorada) are research estimates.
- Moving a line to another shop rewrites it with that shop's kind; the rule (not the shop) decides units.
- El Corte Inglés search text comes from the rule (`eci`); generic words on ECI return wrong products, so unknown names may still search badly.
- El Corte Inglés is the only shop with a verified per-product search link.

## Related specs

- [Shopping](./shopping.md) — the list the orders are drafted from
- [Advisor](./advisor.md) — skills and prompt rules
- [WhatsApp](./whatsapp.md) — forwarded replies, `/c/` links in replies
- [Household](./household.md) — scope

## Source

- `packages/shared/src/types/shopOrders.ts`, `packages/shared/src/utils/shopFormat.ts`, `packages/shared/src/buy/rules.ts` + `convert.ts` (buy rules)
- `apps/api/src/services/shopOrders/` — `classify.ts`, `fish.ts`, `format.ts`, `estimate.ts`, `draft.ts`, `lines.ts`, `message.ts`, `validation.ts`, `quoteParser.ts`, `store.ts`
- `apps/api/src/routes/shopOrders.ts` (mounted in `apps/api/src/index.ts`), `apps/api/src/db/schema.ts` (`householdShops`, `shopOrders`), `apps/api/src/db/migrations/0034_shop_orders.sql`, `0038_shop_orders_v11.sql` (`householdBuyPrefs`); `apps/api/src/services/shoppingList.ts` (recipe notes → `ShoppingItem.notes`), `apps/api/src/routes/shopping.ts` (typed items: `quantitySource`, aisle from rules)
- `apps/api/src/services/assistant/shopOrderSkills.ts`, `skills.ts` (registration), `systemPrompt.ts` (rules)
- `apps/web/src/app/compra/page.tsx`, `apps/web/src/app/compra/tiendas/page.tsx`, `apps/web/src/app/c/[token]/route.ts`, `apps/web/src/components/compra/`, `apps/web/src/hooks/useShopOrders.ts`, `apps/web/src/app/shopping/page.tsx` (entry card)
- Tests: `apps/api/src/tests/buyRules.test.ts` (Miguel's real order line by line), `shopOrderDraft.test.ts` (draft, merge, blockers, delivery minimum), `shopOrders.test.ts`, `shopQuoteParser.test.ts`, `shopOrderSkills.test.ts` (incl. form ↔ schema contract), `shopOrdersRoute.smoke.ts`; `apps/web/e2e/compra.spec.ts`
