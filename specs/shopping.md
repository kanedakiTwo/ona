# Shopping

Weekly shopping list and pantry stock management. Aggregates ingredients across the menu's recipes, scales them for the household, and respects real units.

## User Capabilities

- Users can see a shopping list auto-generated from the current week's menu
- The list aggregates ingredients across all recipes in the week, summing quantities **per ingredient** with proper unit handling
- Users can check items off as they buy them (visual strikethrough, persisted)
- Users can mark items as already in their pantry (stock manager)
- Items in stock are excluded from the active shopping list
- Users can switch between two views: "Lista" (shopping list) and "Gestionar stock" (pantry toggle)
- Users can see items grouped by aisle (produce, carnicería, lácteos, panadería, despensa…) for faster shopping
- Users can export the active list as plain text via the native share sheet (Web Share API), with clipboard fallback on browsers without `navigator.share`
- Check-item and stock-toggle mutations are queued offline (IndexedDB) and replay automatically when the device reconnects; an inline "Pendiente de sincronizar" Clock icon marks items still in the queue — see [PWA](./pwa.md)
- The page shows progress: "X/Y comprados" and "Z en stock" with a green progress bar
- A toggle "Mostrar en stock" reveals/hides items already in stock within the list view
- If no menu exists for the week, the page shows an empty state with a CTA to generate one

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

`generateShoppingList` (server) walks every meal in `menu.days` and, for each recipe:

1. Looks up the user's `householdSize` (1 = `solo`, 2 = `pair`, etc.)
2. Computes the scaling factor as `householdSize / recipe.servings`
3. For each `RecipeIngredient`, multiplies `quantity` by that factor
4. Skips ingredients tagged `optional: true` unless the user opts in (future toggle)
5. `pizca` and `al_gusto` are dropped from the list (not buyable)

Then the list aggregator merges items by `ingredientId`:

- Same ingredient with the **same unit** → quantities sum directly
- Same ingredient with **compatible units** → converted to the canonical unit using `ingredient.density` (g↔ml) or `ingredient.unitWeight` (g↔u). Conversion target prefers what the user actually buys (whole units when sensible — eggs, lemons, onions; otherwise grams)
- Same ingredient with **incompatible units** (e.g. one recipe uses `cda`, another uses `g`, no density) → kept as separate line items with a small "·" merge hint

Quantities are then rounded to friendly values (kg above 1 kg, 50 g bands above 250 g, 25 g bands below) and grouped by `aisle` for display.

The list is generated on the **first** GET; subsequent GETs return the same persisted list. There is no automatic regeneration if the menu changes — the list is decoupled once created.

## API Endpoints

- `GET /shopping-list/:menuId` (auth) — generate-or-fetch the list for a menu
- `PUT /shopping-list/:listId/item/:itemId/check` (auth) — toggle `checked`
- `PUT /shopping-list/:listId/item/:itemId/stock` (auth) — toggle `inStock`
- `POST /shopping-list/:listId/regenerate` (auth) — discard the persisted list and regenerate from the current menu (lets the user pick up changes after editing the menu)

Both toggle endpoints flip the field (no payload value used) and return the full updated list.

## Constraints

- Field names are camelCase (`inStock`, `checked`, `ingredientId`) end-to-end — frontend, types, and DB JSONB
- The list is created on first GET; once created, it's not regenerated automatically — only via the explicit regenerate endpoint
- Items are only created from menu recipes; users cannot add custom items in the current implementation
- The progress bar uses `(checkedCount + inStockCount) / totalCount`
- Export format is plain text suitable for paste into messaging apps; it preserves aisle grouping
- Aisle assignment falls back to `otros` when `ingredient.aisle` is unset; curators are nudged to fill the column
- Check / stock mutations work offline; the request is held in the PWA queue until reconnect. The local UI updates optimistically and a "Pendiente de sincronizar" indicator shows while pending

## Related specs

- [Menus](./menus.md) — source of recipes; provides `recipe.servings` for scaling math
- [Recipes](./recipes.md) — defines `RecipeIngredient` units and `optional` flags
- [Nutrition](./nutrition.md) — same `density` / `unitWeight` / `aisle` columns on the ingredients catalog drive both shopping aggregation and nutrition
- [PWA](./pwa.md) — offline mutation queue (check / stock toggles), Web Share for the export action

## Source

- [apps/api/src/routes/shopping.ts](../apps/api/src/routes/shopping.ts)
- [apps/api/src/services/shoppingList.ts](../apps/api/src/services/shoppingList.ts) — aggregation + unit conversion + aisle grouping
- [apps/web/src/app/shopping/page.tsx](../apps/web/src/app/shopping/page.tsx)
- [apps/web/src/components/shopping/ShoppingList.tsx](../apps/web/src/components/shopping/ShoppingList.tsx)
- [apps/web/src/components/shopping/StockManager.tsx](../apps/web/src/components/shopping/StockManager.tsx)
- [apps/web/src/hooks/useShopping.ts](../apps/web/src/hooks/useShopping.ts)
- [packages/shared/src/types/shopping.ts](../packages/shared/src/types/shopping.ts)
