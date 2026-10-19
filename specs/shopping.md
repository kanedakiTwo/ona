# Shopping

Weekly shopping list and pantry stock management. Aggregates ingredients across the menu's recipes, scales them for the household, and respects real units.

## User Capabilities

- Users can see a shopping list auto-generated from the current week's menu
- The list aggregates ingredients across all recipes in the week, summing quantities **per product** with proper unit handling: lines that are the same product join into one even when the catalogue has them under different names («Huevo 4 u» + «Huevos 6 u» + «Yema de huevo» → «Huevos 10 u»; the two olive oils; «Jamón cocido» + «Jamón de york»; «Limón» / «Limon»; «Salmón» + «Lomo de salmón sin piel») — see Aggregation (PRO-177)
- Tap water («agua», «agua del grifo», «agua caliente»…) and salt never show up as something to buy; «agua de coco» or «agua con gas» do
- **Coeliac household** (PRO-196, Miguel 2026-10-18): when the user's restrictions (profile + memory) include gluten, a menu row that is a cured meat whose gluten depends on the brand (chorizo, chistorra, morcilla, butifarra, salchicha, salchichón, fuet, longaniza, sobrasada, mortadela, salami, foie, paté, jamón de york/cocido, fiambre, embutido; not the cocido leftovers nor a stock) is asked for as «<name> sin gluten» («Chorizo oreado sin gluten»). Done in `GET /shopping-list` (and the legacy `/:menuId`) after the aggregation, so Mimo (`get_shopping_list`) and shop orders see the same name; staples and manual items keep the user's words, and the bought/«en casa» overlay is unaffected (`services/glutenFreeCharcuterie.ts`, `glutenFreeCharcuterie.test.ts`). The catalogue no longer tags those cured meats `gluten` (migration `0072_embutidos_sin_gluten.sql`), so a coeliac household gets lentejas con chorizo, fabada or cocido again; the «Sobras del cocido» keep the tag
- Users can check items off as they buy them (visual strikethrough, persisted)
- Users can mark items as already in their pantry (stock manager)
- **Change or leave out any line** (PRO-175, hogares de prueba 2026-10-15/17): tapping a line's name opens its sheet. A line that comes from the menu can get the household's own amount («Cantidad a comprar», in the line's unit; the row then reads «… · cambiada (menú: X)» and «Volver a lo del menú» undoes it) or be left out with **«No lo compro esta semana»**: it moves to a «Quitado de esta compra» section under the list with «Volver a añadir», and counts for nothing (not to buy, not in progress, total, shared text, WhatsApp summary, print or shop orders). Both survive reloads and other ranges (see Constraints). The same sheet asks **«¿Cuánto os queda en casa?»** (PRO-182, Dani y Sara 2026-10-16: «nos queda una cebolla y medio pimiento» marked the week's 7 onions «en casa»): «Comprar solo lo que falta» leaves the line pending for the rest («Te faltan 6 u · ya tienes 1»), as much as the line marks it «en casa», empty/0 clears it; Mimo does the same with `mark_in_stock` + `quantity`/`unit` (converted with the ingredient's density / unit weight). Amounts round as the partial state of PRO-199 (half a pepper doesn't save a whole one). A manual line takes any amount («2», or «2 paquetes» as written — no new unit) or «Quitar de la lista»; a staple points to Mis básicos. Mimo does the same (`remove_shopping_items`, `change_shopping_item_amount`, see [Advisor](./advisor.md))
- Items in stock are excluded from the active shopping list
- Users can switch between two tabs: "Por comprar" (shopping list) and "Ya en casa" (pantry)
- Users can see items grouped by aisle (produce, carnicería, lácteos, panadería, despensa…) for faster shopping; a single chip row under the header narrows the current tab to one aisle ("Todo" shows them all; only aisles with rows in that tab get a chip)
- The date range (today → end of next week by default) shows as the page eyebrow and as the first chip of that row; tapping it (or "···" → "Cambiar fechas") opens a sheet with "Desde" / "Hasta" and the "Esta + sig" reset. **‹ ›** on either side of that chip ("Semana anterior" / "Semana siguiente", mobile and desktop) move the whole range 7 days; "anterior" never goes before today and is disabled while the range starts today
- **Atajos de fecha** (PRO-33): right after the ‹ › arrows, three chips set the range in one tap — **«Hoy»** (from = to = today: only today's dishes; the date chip then reads «14 oct»), **«Mañana»** (from = to = tomorrow) and **«Esta semana»** (the default range, today → end of next week, same as the sheet's «Esta + sig»). The chip that matches the current range is marked (`aria-pressed`); after ‹ › or a custom range in the sheet none is. The arrows and the sheet work as before. On a phone (390 px) the row doesn't fit, so it slides sideways: the last chip always keeps a visible margin before the right edge, and the shortcut you tap slides fully into view (PRO-69). The € total card's title follows the shortcut: **«Total de hoy estimado»** with «Hoy», **«Total de mañana estimado»** with «Mañana», and «Total semanal estimado» with «Esta semana» or any other range (PRO-69, `totalTitle`). Logic in `apps/web/src/lib/shoppingRange.ts` (unit `shoppingQuickRange.test.ts`, e2e `shopping-quick-ranges.spec.ts` at 390×844)
- Users can export what's left to buy as plain text via the native share sheet (Web Share API), with clipboard fallback on browsers without `navigator.share` — "···" → "Compartir lo que queda"
- Check-item and stock-toggle mutations are queued offline (IndexedDB) and replay automatically when the device reconnects; an inline "Pendiente de sincronizar" Clock icon marks items still in the queue — see [PWA](./pwa.md)
- The page shows progress: "X/Y completados", "N% listo", "X comprados · Z en casa" with an ink progress bar. Each row counts once: a row bought and then marked "en casa" counts as en casa, so X never exceeds Y nor the % 100 (`shoppingProgress` in `@ona/shared`; it showed "72/56 · 129 %" before 2026-10-10)
- If no menu exists for the week, the page shows an empty state with a CTA to generate one
- Items carry their recipe notes (`notes`: "picada", "morada en juliana") and tiny buyable amounts no longer vanish (two cloves of garlic stay as a line when a shop sells garlic; pantry staples still drop). Items typed by hand with no amount are stored as 1 u with `quantitySource: 'default'` (the form starts empty) and get their aisle from the buy rules ("calabacín" → frutas y verduras). See [shop-orders.md](./shop-orders.md) → Buy rules.
- **Pedir a mis tiendas** ("···" sheet; also an outlined pill in the header at `lg+`) links to `/compra`, where Mimoia turns what's left for the next 7 days into one order per shop (frutería, carnicería, pescadería, súper) that the user sends from their own WhatsApp — see [Compra en mis tiendas](./shop-orders.md). Closing a shop order ticks its items as bought on this list.

## Item Model

Each item in `shopping_lists.items` (JSONB array) has:
- `id` — UUID
- `ingredientId` — links back to the global ingredient catalog (drives aisle grouping and unit conversions)
- `name` — display name
- `quantity` — aggregated number, in `unit`
- `unit` — `g | ml | u | cda | cdita`
- `aisle` — `produce | proteinas | lacteos | panaderia | despensa | congelados | otros`
- `mergedIngredientIds` — (menu items, optional) the other catalogue ingredients joined into this line because they are the same product (PRO-177)
- `checked` — boolean, user has bought this
- `inStock` — boolean, user already had this in pantry
- `haveQuantity` / `haveSource` — (menu items, optional) part already bought / at home (PRO-199)
- `skipped` — (menu items, optional) «No lo compro esta semana» (PRO-175)
- `menuQuantity` — (menu items, optional) what the menu asked when the household set its own amount in `quantity` (PRO-175)
- `amountText` — (manual items, optional) the amount in the household's words, «2 paquetes»; shown instead of quantity + unit, sent to shops as «Pañales (2 paquetes)» (PRO-175)

## Aggregation

`generateShoppingList` (server) walks every slot in `menu.days` and, for each recipe:

1. Looks up the user's household: `users.adults` (≥1, includes anyone over 10 years) and `users.kids_2_to_10` (children aged 2–10). Children under 2 don't count.
2. Computes the household multiplier as `adults + 0.5 × kidsCount`. For each slot the **effective diner count** is `slot.servings` if the user set a per-day override on the menu card (see [Menus](./menus.md#manual-slot-shaping-per-week-overrides)), otherwise this household multiplier.
3. Sums effective diner counts per recipe across the week (`sumDinersByRecipe`): two slots of the same recipe with overrides for 4 and 8 diners aggregate to 12. A household minimum (`recipe_notes.min_servings`, "siempre la cocino para al menos N") raises it to max(diners, N × times cooked); a slot with `variant: 'leftover'` is not another cooking. **Leftovers (táper, PRO-75)**: before summing, `withLeftoverBatches` resolves each leftover against its own week (so the rolling route runs it per menu before re-indexing days): if the source meal has «Solo hoy: N», N is what gets cooked, táper included, and the leftover adds nothing; if not, the leftover adds its own diners (the household's). Household of 1: lasaña «Solo hoy: 2» + sobras → 2; without «Solo hoy» → 2; household of 2 → 4 (`tests/leftoverBatches.test.ts`). Before, leftovers copied the source's «Solo hoy» and the list bought 2 + 2. Example (minimum): 2 people, lentejas twice a week with minimum 6 → buy for 12.
   - A dish with `variant: 'freezer'` («Del congelador», PRO-82) adds nothing and isn't a cooking: that táper was bought and cooked some other time, whatever week. Notes add nothing either. Pinned by `tests/freezerDish.test.ts` + `e2e/freezer-dish.spec.ts`.
4. Scaling factor per recipe: `aggregatedDiners / recipe.servings`
5. Applies the household's `recipe_notes.ingredient_overrides` for that recipe (see [Recipes](./recipes.md)) **before** scaling: `remove` drops the row, `modify` replaces quantity/unit, `add` appends a synthetic row whose `label` is resolved against the catalog by case-insensitive name match (unknown adds are skipped — the recipe detail still shows them)
6. For each surviving row, multiplies `quantity` by that factor
7. Skips ingredients tagged `optional: true` unless the user opts in (future toggle)
8. `pizca` and `al_gusto` are dropped from the list (not buyable)

Then the list aggregator (`aggregateScaledRows`, pure) drops what is never bought — exact names of the buy rules flagged `notBought`: tap water and salt (`isNotBought`) — and merges items by **product** (`shoppingGroupOf`, `packages/shared/src/buy/listGroup.ts`, PRO-177):

- Same catalogue ingredient → one product, as before.
- Names that are *exactly* the same buy rule (plus harmless words like «fresco», «sin piel») and the same preset choice → one product: «huevo», «huevos», «yema de huevo», «clara»; «aceite de oliva virgen» and «virgen extra»; «jamón cocido» and «jamón de york». «Tomate pera» and «tomate de rama», or «jamón serrano» and «ibérico», stay apart (different preset). A name that only reaches a rule by dropping a meaningful word doesn't join it («aceite de coco» isn't olive oil, «pan rallado» isn't bread).
- Rules whose names are different products for the list (`LIST_SPLIT_RULES`: repollo/lombarda, gambas/langostinos, vinagres, pastas, arroces…) and rules with `{name}` nouns (spices, sauces, cold cuts) join only by name; so does any name without a rule. Names compare without case or accents, so «Limón» / «Limon» or a duplicated «Pimentón dulce» (1 cdita + 3 cdita → 4 cdita) are one line.
- The joined line keeps a representative ingredient (shortest name) for its id and lists the rest in `mergedIngredientIds`; when several names were joined it shows what the shop calls the product (the rule's noun: «huevos», «aceite de oliva virgen extra»). Each part converts with its own density / unit weight, falling back to the group's.
- **Aisle:** a buy rule with its own `aisle` beats the catalogue's: eggs (huevo, yema, clara) and tofu go to `lacteos` («Lácteos y huevos»), not `proteinas` («Carnes y pescados»). The catalogue itself was corrected too: on every boot `applyCatalogIngredientAisles` (after `db:migrate`) moves the exact egg / tofu names still under `proteinas` to `lacteos`, and leaves anything else (or a second run) alone; the seed mapping has them in `lacteos`.

Within a product:

- Same unit → quantities sum directly
- **Compatible units** → converted to the canonical unit using `ingredient.density` (g↔ml) or `ingredient.unitWeight` (g↔u). Conversion target prefers what the user actually buys (whole units when sensible — eggs, lemons, onions; otherwise grams)
- **Incompatible units** (e.g. one recipe uses `cda`, another uses `g`, no density) → kept as separate line items with a small "·" merge hint

Quantities are then rounded to friendly values (kg above 1 kg, 50 g bands above 250 g, 25 g bands below) and grouped by `aisle` for display.

The list is a **rolling window** keyed by user (or household when shared). Every `GET /shopping-list?from=&to=` regenerates the menu-derived items from scratch by aggregating across every menu in the date range, and merges them with the persisted row's manual items + check state via an ingredient overlay (marks follow the ingredient across units, PRO-199). There is one `shopping_lists` row per user — prior rows are deleted before the fresh row is inserted on every fetch. The web client also invalidates `["shopping-list"]` from every menu mutation (`useGenerateMenu`, `useRegenerateMeal`, `useAddMealSlot`, `useDeleteMealSlot`, `useMoveMealSlot`, `useUpdateSlotServings`, `useSkipDay`, `useUnskipDay`, `useMarkLeftover`, etc.) so a menu change refreshes the list automatically.

Default range when neither `from` nor `to` is passed: **today (Madrid) → end of next week** (today's Monday + 13). The `from` day drops meal slots whose clock cutoff has already passed in Madrid time: breakfast after 10:00, lunch after 16:00, snack after 19:00, dinner after 23:00.

### Note dishes (multi-dish slots)

A meal slot may contain `NoteDish` entries (`{kind:'note', text}`) alongside recipe dishes (see [menus.md "Multi-dish slots"](./menus.md)). The shopping aggregator iterates `slot.dishes` and processes only `kind:'recipe'` entries; notes contribute zero items. A day whose only dish is a note ("comemos fuera") produces no shopping items for that meal. So that home dishes Mimo puts on the menu do reach the list, Mimo saves them as household recipes with estimated ingredients instead of notes (PRO-74, see [Advisor](./advisor.md)).

## API Endpoints

- `GET /shopping-list/:menuId` (auth) — generate-or-fetch the list for a menu
- `PUT /shopping-list/:listId/item/:itemId/check` (auth) — toggle `checked`
- `PUT /shopping-list/:listId/item/:itemId/stock` (auth) — toggle `inStock`
- `PUT /shopping-list/:listId/item/:itemId/have` (auth) — menu lines only (PRO-182): `{ quantity, unit? }` = how much is at home (in the line's unit unless `unit`); `setHaveAtHome` sets `haveQuantity` / `haveSource: 'inStock'`, or `inStock` when it covers the line, and the next rebuild subtracts it from what the menu asks then (`carryItemState`, also on a joined line marked on itself). Counts as a `shopping_stock` activity
- `PUT /shopping-list/:listId/item/:itemId/edit` (auth) — menu lines only (PRO-175): `{ skipped: true|false }` leaves the line out / puts it back; `{ quantity: n|null }` sets the household's amount in the line's unit / goes back to the menu's. Manual lines → 400 (use PATCH / DELETE), staples → 400 («páusalo en Mis básicos»). Writes the row and `item_state`
- `POST /shopping-list/:listId/regenerate` (auth) — discard the persisted list and regenerate from the current menu (lets the user pick up changes after editing the menu)

Both toggle endpoints flip the field (no payload value used) and return the full updated list.

## Manual items + prices (PR 10A)

- Users can add **free-text items** that aren't in any recipe — bread, dish soap, coffee — through "···" → "Añadir a mano", a sheet with the item form (name, optional quantity + unit, aisle, optional total price). Body: `{ name, quantity?, unit?, aisle?, pricePerUnit?, amountText? }`; the amount field takes a number (in the chosen unit) or words («2 paquetes» → `amountText`, stored as 2 u, PRO-175). Each manual item is stored as a `ShoppingItem` with `kind: 'manual'` and `ingredientId: null`. They survive `regenerate` (the aggregator only ever rebuilds menu-derived items today, but PR 10B will formalise this guarantee).
- Users can also add items **by chat or voice** (web assistant, WhatsApp text or voice notes): "apunta leche y dos docenas de huevos" → `add_shopping_items` writes the same manual items, without duplicating what's already pending, and "¿qué me falta?" reads this same list back (`get_shopping_list`) — see [Advisor](./advisor.md).
- Each item carries an optional **`pricePerUnit`** (€ per `unit`). A tiny inline number input next to every row lets the user enter it; menu-derived items accept price edits, but only manual items accept name/quantity/aisle edits or deletes. Trying to rename a menu item returns 400 with a Spanish hint.
- The page shows a **weekly-total banner** at the top: `€X.XX · Y con precio · Z sin precio`. Sum is `Σ quantity × pricePerUnit` over non-`inStock`, positive-quantity, priced items. Items the user already has at home are excluded from spend. The pure reducer `computeListTotal(items)` is unit-tested.

## Recurring staples (PR 10B)

- `household_staples(id, household_id, name, quantity, unit, aisle, price_per_unit?, active, created_at)` stores the items the household always needs (bread, milk, coffee). Any member can add / edit / delete; the row is per-household, not per-user.
- The shopping-list aggregator pre-pends every **active** staple to every freshly generated list. Items are added with `kind: 'staple'` and `ingredientId: null`. Dedup rule: a staple is **skipped** when an item with the same name (case-insensitive, trimmed) already exists in the menu items — that way "we always buy milk" and "this week's menu happens to include milk" don't double up. The pure `mergeStaplesIntoItems(items, staples)` reducer encapsulates the rule (5 unit tests).
- `POST /shopping-list/:listId/regenerate` re-applies the menu items, **preserves manual rows** (PR 10A) the user had typed in, then re-applies staples on top. Order is `menu → manual-kept → staples`.
- `active = false` pauses a staple without losing the row — the milk you skip this week comes back next week.
- REST: `GET /staples`, `POST /staples`, `PATCH /staples/:id`, `DELETE /staples/:id`. Frontend: `/profile/staples` page (entry button on `/profile` → "Mis básicos") with name + qty/unit/aisle + price + active-toggle UI (the pause switch is inline in each row; deleting is in the row's "···" sheet → "Quitar de tus básicos").

### REST surface added by PR 10A

| Method | Path | Notes |
|---|---|---|
| POST   | `/shopping-list/:listId/items`              | append manual item (auth, household-member) |
| PATCH  | `/shopping-list/:listId/item/:itemId`       | partial update — `pricePerUnit` allowed on any item, name/quantity/unit/aisle on manual only |
| DELETE | `/shopping-list/:listId/item/:itemId`       | manual items only — a menu line is left out with `PUT …/edit` `{ skipped: true }` (PRO-175) |
| GET    | `/shopping-list/:listId/totals`             | `{ totalEur, pricedCount, unpricedCount }` |

Access check is the same scope rule as the rest of `/shopping-list/*`: requester is the list owner, OR (with `SHARED_HOUSEHOLD_SCOPE=true`) shares the list's household. See [Household](./household.md).

## Desktop layout (lg+)

At `lg+` the `/shopping` page uses the "D" 1180 px container: header with the "Pedir a mis tiendas" pill + "···", the chip row wrapping, progress and € total side by side, and each aisle as a paper card in a 2-column grid (3 columns at `xl` squeezed the names onto two lines and made rows taller than the screen, 2026-10-10). Product names wrap inside their column (never under the € field) and the "Manual" tag sits on the quantity line. Mobile keeps one column with aisles as section headers. Visual details in [Design System](./design-system.md).

## Constraints

- Field names are camelCase (`inStock`, `checked`, `ingredientId`) end-to-end — frontend, types, and DB JSONB
- While the list is being fetched again (another date range, or after a menu change) the row buttons (✓ and "En casa") are disabled and the previous range stays on screen: every GET rebuilds the row with a new id, so a tick sent with the old id used to be lost (404) when coming back to a range already seen (2026-10-10). Now the page always refetches a range (`staleTime: 0`), and the write routes (check, stock, add, edit, delete item) that get the id of a list rebuilt since apply the change to the caller's current list (item ids are deterministic, `menu:<ingredientId>:<unit>`; `loadListForCaller` in `routes/shopping.ts`, `shoppingRoute.smoke.ts`). A state mutation's response is written only into the cached rolling list with the same id — never into other ranges or the `totals` query.
- The list is regenerated on every GET — there is no longer a manual "Regenerar" button on `/shopping`. The cache invalidates automatically when any menu mutation succeeds, so editing the menu, swapping slots, or skipping a day reflects in the basket on the next render.
- **What the user marked is remembered across ranges** (2026-10-10): each rebuild merges the previous rows' `checked` / `inStock` / `pricePerUnit` into the new rows by `(ingredientId|unit)` **and** keeps them in `shopping_lists.item_state` (migration 0043); a line that joined several ingredients (PRO-177) gathers the state of all of them (marked on any old line → marked on the joined line; price only from the same unit), so a product absent from the range on screen gets its state back when it reappears (mark onions "en casa", look at next week, come back → still "en casa"). The newest rows win over the older memory; up to 400 products, oldest dropped; manual rows travel as before (`services/shoppingItemState.ts`, `shoppingItemState.test.ts`, `e2e/week-arrows.spec.ts`).
- **What was marked follows the ingredient, not the unit** (PRO-199, Miguel 2026-10-18): changing a dish can move a line to another unit («Ajo · 8 u» → «Ajo · 25 g»); the mark is looked up by ingredient (own unit first, else the latest marked line of the same ingredient in another unit; the previous rows win over older memory) and the remembered state now stores the amount marked. If the new menu asks for **more** and the two amounts compare (same unit, or the ingredient's density / unit weight), the line goes back to pending with `haveQuantity` / `haveSource` set: the row reads «Te faltan X u · ya tienes Y», Mimo's `get_shopping_list` says «Ajo (faltan 15 g; ya tienes 25 g)» and the shop order asks only for the rest; gaps under 5 g/ml or a tenth of a unit count as covered. If they don't compare, the line stays marked. Ticking the line (or «En casa») clears the partial amount. Marks saved before this change have no amount and cover any new amount (`carryItemState`, `shoppingItemState.test.ts`).
- **«No lo compro» and the household's amount (PRO-175)** live in `item_state` under the line's `(ingredientId|unit)` as `edit: { skipped?, quantity?, until }`, written by `PUT …/edit` (`editMenuLine`) and applied on every rebuild (`applyEdit` in `carryItemState`) before the bought / «en casa» marks. `until` is the last day of the list it was set on: the change applies to lists that end on or before it («Hoy», «Mañana», the same range); a list reaching past it (next week) shows the line as the menu asks, and coming back shows it changed again; after that day it is forgotten. An amount equal to the menu's clears it. Tests: `shoppingLineEdit.test.ts`, `appSkills.test.ts`, `e2e/shopping-line-edit.spec.ts`
- The progress bar uses `shoppingProgress(items).ratio` = (bought-and-not-at-home + at-home) / rows, capped at 100 % by construction
- Export format is plain text suitable for paste into messaging apps; it preserves aisle grouping and ends with a "Hecho con Mimoia" line + link (the shared title is "Lista de compra · Mimoia") (`/?ref=lista`, `withOnaFooter`), so a shared list can bring another household
- **Ingredient names on screen (detail, shopping list, pantry, staples)** read as a sentence — «Aceite de oliva virgen», «Pimentón dulce» — via `ingredientDisplayName` (`packages/shared/src/utils/shopFormat.ts`): only the first letter is raised and catalogue accents are restored; brands/acronyms the user typed («Kerrygold», «AOVE») stay. Display-only; stored names are untouched (PRO-02).
- Aisle assignment falls back to `otros` when `ingredient.aisle` is unset; curators are nudged to fill the column
- Check / stock mutations work offline; the request is held in the PWA queue until reconnect. The local UI updates optimistically and a "Pendiente de sincronizar" indicator shows while pending
- **Household scope (PR 1B):** shopping lists carry both `user_id` and `household_id`. Reads + access checks on `POST /shopping-list/:listId/regenerate` honour the env flag `SHARED_HOUSEHOLD_SCOPE`; with the flag on, any household member can regenerate the household's list. See [Household](./household.md)

- **Shopping events for the household ficha (PRO-151):** each item mutation that succeeds — tick (`…/check`), «En casa» (`…/stock`), manual add (`POST …/items`) and manual remove (`DELETE …/item/:itemId`) — leaves an `activity_events` row (`shopping_check` / `shopping_stock` / `shopping_add` / `shopping_remove`) with the product's name (`item`, ≤ 80 chars) and, for the toggles, the new state (`toggled_on`). Mimo's «marcar» and «en casa» skills do the same. They are signals of the [Ficha del hogar](./household-profile.md) (Daily signals); deleting the account deletes them

## Related specs

- [Menus](./menus.md) — source of recipes; provides `recipe.servings` for scaling math
- [Recipes](./recipes.md) — defines `RecipeIngredient` units and `optional` flags
- [Nutrition](./nutrition.md) — same `density` / `unitWeight` / `aisle` columns on the ingredients catalog drive both shopping aggregation and nutrition
- [PWA](./pwa.md) — offline mutation queue (check / stock toggles), Web Share for the export action

## Source

- [apps/web/src/lib/shoppingRange.ts](../apps/web/src/lib/shoppingRange.ts) — «Hoy» / «Mañana» / «Esta semana» shortcuts and `shiftIso`
- [apps/api/src/routes/shopping.ts](../apps/api/src/routes/shopping.ts)
- [apps/api/src/services/glutenFreeCharcuterie.ts](../apps/api/src/services/glutenFreeCharcuterie.ts) — «<embutido> sin gluten» on a coeliac household's list, «Elige embutido sin gluten» on the recipe (PRO-196)
- [apps/api/src/services/shoppingList.ts](../apps/api/src/services/shoppingList.ts) — aggregation + unit conversion + aisle grouping
- [packages/shared/src/buy/listGroup.ts](../packages/shared/src/buy/listGroup.ts) — same product, never bought, catalogue aisle fix (PRO-177; tests `shoppingListMerge.test.ts`)
- [apps/api/src/services/catalogIngredientAisles.ts](../apps/api/src/services/catalogIngredientAisles.ts) — boot data fix: eggs and tofu to `lacteos`
- [apps/api/src/services/shoppingItemState.ts](../apps/api/src/services/shoppingItemState.ts) — check / at-home / price memory
- [apps/web/src/app/shopping/page.tsx](../apps/web/src/app/shopping/page.tsx)
- [apps/web/src/components/shopping/ShoppingExtensions.tsx](../apps/web/src/components/shopping/ShoppingExtensions.tsx) — € total card, manual-item form, inline price, delete
- [apps/web/src/hooks/useShopping.ts](../apps/web/src/hooks/useShopping.ts)
- [packages/shared/src/types/shopping.ts](../packages/shared/src/types/shopping.ts)
