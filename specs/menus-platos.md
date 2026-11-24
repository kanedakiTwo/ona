# Menus · Varios platos por comida y registro de cambios

> Parte de [Menus](./menus.md) (la portada lista todas las partes): comidas con varios platos (rutas por plato, la hoja con varios platos, estado por comida y por plato) y el registro de cambios del menú.

## Multi-dish slots

Each `MealSlot` holds `{servings?, dishes: Dish[]}` where every `Dish` is either a `RecipeDish` (`{kind:'recipe', recipeId, recipeName?, course?, variant?, leftoverOf?, fixedDish?, imageUrl?, prepTime?, totalTime?}`) or a `NoteDish` (`{kind:'note', text, fixed?, fixedDish?}`). The list is ordered and the order is what the UI renders — there's no semantic role per position.

The number of dishes lives in each slot of the household's **semana tipo** (`dishes: 1|2|3`, default 1; before D-182, per meal type in `userSettings.template.mealDishCounts`, which the migration copied to every slot of that meal). The generator maps:
- `1` → matcher restricted to `course IN ('main') OR course IS NULL` (single-plate convention; starters and desserts are auto-skipped).
- `2` → `[starter, main]`.
- `3` → `[starter, main, dessert]`.

When a course has no candidates, the generator emits a warning `no_<course>_available_<meal>_d<dayIndex>` in the `POST /menu/generate` response and produces fewer dishes for that slot. The UI can surface the warning list as a toast.

Notes are excluded from the matcher and added only via manual UI (`+ Añadir plato` → "Añadir nota") or `POST /menu/:menuId/day/:day/meal/:meal/dish` with `{kind:'note', text}`. Notes contribute zero to shopping list and nutrition aggregation.

### Dish-level routes

All under `/menu/:menuId/day/:day/meal/:meal/dish` and gated by the `:menuId` IDOR guard (400 non-UUID / 404 unknown / 403 foreign — see "Access control" below):

- `POST` — append a dish. Body discriminated by `kind`: `{kind:'recipe', recipeId, course?, variant?}` or `{kind:'note', text}` (text ≤120 chars). A recipe dish only with a recipe the household can see (`visibleRecipeWhere`), else 404 — also from Mimo's `add_dish`, which uses this route (PRO-1274, 2026-11-20).
- `DELETE /:position` — remove. Subsequent positions decrement; empty `dishes[]` is allowed (slot remains, UI shows "+ Añadir plato" placeholder).
- `PATCH /:position` — `{text?, newPosition?, course?, variant?}`. Precedence: if `newPosition` is present, it's the only operation (pure reorder); otherwise patches text/course/variant. Fields that don't apply to the dish kind are silently ignored.
- `POST /:position/regenerate` — Aleatorio on one dish; respects its `course` (and the semana tipo's type there). 400 on note dishes; 409 when no candidates match. Body (all optional, PRO-1176): `{ recipeId }` — «Cambiar este plato»: that recipe (one the household can see, else 404) on that dish only, the meal's other dishes kept, and the meal locked (chosen by hand); `{ dishType }` — «Que elija Mimoia» with a chip: only a recipe of that type, never the one there, none → **409 `NO_RECIPE_OF_TYPE`**; `{ expect }` as in the other dish routes.

### The meal sheet with several dishes (PRO-1176)

E-72, Miguel 2026-11-11: «ese menú contextual no funciona bien cuando hay más de un plato». Before, the title was the first dish's, «Ver receta» and «Marcar como cocinada» only reached the first and «Cambiar» on each dish was random. Now a meal with **2 or more dishes or a note** (`isMultiDishMeal`, `lib/mealSheet.ts`) opens a sheet whose title is the meal («Comida · jueves 13») and subtitle «2 platos · 3 comensales» (`mealSheetHeading`; «Solo hoy: N» counts). Then:
- **A row per dish** (`DishRow`): thumbnail, course (Entrante, Principal, Postre), name and time; a tap opens the recipe (at the batch's servings); drag the handle ⠿ to reorder (`PATCH …/dish/:position { newPosition }`, `ordenar_platos`). A note shows its text. The random «Cambiar» of each row is gone.
- **Each row's «···»** opens the **dish's sheet** (`dishSheetOptions`): Ver receta · **Cambiar este plato** (the same picker, chips and «Que elija Mimoia» included, on `…/dish/:position/regenerate`; only that dish changes) · **Ya está hecho / táper** (`PATCH …/dish/:position { variant: 'cooked' }`; on a táper, «No lo tengo hecho» → `planned`; never on the batch of planned leftovers) · **No lo pongas más esta semana** (confirm; the veto + another recipe on that dish only) · **Quitar este plato**. A leftover only offers Ver receta and Quitar. A note: **Editar nota** (a field in the sheet) and **Quitar nota**, never «Cambiar». Counted as `menu_sheet_action` on the `plato` sheet.
- **Below, what is of the meal:** Añadir plato · **Marcar la comida como cocinada** (today and past days; records a cook log for every recipe of the meal, once each — `mealCookRecipeIds` — and marks the meal eaten, «✓ Comido»; «¿Qué tal?» asks about the first the API asks for; on an eaten meal, «Desmarcar») · Más opciones (Comensales, que no cambie) · Quitar comida. No «Ver receta», «Cambiar plato» nor veto at the meal's level.

Tests: `mealSheetMultiDish.test.ts` (2 recipes + 1 note: titles, each row's options, the note without «Cambiar», the meal's options, the dish route's body), `e2e/meal-multi-dish.spec.ts` (390×844 and 1440×900, today's lunch of starter + main: the second's «···» → «Cambiar este plato» changes only the second, its «Ver receta» opens its own, dragging reorders, «Marcar la comida como cocinada» records both and leaves «✓ Comido»).

### Slot-level vs dish-level state

- **Slot-level** (unchanged surface): `servings`, `locked`, slot-DnD move (whole slot moves between (day, meal) via `POST /move-slot`).
- **Per-dish**: `course`, `variant: 'planned' | 'leftover' | 'freezer' | 'fridge' | 'cooked'`, `leftoverOf.dishPosition`, in-slot reorder via `PATCH .../dish/:position {newPosition}`.

`POST /menu/:menuId/day/:day/meal/:meal/leftover` clones only the recipe dishes of the source slot (notes are skipped — they don't propagate as "leftovers").

`PUT /menu/:menuId/day/:day/meal/:meal` (regenerate-meal) re-picks **only the recipe dishes** of the slot, preserving each dish's `course` and any `NoteDish` entries at their positions.

## Registro de cambios (PRO-149)

Cada cambio de los platos de un menú deja filas en `menu_edits` (migración `0056_menu_edits`), una por receta que sale o entra: hogar, menú, día (0-6), comida, acción, receta de antes y de después (id y nombre copiado), quién (`user` | `mimo`), canal (`web` | `whatsapp`) y fecha. Es la señal de la ficha viva del hogar (D-064): «quitó el ceviche y puso tortilla». **Generar el menú no es un cambio** (`POST /menu/generate` y `generate_weekly_menu` no escriben).
- Acciones por ruta: `PUT …/meal/:meal` y `…/dish/:position/regenerate` → `swap` (o `add` si el hueco estaba vacío); `POST …/meal/:meal`, `…/dish` y `…/dish/random` → `add` (`freezer` con `variant: 'freezer'`, PRO-82); `DELETE …/meal/:meal` y `…/dish/:position` → `remove`; `POST /ban` → `ban` (sin día, receta en «antes»); `POST …/leftover` → `leftover` (con `from_day`/`from_meal`); `POST /move-slot` → `move` (una fila por receta que cambia de sitio, en las dos direcciones si se intercambian); `POST …/skip` → `skip_day` (una por receta quitada, o una sin receta si el día estaba vacío).
- No dejan fila: bloquear, comensales, notas, tipo/orden de un plato, quitar un veto y reactivar un día.
- Un solo punto de escritura, `recordMenuEdits` (`services/menuEdits.ts`), llamado por cada ruta tras su `update`; nunca falla ni bloquea el cambio. **Mimo** entra por las mismas rutas (`assistant/appApi.ts` manda `x-mimoia-internal` y el canal en `x-mimoia-channel`), así que sus herramientas de `appSkills.ts` quedan como `mimo` con su canal. **Pendiente:** `swap_meal` escribe el menú directamente desde `assistant/skills.ts` y todavía no deja fila.
- `GET /menu/:menuId/edits` devuelve el registro del menú (más antiguo primero), con el mismo control de acceso que el resto de `/menu/:menuId`. Sin interfaz todavía.
- Se borra con el menú, con el hogar y con la cuenta de quien hizo el cambio (cascada). Tests: `menuEdits.test.ts`, `menuEditsRoute.smoke.ts`.
