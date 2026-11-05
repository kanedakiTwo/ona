# Red de tiendas (en pruebas)

**Status:** tramo 1a, behind `RED_TIENDAS_EMAILS` (test accounts only). A household in the switch gets Red shops by its postal code, sees each Red order on /compra with the −5 % already applied, what's expected and the max, and presses «Pedir». Nothing is charged yet and the shop isn't told anything yet (both tramo 1b). Design and decision: ona-hq `docs/superpowers/specs/2026-11-03-red-tiendas-design.md` (D-165).

The Red is Mimoia's own shops (`red_shops`: frutería, carnicería, pescadería; never supermarkets). The household orders through Mimoia and the shop cedes a share of the products total, 10 % to start: a discount for the household, already applied (5 %), and Mimoia's commission (5 %). A Red shop enters the household as one more shop in `household_shops`, so splitting the list, moving lines, editing and drafts work as for any shop ([Compra en mis tiendas](./shop-orders.md)). A Red order is one with `red_shop_id` **and** `red_terms` (`isRedOrderRow`).

## User Capabilities

- **Which shop (constitución §7, «Las tiendas del hogar, primero»).**
  - The household's own shop of a kind always goes first (`pickShopForKind` puts own shops before Red copies).
  - A fresh kind whose lines fell back to the súper or to nothing (`DraftResult.fellBack`):
    - without a postal code → «¿Cuál es tu código postal?» on /compra (`households.postal_code`, 5 digits, province 01–52);
    - with a súper → asked once, «¿La fruta y la verdura, a <tienda> (−5 %) o las sigues pidiendo en <súper>?», and «En <súper>» is remembered (`households.red_choices`);
    - with no súper → the best Red shop is assigned on its own («Tu frutería: …, de la Red, con un 5 % menos», with «¿Prefieres otra?»);
    - no Red shop for that postal code → «Aún no hay frutería de la Red en tu código postal.»
  - Red shops are ranked by: 1. the same postal code; 2. delivering to it (`delivery_postal_codes`); 3. the longest in the Red. Never by what they leave (`services/red/assign.ts`).
- **How it enters the household.**
  - An assigned Red shop is a copy in `household_shops` (`origin = 'red'`, `red_shop_id`): one per household and kind (partial unique index; two «Preparar» at once upsert the same row). Pickup by default; it delivers only if the Red shop delivers to the household's postal code, and then carries its fee (0 = free) and minimum.
  - A copy can't be edited (409 `RED_SHOP`; no pencil on /compra/tiendas, which says «de la Red · −5 %»). It can be removed, and that is remembered in `red_choices` as «not the Red for this kind»: that kind is never assigned or asked again. A copy whose Red shop or delivery changes loses its drafts; another Red shop also clears its price memory.
  - The household's own shop with a Red shop's WhatsApp and kind is linked on the next «Preparar» (`red_shop_id`, origin stays `propia`, «en la Red · −5 %»), and any Red copy of that kind goes, drafts included. From then on its orders go through the Red, and the card says so. Changing that shop's WhatsApp or kind unlinks it (`keepsRedLink`); the next «Preparar» links it again if it still matches a Red shop.
  - A new postal code re-checks every copy: one whose shop doesn't cover it goes; the rest get that postal code's delivery, and their drafts go if the fee or the minimum changes.
- **The card** (`components/compra/RedOrderCard.tsx`; delivery, lines and blockers are the same parts as any draft, `DraftParts.tsx`, shared with `OrderCard`):
  - «−5 % ya descontado»; «Previsto» with the discount (+ «envío»);
  - pickup, or home delivery only if the shop delivers (a copy with a fee, or the household's own shop that joined; otherwise `fulfilment: domicilio` is 400 `NO_DELIVERY`);
  - the same line editing as any draft (move, amounts, «¿Algo más?»);
  - «Como mucho»: the household can raise it (`PATCH { maxEur }`, the field read by `redMaxBody`), never below the minimum, what's expected plus the fee up to the euro (400 `MAX_TOO_LOW`). Emptying it brings back the computed one, and so does changing the lines (anything but a note) or actually switching pickup ↔ delivery;
  - blockers on top of the usual ones: «Hay productos sin precio estimado: pon un máximo», delivery where it doesn't deliver, and under the delivery minimum;
  - «Pedir · como mucho X €» («En pruebas: todavía no se cobra nada.»), disabled while an edit of that order is on its way. Refused with 409 if the max isn't the one on the card (`MAX_CHANGED`); the Red's terms changed (`TERMS_CHANGED`: the draft gets the new ones and its max goes back to the computed one, so the next «Pedir» goes); it's blocked (`BLOCKED`) or has nothing included (`EMPTY`); or the Red shop is paused or gone (`RED_SHOP_UNAVAILABLE`);
  - ordered: «Pedido a <tienda>, como mucho X €. Te avisamos cuando lo acepte.»
- **States** (`services/red/states.ts`): `ordered`, `accepted`, `preparing`, `ready`, `payment_pending`, `charged`, `delivered`, `rejected` and `incident` on top of `draft` / `cancelled` / `closed`. Tramo 1a only goes `draft → ordered → cancelled`.
  - Lines in `ordered`…`payment_pending` are «ya está en un pedido abierto».
  - The household cancels in `draft`, `ordered` and `accepted` (`RED_HOUSEHOLD_CANCELLABLE` in `@ona/shared`, read by the API and the card); later, 409 «La tienda ya lo está preparando: para cancelarlo, habla con ella.»
  - Draft edits and cancels only write while the order is still in an allowed state (`updateInStatus`): an edit that lands after «Pedir» is 409. State errors name the state in Spanish: «No se puede editar (estado: Pedido).»
  - A Red order never goes the WhatsApp way: `/sent`, `/quote` (before any model call) and `/approve` are 409 `RED_ORDER`, and so is closing one by hand, draft included (a draft is cancelled or ordered).
- **Links and chat.**
  - A Red order has no wa.me. Its `/c/<token>` short link answers `/compra?pedido=<id>`, which the web route follows with a relative 302 (own page only); the card is highlighted and scrolled to once.
  - `prepare_shop_orders` gives that link («míralo y pídelo en la app») with the discount and the max, and nothing glued right after it (copied as is, a trailing «.» would break the token). It points to the app for the postal code; the once-asked choice and the held-back kinds are only told («puede elegir en la app»).
  - `register_shop_reply`, `approve_shop_order` and `close_shop_order` leave Red orders out; `close_shop_order` with `cancel` cancels one in `draft`, `ordered` or `accepted`.

## Constraints

- **The switch.** `RED_TIENDAS_EMAILS`: exact email or `@domain`, any case; empty = nobody (`services/red/flag.ts`, the same rule as the extension's switch, `services/emailAllowList.ts`). For everyone else nothing changes: no postal code question, no Red shops, same chat, and `GET /red/status` is `{ enabled: false, postalCode: null }`. The tool descriptions Mimo gets are the same for every household and never mention the Red: its guidance only travels in what `prepare_shop_orders` returns.
- **Switch off, or the Red step fails** (`draftableShops`). «Preparar» still works: Red copies get no draft at all (never a plain WhatsApp order to a Red shop's number), and an own shop linked to the Red works as the household's own shop, with wa.me and no Red fields.
- **The money** (`services/red/money.ts`, pure, in whole cents):
  - discount and commission are each a % of the products total at the shop's prices (before the discount, without the fee), rounded to the cent, half up; the household pays products − discount + fee;
  - margin per line over its estimate: 15 % only with the household's price (`manual`) or this shop's (`historial`), 30 % with anything else (national reference or no source), +10 points with wild fish;
  - «Como mucho» = Σ estimate × (1 + margin) over the lines (rounded to the cent once), minus the discount, plus the fee, rounded **up** to the euro; none while an included line has no estimate;
  - what the shop may reach under that max = (max − fee) / (1 − discount), rounded **down** to the cent, so the household never pays over it.
  - The numbers live in `red_settings` (one row); every order freezes the ones it was drafted with (`shop_orders.red_terms`).
- **Fase 1, halal and allergies.** A halal household never gets a carnicería on its own, and a household with any allergy gets neither a carnicería nor a pescadería. It can pick one, and is told the Red doesn't pass halal or allergies on yet. If the restrictions can't be read, the Red counts both.
- **Test shops.** `scripts/redTestShops.ts --cp 28001 [--reparte …]` (`services/red/testShops.ts`: made-up names, 600 000 09N numbers, `is_test`). A database that isn't local needs `--yes`; production never, not even with `--yes`. Test shops are never assigned, linked or orderable in production (`redShopUsable`, signal `RAILWAY_ENVIRONMENT_NAME === 'production'`). CI and `test-e2e.sh` seed them in 28001 and give the Red to `@red.test.local` only.
- **Not yet:** the card hold, the shop's link, timeouts and household notices (tramo 1b); sign-up, «Mi tienda» and Admin (tramo 2); real Stripe (tramo 3); WhatsApp to shops (tramo 4); invoices (tramo 5). `kb/sobre-mimoia.md` gets the Red when it opens to households (not behind a test switch).

## Known limitations

- «Preparar» racing «Pedir»: in a narrow window, re-preparing can leave a duplicate Red draft with the same lines next to the order just placed. Preparing again leaves those lines out.
- Re-preparing drops a raised max: the drafts keep lines, picks, delivery and address, but come back with the computed max.
- Fase 1 counts any allergen in the household's restrictions, a diet's too (vegetariano, vegano), so it may hold back a carnicería or pescadería it didn't need to.

## Data Model

Migration `0105_red_tiendas.sql`:

- `red_shops(id, name, kind fruteria|carniceria|pescaderia, postal_code, address, whatsapp unique, delivery_postal_codes text[] (empty = pickup only), delivery_min_eur, delivery_fee_eur, price_memory jsonb (written from tramo 1b), notes, status activa|pausada|baja, is_test, joined_at, created/updated_at)`;
- `red_settings`: one row (`id = 1`): `discount_pct`, `commission_pct`, `commission_vat_included`, `margin_known_pct`, `margin_reference_pct`, `margin_wild_fish_extra_pct`, `terms_version`;
- `households.postal_code` and `households.red_choices jsonb` (`{ fruteria: 'super' }`: asked once, or the Red copy removed);
- `household_shops.red_shop_id → red_shops ON DELETE SET NULL` and `origin propia|red`; unique `(household_id, kind)` where `origin = 'red'`;
- `shop_orders.red_shop_id`, `red_terms jsonb` (the `RedSettings` it was drafted with), `max_eur` (a raised max on a draft, null = computed; once ordered, the one accepted), `ordered_at`, `ordered_by_user_id → users`. `status` also takes the Red states.
- Shared types + zod in `packages/shared/src/types/red.ts`: `RedSettings`, `RedOrderView` (as `ShopOrder.red`), `RedPrepareInfo`, `RED_HOUSEHOLD_CANCELLABLE`, `postalCodeSchema`, `redChoiceSchema`, `placeRedOrderSchema`, `redMaxBody`.

## API

All auth'd. The Red's own routes:

| Method | Path | Notes |
|---|---|---|
| POST | `/shop-orders/:id/order` | «Pedir» a Red draft: `placeRedOrderSchema` `{ maxEur }` → the order, `ordered`. 403 `RED_OFF` outside the switch, 400 `NOT_RED`; 409 `MAX_CHANGED`, `TERMS_CHANGED`, `BLOCKED`, `EMPTY`, `RED_SHOP_UNAVAILABLE` |
| GET | `/red/status` | `{ enabled, postalCode, discountPct? }` (`discountPct` only when enabled) |
| PUT | `/red/postal-code` | 403 outside the switch; `postalCodeSchema` (400) → `{ postalCode }`; Red copies re-checked |
| POST | `/red/choice` | 403 outside the switch; `redChoiceSchema` `{ kind, choice: red\|super, redShopId? }` → `{ shops }`. `super` remembers it and drops the copy; `red` needs the postal code (400) and a shop that covers it (404), 400 at 20 shops, and forgets «al súper» |

What the Red adds to the [shop-order routes](./shop-orders.md#api): `POST /shop-orders/prepare` also returns `red` (`RedPrepareInfo`, `enabled: false` outside the switch); `GET /shop-orders` lists Red orders from `ordered` to `incident` (not `rejected`); `PATCH /shop-orders/:id` takes `maxEur` on a Red draft (400 `MAX_TOO_LOW`, null = computed) and refuses `fulfilment: domicilio` where the shop doesn't deliver (400 `NO_DELIVERY`); `/sent`, `/quote`, `/approve` and `/close` are 409 `RED_ORDER`, `/cancel` works in `draft`, `ordered` and `accepted`; `GET /shop-orders/link/:token` answers `/compra?pedido=<id>` (no `?m=ok`); `PATCH /shops/:id` on a copy is 409 `RED_SHOP`.

## Related specs

- [Compra en mis tiendas](./shop-orders.md) — the drafts, the card parts and the chat skills the Red reuses
- [Roles & Authorization](./roles.md) — the per-email switches
- [Household](./household.md) — scope and restrictions (halal, allergies)

## Source

- `packages/shared/src/types/red.ts`; `packages/shared/src/types/shopOrders.ts` (`ShopOrder.red`, the Red states)
- `apps/api/src/services/red/` — `flag.ts`, `money.ts`, `assign.ts`, `states.ts`, `view.ts`, `store.ts`, `prepare.ts`, `testShops.ts`; `apps/api/src/services/emailAllowList.ts`; `apps/api/src/config/env.ts` (`RED_TIENDAS_EMAILS`)
- `apps/api/src/routes/red.ts` (mounted in `index.ts`), `routes/shopOrders.ts` (`POST /shop-orders/:id/order`)
- `apps/api/src/services/shopOrders/store.ts` (`isRedOrderRow`, `placeRedOrder`, `updateInStatus`, `refuseRedInOldFlow`, `draftableShops`, `keepsRedLink`, the Red step in `prepareOrders`), `classify.ts` (`pickShopForKind`), `draft.ts` (`fellBack`); `apps/api/src/services/assistant/shopOrderSkills.ts`
- `apps/api/src/db/migrations/0105_red_tiendas.sql`; `apps/api/scripts/redTestShops.ts`
- `apps/web/src/hooks/useRed.ts`, `apps/web/src/components/compra/RedOrderCard.tsx`, `RedPrepareNotes.tsx`, `DraftParts.tsx` (shared with `OrderCard.tsx`), `apps/web/src/app/c/[token]/route.ts`
- Tests: `apps/api/src/tests/redMoney.test.ts`, `redAssign.test.ts`, `redStates.test.ts`, `redView.test.ts`, `redOrders.test.ts` (refusals, the max, `draftableShops`, `keepsRedLink`), `redStore.test.ts`, `redFlag.test.ts` (switch, schemas, `redMaxBody` ↔ `patchShopOrderSchema` contract), `redStatusRoute.test.ts`, `redTestShops.test.ts`, `shopOrderSkills.test.ts` (incl. the tool description never mentions the Red), `redOrders.smoke.ts` (real API and database: «Pedir», `TERMS_CHANGED`, `RED_SHOP_UNAVAILABLE`, no cancel once preparing, `NO_DELIVERY`, `/red/choice` 404, postal code dropping copies, unlinking an own shop); `apps/web/e2e/compra-red.spec.ts` (incl. the `/c/<token>` 302)
