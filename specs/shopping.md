# Shopping

Weekly shopping list and pantry stock management. Aggregates ingredients across the menu's recipes, scales them for the household, and respects real units.

## User Capabilities

- Users can see a shopping list auto-generated from the current week's menu
- The list aggregates ingredients across all recipes in the week, summing quantities **per ingredient** with proper unit handling
- Users can check items off as they buy them (visual strikethrough, persisted)
- Users can mark items as already in their pantry (stock manager)
- Items in stock are excluded from the active shopping list
- Users can switch between two tabs: "Por comprar" (shopping list) and "Ya en casa" (pantry)
- Users can see items grouped by aisle (produce, carnicería, lácteos, panadería, despensa…) for faster shopping; a single chip row under the header narrows the current tab to one aisle ("Todo" shows them all; only aisles with rows in that tab get a chip)
- The date range (today → end of next week by default) shows as the page eyebrow and as the first chip of that row; tapping it (or "···" → "Cambiar fechas") opens a sheet with "Desde" / "Hasta" and the "Esta + sig" reset. **‹ ›** on either side of that chip ("Semana anterior" / "Semana siguiente", mobile and desktop) move the whole range 7 days; "anterior" never goes before today and is disabled while the range starts today
- Users can export what's left to buy as plain text via the native share sheet (Web Share API), with clipboard fallback on browsers without `navigator.share` — "···" → "Compartir lo que queda"
- Check-item and stock-toggle mutations are queued offline (IndexedDB) and replay automatically when the device reconnects; an inline "Pendiente de sincronizar" Clock icon marks items still in the queue — see [PWA](./pwa.md)
- The page shows progress: "X/Y completados", "N% listo", "X comprados · Z en casa" with an ink progress bar. Each row counts once: a row bought and then marked "en casa" counts as en casa, so X never exceeds Y nor the % 100 (`shoppingProgress` in `@ona/shared`; it showed "72/56 · 129 %" before 2026-10-10)
- If no menu exists for the week, the page shows an empty state with a CTA to generate one
- Items carry their recipe notes (`notes`: "picada", "morada en juliana") and tiny buyable amounts no longer vanish (two cloves of garlic stay as a line when a shop sells garlic; pantry staples still drop). Items typed by hand with no amount are stored as 1 u with `quantitySource: 'default'` (the form starts empty) and get their aisle from the buy rules ("calabacín" → frutas y verduras). See [shop-orders.md](./shop-orders.md) → Buy rules.
- **Pedir a mis tiendas** ("···" sheet; also an outlined pill in the header at `lg+`) links to `/compra`, where ONA turns what's left for the next 7 days into one order per shop (frutería, carnicería, pescadería, súper) that the user sends from their own WhatsApp — see [Compra en mis tiendas](./shop-orders.md). Closing a shop order ticks its items as bought on this list.

## Item Model

Each item in `shopping_lists.items` (JSONB array) has:
- `id` — UUID
- `ingredientId` — links back to the global ingredient catalog (drives aisle grouping and unit conversions)
- `name` — display name
- `quantity` — aggregated number, in `unit`
- `unit` — `g | ml | u | cda | cdita`
- `aisle` — `produce | proteinas | lacteos | panaderia | despensa | congelados | otros`
- `checked` — boolean, user has bought this
- `inStock` — boolean, user already had this in pantry

## Aggregation

`generateShoppingList` (server) walks every slot in `menu.days` and, for each recipe:

1. Looks up the user's household: `users.adults` (≥1, includes anyone over 10 years) and `users.kids_2_to_10` (children aged 2–10). Children under 2 don't count.
2. Computes the household multiplier as `adults + 0.5 × kidsCount`. For each slot the **effective diner count** is `slot.servings` if the user set a per-day override on the menu card (see [Menus](./menus.md#manual-slot-shaping-per-week-overrides)), otherwise this household multiplier.
3. Sums effective diner counts per recipe across the week (`sumDinersByRecipe`): two slots of the same recipe with overrides for 4 and 8 diners aggregate to 12. A household minimum (`recipe_notes.min_servings`, "siempre la cocino para al menos N") raises it to max(diners, N × times cooked); a slot with `variant: 'leftover'` adds its diners but is not another cooking. Example: 2 people, lentejas twice a week with minimum 6 → buy for 12.
4. Scaling factor per recipe: `aggregatedDiners / recipe.servings`
5. Applies the household's `recipe_notes.ingredient_overrides` for that recipe (see [Recipes](./recipes.md)) **before** scaling: `remove` drops the row, `modify` replaces quantity/unit, `add` appends a synthetic row whose `label` is resolved against the catalog by case-insensitive name match (unknown adds are skipped — the recipe detail still shows them)
6. For each surviving row, multiplies `quantity` by that factor
7. Skips ingredients tagged `optional: true` unless the user opts in (future toggle)
8. `pizca` and `al_gusto` are dropped from the list (not buyable)

Then the list aggregator merges items by `ingredientId`:

- Same ingredient with the **same unit** → quantities sum directly
- Same ingredient with **compatible units** → converted to the canonical unit using `ingredient.density` (g↔ml) or `ingredient.unitWeight` (g↔u). Conversion target prefers what the user actually buys (whole units when sensible — eggs, lemons, onions; otherwise grams)
- Same ingredient with **incompatible units** (e.g. one recipe uses `cda`, another uses `g`, no density) → kept as separate line items with a small "·" merge hint

Quantities are then rounded to friendly values (kg above 1 kg, 50 g bands above 250 g, 25 g bands below) and grouped by `aisle` for display.

The list is a **rolling window** keyed by user (or household when shared). Every `GET /shopping-list?from=&to=` regenerates the menu-derived items from scratch by aggregating across every menu in the date range, and merges them with the persisted row's manual items + check state via an `ingredientId` overlay. There is one `shopping_lists` row per user — prior rows are deleted before the fresh row is inserted on every fetch. The web client also invalidates `["shopping-list"]` from every menu mutation (`useGenerateMenu`, `useRegenerateMeal`, `useAddMealSlot`, `useDeleteMealSlot`, `useMoveMealSlot`, `useUpdateSlotServings`, `useSkipDay`, `useUnskipDay`, `useMarkLeftover`, etc.) so a menu change refreshes the list automatically.

Default range when neither `from` nor `to` is passed: **today (Madrid) → end of next week** (today's Monday + 13). The `from` day drops meal slots whose clock cutoff has already passed in Madrid time: breakfast after 10:00, lunch after 16:00, snack after 19:00, dinner after 23:00.

### Note dishes (multi-dish slots)

A meal slot may contain `NoteDish` entries (`{kind:'note', text}`) alongside recipe dishes (see [menus.md "Multi-dish slots"](./menus.md)). The shopping aggregator iterates `slot.dishes` and processes only `kind:'recipe'` entries; notes contribute zero items. A day whose only dish is a note ("comemos fuera") produces no shopping items for that meal.

## API Endpoints

- `GET /shopping-list/:menuId` (auth) — generate-or-fetch the list for a menu
- `PUT /shopping-list/:listId/item/:itemId/check` (auth) — toggle `checked`
- `PUT /shopping-list/:listId/item/:itemId/stock` (auth) — toggle `inStock`
- `POST /shopping-list/:listId/regenerate` (auth) — discard the persisted list and regenerate from the current menu (lets the user pick up changes after editing the menu)

Both toggle endpoints flip the field (no payload value used) and return the full updated list.

## Manual items + prices (PR 10A)

- Users can add **free-text items** that aren't in any recipe — bread, dish soap, coffee — through "···" → "Añadir a mano", a sheet with the item form (name, optional quantity + unit, aisle, optional total price). Body: `{ name, quantity?, unit?, aisle?, pricePerUnit? }`. Each manual item is stored as a `ShoppingItem` with `kind: 'manual'` and `ingredientId: null`. They survive `regenerate` (the aggregator only ever rebuilds menu-derived items today, but PR 10B will formalise this guarantee).
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
| DELETE | `/shopping-list/:listId/item/:itemId`       | manual items only — menu items get regenerated away |
| GET    | `/shopping-list/:listId/totals`             | `{ totalEur, pricedCount, unpricedCount }` |

Access check is the same scope rule as the rest of `/shopping-list/*`: requester is the list owner, OR (with `SHARED_HOUSEHOLD_SCOPE=true`) shares the list's household. See [Household](./household.md).

## Desktop layout (lg+)

At `lg+` the `/shopping` page uses the "D" 1180 px container: header with the "Pedir a mis tiendas" pill + "···", the chip row wrapping, progress and € total side by side, and each aisle as a paper card in a 2-column grid (3 columns at `xl` squeezed the names onto two lines and made rows taller than the screen, 2026-10-10). Product names wrap inside their column (never under the € field) and the "Manual" tag sits on the quantity line. Mobile keeps one column with aisles as section headers. Visual details in [Design System](./design-system.md).

## Constraints

- Field names are camelCase (`inStock`, `checked`, `ingredientId`) end-to-end — frontend, types, and DB JSONB
- While the list is being fetched again (another date range, or after a menu change) the row buttons (✓ and "En casa") are disabled and the previous range stays on screen: every GET rebuilds the row with a new id, so a tick sent with the old id used to be lost (404) when coming back to a range already seen (2026-10-10). A state mutation's response is written only into the cached rolling list with the same id — never into other ranges or the `totals` query.
- The list is regenerated on every GET — there is no longer a manual "Regenerar" button on `/shopping`. The cache invalidates automatically when any menu mutation succeeds, so editing the menu, swapping slots, or skipping a day reflects in the basket on the next render.
- The progress bar uses `shoppingProgress(items).ratio` = (bought-and-not-at-home + at-home) / rows, capped at 100 % by construction
- Export format is plain text suitable for paste into messaging apps; it preserves aisle grouping and ends with a "Hecho con Mimoia" line + link (the shared title is "Lista de compra · Mimoia") (`/?ref=lista`, `withOnaFooter`), so a shared list can bring another household
- **Ingredient names on screen (detail, shopping list, pantry, staples)** read as a sentence — «Aceite de oliva virgen», «Pimentón dulce» — via `ingredientDisplayName` (`packages/shared/src/utils/shopFormat.ts`): only the first letter is raised and catalogue accents are restored; brands/acronyms the user typed («Kerrygold», «AOVE») stay. Display-only; stored names are untouched (PRO-02).
- Aisle assignment falls back to `otros` when `ingredient.aisle` is unset; curators are nudged to fill the column
- Check / stock mutations work offline; the request is held in the PWA queue until reconnect. The local UI updates optimistically and a "Pendiente de sincronizar" indicator shows while pending
- **Household scope (PR 1B):** shopping lists carry both `user_id` and `household_id`. Reads + access checks on `POST /shopping-list/:listId/regenerate` honour the env flag `SHARED_HOUSEHOLD_SCOPE`; with the flag on, any household member can regenerate the household's list. See [Household](./household.md)

## Related specs

- [Menus](./menus.md) — source of recipes; provides `recipe.servings` for scaling math
- [Recipes](./recipes.md) — defines `RecipeIngredient` units and `optional` flags
- [Nutrition](./nutrition.md) — same `density` / `unitWeight` / `aisle` columns on the ingredients catalog drive both shopping aggregation and nutrition
- [PWA](./pwa.md) — offline mutation queue (check / stock toggles), Web Share for the export action

## Source

- [apps/api/src/routes/shopping.ts](../apps/api/src/routes/shopping.ts)
- [apps/api/src/services/shoppingList.ts](../apps/api/src/services/shoppingList.ts) — aggregation + unit conversion + aisle grouping
- [apps/web/src/app/shopping/page.tsx](../apps/web/src/app/shopping/page.tsx)
- [apps/web/src/components/shopping/ShoppingExtensions.tsx](../apps/web/src/components/shopping/ShoppingExtensions.tsx) — € total card, manual-item form, inline price, delete
- [apps/web/src/hooks/useShopping.ts](../apps/web/src/hooks/useShopping.ts)
- [packages/shared/src/types/shopping.ts](../packages/shared/src/types/shopping.ts)
