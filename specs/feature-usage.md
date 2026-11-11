# Uso de cada función por hogar

PRO-1023 · D-122, punto 4: para proponer a cada persona un truco en la newsletter hay que saber, por hogar y función, la primera y la última vez y cuántos usos lleva (en 30 días y en total). `usage_events` ([metrics.md](./metrics.md)) solo guarda 180 días; esta tabla guarda las cifras de cada función y sigue sumando después.

## Catálogo de funciones (`FEATURE_CATALOG`)

En `packages/shared/src/constants/featureCatalog.ts`, una entrada por truco:

- `id`: estable, es la clave de las filas guardadas (`menu_semanal`, `receta_foto`, `mimo_whatsapp`…).
- `nombre`: cómo se llama la función para un hogar.
- `kind`:
  - `accion`: cada evento es un uso;
  - `ajuste`: algo que se deja puesto y actúa solo; cuenta **una vez por semana** (lunes a domingo, Europe/Madrid) en que actuó.
- `per`: `hogar` (una fila por hogar) o `persona` (una por persona y hogar).
- `events`: qué eventos cuentan. Un evento cuenta si coincide con alguna regla: el `name` y, si la regla los trae, el `channel` y las `props` (todas las claves; una lista es «cualquiera de estos valores»).

Las entradas de hoy salen de los eventos que ya existen:

| id | Función | Tipo | Por | Eventos |
|---|---|---|---|---|
| `menu_semanal` | Menú de la semana | acción | hogar | `menu_generated` |
| `cambiar_plato` | Cambiar un plato del menú | acción | hogar | `meal_swapped` |
| `lista_compra` | Lista de la compra | acción | hogar | `shopping_list_viewed` |
| `marcar_lista` | Tachar en la lista | acción | hogar | `shopping_item_checked` |
| `receta_enlace` | Receta desde un enlace | acción | hogar | `recipe_imported` con `source` url / whatsapp_url / social |
| `receta_foto` | Receta desde una foto | acción | hogar | `recipe_imported` con `source` photo / whatsapp_photo |
| `receta_escrita` | Escribir una receta | acción | hogar | `recipe_created` |
| `modo_cocina` | Modo cocina | acción | hogar | `cook_mode_started` |
| `marcar_cocinado` | Marcar lo que habéis comido | acción | hogar | `meal_cooked` |
| `mimo_chat` | Mimo en la app | acción | persona | `mimo_message` web |
| `mimo_whatsapp` | Mimo por WhatsApp | acción | persona | `mimo_message` whatsapp |
| `mimo_voz` | Mimo en voz alta | acción | persona | `mimo_message` voice |
| `mimo_nota_voz` | Notas de voz a Mimo | acción | persona | `mimo_message` whatsapp con `kind` voice_note |
| `pedido_tiendas` | Pedido a tus tiendas | acción | hogar | `shop_order_prepared` |
| `pedido_carrefour` | Pedido en Carrefour.es | acción | hogar | `carrefour_click` |
| `cesta_extension` | Cesta con la extensión | acción | hogar | `basket_extension_sent` |
| `afinar_menu` | Afina tu menú | acción | persona | `taste_tuning` terminado |
| `invitar_hogar` | Invitar a otro hogar | acción | persona | `invite_shared` |
| `app_instalada` | La app instalada | ajuste | hogar | `app_opened_installed` (una vez por hogar y día) |
| `avisos` | Avisos en el móvil | ajuste | persona | `push_opened` |

Añadir un truco es añadir una entrada; sus usos de los últimos 180 días se cuentan la primera noche. Un test (`featureUsage.test.ts`) comprueba que los ids no se repiten y que cada evento y canal existe en `USAGE_EVENTS` / `USAGE_CHANNELS`.

## Tabla `household_feature_usage`

Migración aditiva 0097. Una fila por hogar (o persona) y función:

| Columna | Qué |
|---|---|
| `household_id` | el hogar del evento (CASCADE) |
| `user_id` | null en las funciones del hogar; la persona en las de `persona` (CASCADE) |
| `feature` | el `id` del catálogo |
| `first_used_at`, `last_used_at` | primer y último evento que contó |
| `uses_30d` | usos en los 30 días de Madrid antes de `counted_until` (un ajuste: semanas en que actuó) |
| `uses_total` | usos desde el primero, también los de eventos ya borrados |
| `counted_until` | los eventos anteriores a este instante ya están contados |

Único por `(household_id, COALESCE(user_id, 0…0), feature)`. Solo cifras y fechas: ni props ni texto. Se borra con el hogar y con la cuenta (borrar la cuenta borra sus filas de persona y, si era su único miembro, el hogar con las suyas). Sin uso, no hay fila.

## La pasada nocturna (`services/featureUsage.ts`)

`runFeatureUsagePassIfDue` en el tick del planificador (`notificationScheduler.ts`), una vez por día de Madrid y proceso, desde la 01:00 y antes de la purga de eventos. Para cada función, en una transacción con un cerrojo (`pg_try_advisory_xact_lock`; si otra pasada corre, esta no hace nada):

1. Lee las filas guardadas y su `counted_until`; si ya llega a las 00:00 de hoy, la salta.
2. Suma los eventos nuevos, de `counted_until` a las 00:00 de hoy (Madrid): una acción, uno por evento; un ajuste, uno por semana con algún evento, sin volver a contar la semana de su `last_used_at`.
3. Recalcula `uses_30d` con los eventos de los últimos 30 días.
4. Guarda todas las filas de la función con `counted_until` = las 00:00 de hoy.

Los eventos de hoy esperan a la noche siguiente. Por hogar cuenta cualquier evento con hogar (también de una cuenta ya borrada); por persona, solo los que tienen persona.

## Uso de funciones en el admin (PRO-1025)

D-122, punto 5. `GET /admin/feature-usage?days=30[&includeInternal=1]` (`routes/metrics.ts`, `services/featureUsageReport.ts`), con el JWT de admin o el token de métricas (`x-metrics-token`), lo mismo con los dos: solo agregados, nunca ids ni textos.

- `days`: de 1 a 180 (30 por defecto); la ventana son esos días ya contados, hasta las 00:00 de hoy (Madrid).
- `base`: hogares con algún miembro contado y personas contadas en un hogar. Sin cuentas de admin ni suspendidas (ni sus filas de persona), salvo `includeInternal=1`.
- `features`: una fila por función, en el orden de `FEATURE_CATALOG`, también sin uso (con ceros). `unit` es `hogares` en las del hogar y `personas` en las de persona, y es la unidad de:
  - `users`: la han usado alguna vez; `active`: en los últimos `days` días (`last_used_at`); `lapsed`: la usaron, pero no en esos días; `never`: de la base, nunca;
  - `households`: hogares distintos (en las de persona, con alguien que la usa);
  - `uses30d` (siempre los 30 días de la tabla, aunque cambie `days`) y `usesTotal`;
  - `medianDaysSinceLast`: mediana de días desde la última vez; `share`: `users` / base.
- `tricks` («Trucos de la newsletter»): las funciones con alguien a quien proponerlas, de más a menos `never`, y después `lapsed`.
- **«menos de 5»**: una cifra de hogares o personas de 1 a 4 sale `"menos de 5"` en vez del número (`0` sale `0`). Si los que usan una función son de 1 a 4, también salen así sus usos, la mediana, `active`, `lapsed` y `households`, y `share` es null.
- `countedUntil`: hasta dónde llegó la última pasada (null si aún no hay filas).

La pantalla es `/admin/funciones` («Uso de funciones» en el menú del admin, `FeatureUsageSection.tsx`): los filtros (7, 30 o 90 días; acciones o ajustes; por hogar o por persona; orden del catálogo, más o menos usadas), una tarjeta por función con sus cifras y el bloque «Trucos de la newsletter» con, por función, cuántos no la han usado nunca y cuántos la dejaron. «Menos de 5» se pinta tal cual llega de la API.

## Las hojas del menú (PRO-1174)

Para decidir qué opciones de las hojas «···» del menú se quedan a la vista (propuesta de Producto del 2026-11-11, «Las hojas «···» del menú»; menú: [Menus](./menus.md)), cada toque en una opción deja un evento `menu_sheet_action` (`POST /usage/event`, solo web) con dos palabras de una lista cerrada, `MENU_SHEET_ACTIONS` (`packages/shared/src/constants/menuSheets.ts`): la hoja (`sheet`) y la opción (`action`). Cuenta el toque, antes de cualquier confirmación («¿Vetar…?», «¿Quitar…?»). La API guarda solo opciones de esa hoja: otra palabra, o una opción de otra hoja, no se guarda.

| `sheet` | Dónde | `action` |
|---|---|---|
| `comida` | hoja de una comida con un plato (`MealOptions`, día y escritorio) | `ver_receta`, `elegir_receta`, `cambiar_azar`, `sobras_si` / `sobras_no`, `anadir_plato`, `tipo`, `fijar` / `desfijar`, `vetar`, `cocinada` / `desmarcar_cocinada`, `taper_si` / `taper_no`, `comensales_menos` / `comensales_mas` / `comensales_quitar`, `quitar_comida` |
| `comida_varios` | la misma hoja con varios platos o con una nota | las de `comida` y `ordenar_platos` (arrastrar) |
| `plato` | cada plato de esa lista | `ver_receta` (la miniatura), `cambiar_azar` («Cambiar»), `quitar_plato`, `editar_nota` |
| `vacio` | la hoja de una comida sin plato | las de `comida` (se ven `anadir_plato`, `fijar`, comensales y `quitar_comida`) |
| `no_hay` | «El viernes no hay cena» → «Sin plato todavía» | `elegir_receta`, `cambiar_azar` («Una al azar»), `congelador`, `taper_nevera` |
| `dia` | pie del día y su hoja «Añadir comida» | `anadir_comida`, `congelador`, `taper_nevera`, `saltar_dia`, `reactivar_dia` (también en la vista semana y en escritorio), `levantar_veto` |
| `semana` | la hoja «···» de la semana | `semana_anterior`, `semana_siguiente`, `volver_semana`, `regenerar`, `favoritas`, `compartir`, `imprimir`, `vista_semana` / `vista_dia`, `historial`, `vaciar` |
| `semana_fila` | el menú «···» de una fila de la vista semana | `elegir_receta`, `cambiar_azar` («Aleatorio»), `anadir_plato`, `fijar` / `desfijar` («Bloquear»), `vetar`, `quitar_comida` («Quitar slot») |

`GET /admin/usage` (y `data/uso` en Mimoia HQ) lo devuelve en `menuSheetActions`: por hoja, el total y los toques de cada opción, las más tocadas primero (las ocho hojas, también sin uso), y en `breakdown.menu_sheet_action` por `sheet` y por `action` sueltos. En `breakdown.meal_swapped` se ve cuántos cambios fueron al azar (`how: auto`) y cuántos elegidos (`picked`), de la comida (`target: meal`) o de un plato (`dish`), de la web y de Mimo. Solo recuentos. No es una función del catálogo: no entra en `household_feature_usage`.

## Tests

- `featureUsageReport.test.ts` (router de métricas de verdad, base de datos de mentira): cerrada sin credenciales; una fila por función del catálogo, en su orden; una celda con 3 hogares sale «menos de 5», con sus usos; en la respuesta no hay ids ni textos (ni los que traiga de más la consulta); los trucos, de más a menos; `days` acotado y sin cuentas internas por defecto. `tokenRoutes.test.ts` fija la ruta entre las del token.
- `e2e/admin-feature-usage.spec.ts`: `/admin/funciones` con una respuesta fijada (filas, filtros, orden, trucos y «menos de 5»), con la API de verdad y desde el menú del admin en escritorio.
- `featureUsage.test.ts` (repo en memoria que imita el SQL): una acción suma un uso; volver a pasar la misma noche no suma; un ajuste cuenta una vez por semana (el domingo a las 23:30 de Madrid es aún esa semana); `uses_total` sobrevive a borrar los eventos y los 30 días bajan; filas por hogar y por persona; filtro por props; la ventana con el cambio de hora; una vez al día desde la 01:00; el catálogo.
- `menuSheetAction.test.ts` (PRO-1174): por hoja, cada opción es un `menu_sheet_action` válido y su componente la manda; una opción fuera de la lista (o de otra hoja) no se guarda; `meal_swapped` se desglosa por `how` y `target`; `menuSheetActions` cruza hoja y opción. `usageRoute.smoke.ts` lo comprueba con el SQL de verdad, y `e2e/menu-sheet-actions.spec.ts` abre la hoja de una comida a 390×844 y a 1440×900, toca «Ver receta» y espera el evento contado.
- `featureUsage.smoke.ts` (Postgres, CI): lo mismo con el SQL de verdad sobre un hogar propio, y borrar la cuenta (y su hogar) borra las filas.

## Pendiente

- Con los datos de las hojas (PRO-1174), Producto decide qué opción queda a la vista y cuál baja a «Más opciones» (PRO-1175 y siguientes).

- La lee el admin (`/admin/funciones`, arriba); la usará también la newsletter del n.º 4 (truco por persona).
- Ajustes que no dejan evento (comidas fijas, menú del cole…) necesitan antes su evento.
