# Shopping · Cómo se suma la lista, la API y lo que se añade a mano

> Parte de [Shopping](./shopping.md) (la portada lista todas las partes): la agregación (bases, platos nota), los endpoints, lo añadido a mano con precios, las comidas fijas y los básicos que se repiten.

## Aggregation

`generateShoppingList` (server) walks every slot in `menu.days` and, for each recipe:

1. Looks up the user's household: `users.adults` (≥1, includes anyone over 10 years) and `users.kids_2_to_10` (children aged 2–10). Children under 2 don't count.
2. Computes the household multiplier as `adults + 0.5 × kidsCount`. For each slot the **effective diner count** is `slot.servings` if the user set a per-day override on the menu card (see [Menus](./menus-ajustar.md#manual-slot-shaping-per-week-overrides)), otherwise this household multiplier.
3. Sums effective diner counts per recipe across the week (`sumDinersByRecipe`): two slots of the same recipe with overrides for 4 and 8 diners aggregate to 12. A household minimum (`recipe_notes.min_servings`, "siempre la cocino para al menos N") raises it to max(diners, N × times cooked); a slot with `variant: 'leftover'` is not another cooking. **Leftovers (táper, PRO-75, PRO-298)**: before summing, `withLeftoverBatches(days, household)` resolves each leftover against its own week (so the rolling route runs it per menu before re-indexing days) with `leftoverShares` (`@ona/shared`, the same rule as the menu's «N raciones» and Mimo): a dish with leftovers is bought for every meal it covers. If the source meal has no «Solo hoy» or one up to the household's size (it's who eats that meal, often the weekly template's diners the generator puts on every slot), each leftover adds its own diners; if «Solo hoy: N» is above the household, N already pays for tápers and the leftovers add only what N doesn't cover: max(N, household + each leftover). A leftover that adds nothing is dropped from the copy; one that adds part carries `listDiners`. Household of 1: lasaña «Solo hoy: 2» + sobras → 2; without «Solo hoy» → 2; household of 2 → 4; household of 2, bowl Monday «Solo hoy: 2» + sobras Tuesday to Thursday → 8 (PRO-298, Dani y Sara bought for one day); «Solo hoy: 3» + the same → 8; «Solo hoy: 6» + one leftover → 6 (`tests/leftoverBatches.test.ts`, including the generator's week via `mergeWithGenerator`). Before, leftovers copied the source's «Solo hoy» and the list bought 2 + 2. A **táper of tomorrow** (PRO-223, slot with `taper`) always adds its own rations (`servings` = tápers), even on top of «Solo hoy»: «Solo hoy: 4» + 1 táper → 5 (`tests/taper.test.ts`). Example (minimum): 2 people, lentejas twice a week with minimum 6 → buy for 12.
   - A dish with `variant: 'freezer'` («Del congelador», PRO-82), `variant: 'fridge'` («Táper de la nevera», PRO-240) or `variant: 'cooked'` («Sobras de otro día», 2026-10-20) adds nothing and isn't a cooking: that táper was bought and cooked some other time, whatever week. Notes add nothing either. **A leftover whose source meal became a táper of the same recipe adds nothing either** (PRO-240: the batch was cooked; Dani y Sara's list asked again for «Lentejas 150 g» after Mimo turned the batch into tápers). Pinned by `tests/freezerDish.test.ts`, `tests/taperDishes.test.ts` + `e2e/freezer-dish.spec.ts`.
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

Quantities are then rounded **up** to friendly values (100 g steps from 1 kg, shown as kg; 50 g steps above 250 g; 25 g steps below; whole units, 1,2 huevos → 2; half spoons), so the list never asks for less than the recipes add up to (PRO-241, Laura 2026-10-18: `Math.round` turned 60 g of basmati into 50 g, 32 g of butter into 25 g and 8 g into nothing; now 60 → 75 g, 32 → 50 g, 8 → 25 g; float noise like 6.0000001 eggs stays 6; `shoppingRoundUp.test.ts`), and grouped by `aisle` for display. Known: a tiny amount of something sold by the litre still reads «Leche entera 25 ml».

The list is a **rolling window** keyed by user (or household when shared). Every `GET /shopping-list?from=&to=` regenerates the menu-derived items from scratch by aggregating across every menu in the date range, and merges them with the persisted row's manual items + check state via an ingredient overlay (marks follow the ingredient across units, PRO-199). There is one `shopping_lists` row per user — prior rows are deleted before the fresh row is inserted on every fetch. The web client also invalidates `["shopping-list"]` from every menu mutation (`useGenerateMenu`, `useRegenerateMeal`, `useAddMealSlot`, `useDeleteMealSlot`, `useMoveMealSlot`, `useUpdateSlotServings`, `useSkipDay`, `useUnskipDay`, `useMarkLeftover`, etc.) so a menu change refreshes the list automatically.

Default range when neither `from` nor `to` is passed: **today (Madrid) → end of next week** (today's Monday + 13). The `from` day drops meal slots whose clock cutoff has already passed in Madrid time: breakfast after 10:00, lunch after 16:00, snack after 19:00, dinner after 23:00.

### Bases (PRO-373)

A dish that uses a base cooked another day (`recipe_bases`, see [Recipes](./recipes.md) → Bases de batch cooking) adds the base's ingredients to the list. Before scaling, `generateShoppingList` reads the `recipe_bases` of the week's dishes (and of those bases, up to 3 levels) and `withBaseServings` (pure) gives each base the servings the dishes use: a dish cooked for D diners uses `servings_used × D / dish.servings`; the shares of every dish that uses the same base **add up into one base**, so it is bought once, scaled: two dishes for 2 of their 4, each with 2 servings of a 4-serving sofrito → half the sofrito, once (not twice in full). Overrides and «al menos N» of the base apply as for any recipe. A line with ingredients of a base carries `bases` (its names) and reads «Para la base: Sofrito» under the name on `/shopping` (testid `shopping-bases`). There is no «Por recetas» view of the list today; when there is one, it should name the base the same way. Test: `recipeBases.test.ts`.

### Note dishes (multi-dish slots)

A meal slot may contain `NoteDish` entries (`{kind:'note', text}`) alongside recipe dishes (see [menus.md "Multi-dish slots"](./menus.md)). The shopping aggregator iterates `slot.dishes` and processes only `kind:'recipe'` entries; notes contribute zero items. A day whose only dish is a note ("comemos fuera") produces no shopping items for that meal. So that home dishes Mimo puts on the menu do reach the list, Mimo saves them as household recipes with estimated ingredients instead of notes (PRO-74, see [Advisor](./advisor.md)).

## API Endpoints

- `GET /shopping-list/:menuId` (auth) — generate-or-fetch the list for a menu
- `PUT /shopping-list/:listId/item/:itemId/check` (auth) — toggle `checked`
- `PUT /shopping-list/:listId/item/:itemId/stock` (auth) — toggle `inStock`
- `PUT /shopping-list/:listId/item/:itemId/have` (auth) — menu lines only (PRO-182): `{ quantity, unit? }` = how much is at home (in the line's unit unless `unit`); `setHaveAtHome` sets `haveQuantity` / `haveSource: 'inStock'`, or `inStock` when it covers the line, and the next rebuild subtracts it from what the menu asks then (`carryItemState`, also on a joined line marked on itself). Counts as a `shopping_stock` activity
- `PUT /shopping-list/:listId/item/:itemId/edit` (auth) — menu lines only (PRO-175): `{ skipped: true|false }` leaves the line out / puts it back; `{ quantity: n|null }` sets the household's amount in the line's unit / goes back to the menu's; `{ unit, quantity? }` (PRO-292) switches it to another unit of its `unitOptions`, converting what it shows (rounded up to what a shop sells: 700 g of onion → 5 u) or taking `quantity` in that unit, and the menu's unit alone goes back to the menu's amount; a unit the ingredient can't convert to → 400 with the units it can. `{ habitual: true|false }` (PRO-293, any line, also manual and staple) creates / switches on the household's staple for it or pauses it. Otherwise manual lines → 400 (use PATCH / DELETE), staples → 400 («páusalo en Mis básicos»). Writes the row and `item_state`
- `POST /shopping-list/:listId/regenerate` (auth) — discard the persisted list and regenerate from the current menu (lets the user pick up changes after editing the menu)

Both toggle endpoints flip the field (no payload value used) and return the full updated list.

## Manual items + prices (PR 10A)

- Users can add **free-text items** that aren't in any recipe — bread, dish soap, coffee — through "···" → "Añadir a mano", a sheet with the item form (name, optional quantity + unit, aisle, optional total price). Body: `{ name, quantity?, unit?, aisle?, pricePerUnit?, amountText? }`; the amount field takes a number (in the chosen unit) or words («2 paquetes» → `amountText`, stored as 2 u, PRO-175). Each manual item is stored as a `ShoppingItem` with `kind: 'manual'` and `ingredientId: null`. They survive `regenerate` (the aggregator only ever rebuilds menu-derived items today, but PR 10B will formalise this guarantee).
- Users can also add items **by chat or voice** (web assistant, WhatsApp text or voice notes): "apunta leche y dos docenas de huevos" → `add_shopping_items` writes the same manual items, without duplicating what's already pending, and "¿qué me falta?" reads this same list back (`get_shopping_list`) — see [Advisor](./advisor.md).
- Each item carries an optional **`pricePerUnit`** (€ per `unit`). A tiny inline number input next to every row lets the user enter it; menu-derived items accept price edits, but only manual items accept name/quantity/aisle edits or deletes. Trying to rename a menu item returns 400 with a Spanish hint.
- The page shows a **weekly-total banner** at the top: `€X.XX · Y con precio · Z sin precio`. Sum is `Σ quantity × pricePerUnit` over non-`inStock`, positive-quantity, priced items. Items the user already has at home are excluded from spend. The pure reducer `computeListTotal(items)` is unit-tested.

## Comidas fijas (PRO-218)

- A «Fijo: …» slot (a fixed meal the generator placed, see [Menus → Comidas fijas](./menus-semana-tipo.md)) carries its items per person (`NoteDish.fixed.items`). The list adds them × the slot's diners (`servings`, else the household multiplier) for every such slot in the range (`sumFixedItems`): a 7-day breakfast for 1 with 1 yogur, 40 g de cereales and 2 galletas → 7 yogures, 280 g de cereales, 14 galletas.
- An item whose name is a catalogue ingredient (accents, case and plural «s»/«es» ignored: «galletas» → «galleta», «yogures» → «yogur») joins that ingredient's line and its rounding (`splitFixedLines`); any other gets its own line in «Otros» with the household's exact amount (`fixedLinesToItems`, id `fixed:<name>:<unit>`, so ticks survive the rolling rebuild). Ordinary notes still add nothing.
- Tests: `fixedMeals.test.ts`, smoke `fixedMealsRoute.smoke.ts`.

## Recurring staples (PR 10B)

- `household_staples(id, household_id, name, quantity, unit, aisle, price_per_unit?, active, created_at)` stores the items the household always needs (bread, milk, coffee). Any member can add / edit / delete; the row is per-household, not per-user.
- The shopping-list aggregator pre-pends every **active** staple to every freshly generated list. Items are added with `kind: 'staple'` and `ingredientId: null`. Dedup rule: a staple is **skipped** when an item with the same name (case-insensitive, trimmed) already exists in the menu items — that way "we always buy milk" and "this week's menu happens to include milk" don't double up. The pure `mergeStaplesIntoItems(items, staples)` reducer encapsulates the rule (5 unit tests).
- `POST /shopping-list/:listId/regenerate` re-applies the menu items, **preserves manual rows** (PR 10A) the user had typed in, then re-applies staples on top. Order is `menu → manual-kept → staples`.
- `active = false` pauses a staple without losing the row — the milk you skip this week comes back next week.
- REST: `GET /staples`, `POST /staples`, `PATCH /staples/:id`, `DELETE /staples/:id`. From the list itself: «Habitual» (PRO-293, above). Frontend: `/profile/staples` page (entry row «Básicos fijos» in Perfil → «La compra», PRO-1202) with name + qty/unit/aisle + price + active-toggle UI (the pause switch is inline in each row; deleting is in the row's "···" sheet → "Quitar de tus básicos").

### REST surface added by PR 10A

| Method | Path | Notes |
|---|---|---|
| POST   | `/shopping-list/:listId/items`              | append manual item (auth, household-member) |
| PATCH  | `/shopping-list/:listId/item/:itemId`       | partial update — `pricePerUnit` allowed on any item (menu and staple ids like `menu:<id>:<unit>` are accepted: before PRO-292 the route asked for a UUID and the € field on menu lines got a 400), name/quantity/unit/aisle on manual only |
| DELETE | `/shopping-list/:listId/item/:itemId`       | manual items only — a menu line is left out with `PUT …/edit` `{ skipped: true }` (PRO-175) |
| GET    | `/shopping-list/:listId/totals`             | `{ totalEur, pricedCount, unpricedCount }` |

Access check is the same scope rule as the rest of `/shopping-list/*`: requester is the list owner, OR (with `SHARED_HOUSEHOLD_SCOPE=true`) shares the list's household. See [Household](./household.md).
