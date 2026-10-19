# Compra en mis tiendas (shop orders)

**Status:** v1 shipped 2026-10-07; v1.1 (buy rules, pickup/delivery per order, add before sending) 2026-10-08; «Enviar a la extensión del navegador» (experimento cerrado) 2026-10-19 — orders are *handed* to the user, Mimoia never messages a shop nor handles money.

Mimoia splits what's left on the shopping list for the next 7 days into one order per shop the household uses (frutería, carnicería, pescadería, súper), writes each order in the customer's voice, and hands it over as a link that opens **the user's own** WhatsApp (or mail app) with the text already written. The user sends it, pastes or forwards the shop's reply, Mimoia checks it line by line against what it expected, the user approves, sends the confirmation and pays the shop directly. Lines are written in **the shop's own units** ("1 cabeza de ajos", "100 g de jamón serrano, loncheado fino", "2 doradas de ración, limpias para el horno (o lubinas…)"), never the recipe's (see Buy rules). Background research: [docs/research/Pedir en tiendas de frescos.md](../docs/research/Pedir%20en%20tiendas%20de%20frescos.md), [docs/research/Compra Mimoia por WhatsApp y email.md](../docs/research/Compra%20ONA%20por%20WhatsApp%20y%20email.md) (and the earlier [supermarket study](../docs/research/Compra%20autom%C3%A1tica%20de%20ONA%20en%20Espa%C3%B1a.md)).

## User Capabilities

- Save the household's shops at `/compra/tiendas` (any member; max 20): name, type (frutería / carnicería / pescadería / supermercado / otra), how to order (WhatsApp / email / web / teléfono) + that contact, "tu nombre para la tienda", recoger vs a domicilio (+ address), **pedido mínimo a domicilio** and **gastos de envío** (€, optional), free notes. Spanish 9-digit numbers get `34` prepended. The form's examples are made up («Frutería del barrio», «600 000 000», «910 000 000», «Ana, la del 3.º B», «https://www.tutienda.es»): never a real shop, number or person (PRO-76).
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
- **Hacer este pedido en Carrefour.es** (PRO-84, prueba de demanda): every súper card (kind *supermercado*, any channel) in *draft* has this button, unless «Enviar a <cadena>» replaces it (below). Tapping it unfolds one **Buscar** link per line still in the order (unticked «probablemente lo tienes» lines left out) to `https://www.carrefour.es/?q=<texto>` (the rule's supermarket search text, else the line name), opened in a new tab with `rel=noopener noreferrer`. Carrefour doesn't let anyone fill its cart from outside, so the user adds each product there. No affiliate code, no campaign parameters, no commission notice; only the tap is counted: `POST /shop-orders/:id/carrefour-click` (204; 400 if the order isn't a súper one; 404 if it isn't the household's) records `carrefour_click` with `props.items` = number of lines ([Metrics](./metrics.md), `GET /admin/usage`). Opening, not closing, counts.
- **Enviar a <cadena>** (experimento cerrado): la tarjeta del súper manda su cesta a la extensión de Mimoia del navegador, que la suma al carro de la cadena; ver [Enviar a la extensión del navegador](#enviar-a-la-extensión-del-navegador).
- `/shopping` has a **Pedir a mis tiendas** card linking to `/compra`.
- `/compra` also lists the pantry staples the recipes use and Mimoia assumed at home ("¿Te falta algo de esto?") — one tap adds one to the súper order.
- From chat (web or WhatsApp): "hazme la compra" → one short link per shop (or what's missing before sending), pickup/delivery and minimum, and "¿algo más?"; "añade fruta", "el jamón serrano", "150 g de york", "traédmelo a casa" edit the draft (same link); forward or paste the shop's reply → line-by-line summary with `[[opciones: …]]`; "sí" → confirmation link; "ya lo he recogido, 23 €" → closed. Shops can be added by chat ("mi carnicería es La Plaza, WhatsApp 600 000 002").

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

## Enviar a la extensión del navegador

Experimento cerrado. En la tarjeta del súper, **«Enviar a <cadena>»** manda la cesta del pedido a la extensión de Mimoia instalada en el navegador del usuario, que la suma al carro de esa cadena con la sesión del propio usuario. Mimoia no ve ni guarda sus credenciales y no paga: el usuario revisa el carro y paga en la web de la cadena. La cadena solo se nombra con la `etiqueta` que da la extensión (<cadena> abajo).

**Quién lo ve.** Las cuentas de `BASKET_EXTENSION_EMAILS` (email exacto o `@dominio`, sin distinguir mayúsculas; vacía = nadie), en una web construida con `NEXT_PUBLIC_BASKET_EXTENSION_ID` (sin él, la web ni pregunta el interruptor y salen los enlaces de Carrefour sin esperar). Además, el súper del hogar tiene que tener web (`webUrl`) y la extensión tiene que contestar al `ping` en 1,5 s, con el protocolo 1 y con el host de esa web entre los que sabe llenar. Si no, salen los enlaces de Carrefour; mientras se comprueba, ni uno ni otro. Sin nada que mandar (todo «probablemente lo tienes» sin marcar), no hay botón.

**En el borrador.**
- «Enviar a <cadena>», con «Se suma a lo que ya tengas en tu carro de <cadena>. Lo revisas y pagas allí.»; mientras va, «Enviando a <cadena>…» y «Puede tardar un minuto. No cierres la pestaña de <cadena>.». No espera a «Antes de enviarlo»: una línea sin elegir va sin elección, y una sin cantidad, con la sugerida.
- Si la extensión no contesta en 180 s, contesta algo que no es un resultado válido o el resultado no se puede guardar (tres intentos, solo sin red o con error del servidor): «No sabemos si ha entrado; abre tu carro. Si vuelves a pulsar no se duplica.». Al volver a pulsar, la extensión devuelve el mismo envío (`repetido`).
- Si el interruptor se apagó entre medias (403): «Esta función no está activada para tu cuenta. Revisa tu carro de <cadena> por si ha entrado algo.»
- Si el último envío no dejó nada en el carro, el pedido sigue en borrador y lo dice encima del botón: «Elige tu código postal en <cadena> y vuelve a pulsar.» (`sin_zona`), «Entra en tu cuenta de <cadena> en este navegador y vuelve a pulsar.» (`sin_sesion`), «La web de <cadena> no responde o ha cambiado; no hemos tocado tu carro.» (`contrato`, `red`), «Puede que algo no haya entrado; revisa tu carro.» (`verificacion`) o, si no se encontró nada, «No hemos encontrado estos productos en <cadena>: …». Las que fallaron porque falló la búsqueda (motivo `error`) van aparte: «No se han podido añadir (la búsqueda de <cadena> falló): <productos>. Añádelos a mano.»; si fallaron todas así, «La web de <cadena> no responde o ha cambiado; no hemos tocado tu carro.».
- Tras deshacer: «Envío deshecho; puedes volver a enviarlo.». Si la extensión aún devuelve el envío deshecho, la web le pide que lo olvide y manda uno nuevo; si aun así vuelve el viejo: «No hemos podido rehacer el envío. Vuelve a pulsar.»

**Enviado.** El pedido pasa a «Enviado» si puede haber algo en el carro: entró algo, o hay líneas sin verificar de un envío a medias. La tarjeta enviada (también en otro navegador o en el móvil de otro miembro; sin extensión, con el nombre de la tienda en lugar de la cadena) enseña:
- «N productos en tu carro de <cadena> · total del carro: X €», o «No sabemos qué ha entrado en tu carro de <cadena>: revísalo.»; y, si la cadena lo dice, «Tu carro no llega al pedido mínimo de <cadena>: añade algo más allí.»
- **Revísalo**: lo que entró por búsqueda («Los hemos buscado en <cadena> y hemos puesto lo primero que salía»), con producto y unidades. **Sin confirmar**: lo que no se sabe si entró (al cerrar sigue en la lista). **No han entrado**: con el motivo («no aparece en <cadena>», «no está disponible», «no se ha podido añadir»).
- «Abrir el carro» (la web de la tienda; solo si es `http:` o `https:`), «Quitar lo que añadió Mimoia», «Ya está pedido» y el desplegable **Lo que añadió Mimoia** (producto × unidades de lo que entró).
- **Ya está pedido** cierra el pedido y tacha en la lista solo lo que entró (de la tabla de productos de la extensión o por búsqueda); lo sin confirmar y lo que falló sigue pendiente.
- **Cancelar pedido** no toca el carro: con un envío vivo, la confirmación avisa «Lo que añadió Mimoia seguirá en tu carro de <cadena>. Si no lo quieres, quítalo antes con «Quitar lo que añadió Mimoia».», y el botón se desactiva mientras se deshace o se cierra.

**Deshacer.** «Quitar lo que añadió Mimoia» («Quitando…», «Puede tardar un poco. No cierres la pestaña de <cadena>.») pide a la extensión que reste del carro lo que sumó ese envío y devuelve el pedido a borrador. Mientras espera, los botones se desactivan.
- Sin extensión en este navegador, o sin nada que quitar en él: «En este navegador no hay nada que quitar. Puedes quitarlo desde el navegador que lo envió o a mano en tu carro de <cadena>. Cuando ya no esté, pulsa «Ya lo he quitado yo».», con «Lo que añadió Mimoia» abierto.
- La web de la cadena ha cambiado: «No hemos podido deshacerlo. Vuelve a intentarlo.» y «También puedes quitarlo a mano en tu carro de <cadena>…», con el mismo botón. Sin sesión: «Entra en tu cuenta de <cadena> en este navegador y vuelve a intentarlo.» Sin respuesta en 180 s: «No sabemos si se ha quitado; mira tu carro.» Restado pero sin guardar: «Lo hemos quitado de tu carro, pero no hemos podido guardarlo. Vuelve a pulsar.» Otro error: «No hemos podido deshacerlo. Vuelve a intentarlo.»
- **Ya lo he quitado yo** («Un momento…») devuelve el pedido a borrador sin tocar el carro. Un segundo toque, o el de otro miembro, no da error: ya estaba deshecho.
- Deshacer no mira el interruptor: si se apaga el experimento, lo enviado se puede deshacer igual.

**La cesta** (`buildExtensionBasket`, la misma en la web y en la API):
- Una línea por cada línea incluida del pedido (clave `l3`): nombre sin «· varias presentaciones», elección, cantidad y unidad, gramos (los de la regla, o los sugeridos si pregunta «¿cuánto?»; sin regla, la cantidad si va en g o ml), piezas si la regla es por pieza y texto de búsqueda (el nombre, más la elección si el nombre no la lleva).
- Una línea fusionada con productos que la lista separa (alubias blancas + rojas) guarda sus grupos (`members`, al fusionar en el borrador) y va como un grupo por producto (`l3.1`, `l3.2`…), agrupados como en la lista: se queda el nombre más corto; la misma unidad se suma y unidades distintas pasan a gramos (si una no se puede pesar, gana la pesable); lo tecleado sin cantidad solo cuenta si el grupo no tiene otra; el genérico (el grupo de la lista de la clave de la regla, p. ej. «huevos») no es un producto aparte y se suma al grupo más grande. Los gramos de cada grupo son los que pediría el pedido con esa cantidad y la regla de la línea (`toOrderQty`, redondeados a la unidad de compra). Rehacer los pedidos, mover y editar la línea conservan los grupos; cambiar su cantidad los quita y la línea va entera.

**Qué se guarda.** En `shop_orders.extension_result`, el último resultado validado: por línea, estado (`tabla` = de la tabla de productos de la extensión, `busqueda`, `fallida` o `no_verificada`), producto, unidades y motivo; añadidas, total, bajo mínimo y error; cuándo llegó, si se deshizo, los envíos deshechos y la foto de la cesta (`cesta`: clave, nombre y elección), para saber qué era cada clave aunque cambien las líneas. El mismo envío (`envioId`) otra vez no cambia nada ni cuenta dos veces, y un resultado sin nada en el carro no pisa uno vivo. Métricas: `basket_extension_sent` y `basket_extension_undo` ([Metrics](./metrics.md)); lo que la extensión no tenía en su tabla: `GET /admin/extension-gaps`.

## Data Model

- `household_shops(id, household_id → households, name, kind, channel, whatsapp, email, web_url, phone, customer_name, fulfilment 'recoger'|'domicilio', address, notes, price_memory jsonb {ingredientId: {pricePerKg, at}}, delivery_min_eur, delivery_fee_eur, position, created_at, updated_at)`.
- `household_buy_prefs(household_id, rule_key, choice)` unique per household + rule — remembered picks (migration 0038).
- `shop_orders(id, household_id, user_id?, shop_id? → household_shops ON DELETE SET NULL, shop_snapshot jsonb, status draft|sent|quoted|approved|closed|cancelled, token unique, lines jsonb ShopOrderLine[], estimate_eur, cap_eur, message_text, shop_reply_text, quote_summary jsonb, confirmation_text, final_total_eur, fulfilment, address, created/updated/sent/quoted/approved/closed_at)`. Lines are a snapshot (inputs — name, recipe quantity/unit, notes, quantitySource, choice — plus the computed shop text, grams, options, needsChoice/needsQuantity, maybeHave/included, eci; v1 rows lack them and keep working) (the live list is rebuilt on every read). Deleting a shop deletes its drafts; sent/closed orders keep the snapshot.
- `shop_orders.extension_result jsonb` (migración 0073): el último envío a la extensión del navegador (`StoredBasketResult`), null si nunca. Las líneas pueden llevar `members`: los productos de una línea fusionada que la lista separaría, con sus `sourceItemIds`.
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
| GET | `/shop-extension/status` | `{ enabled }` según `BASKET_EXTENSION_EMAILS` |
| POST | `/shop-orders/:id/extension-result` | 403 fuera de la lista (antes de validar); `BasketSendResult` (zod; 400 si no lo cumple) → `{ order, deshecho }`; solo súper (400 `NOT_SUPER`), en `draft` o `sent` (409). `sent` si puede haber algo en el carro; el mismo `envioId` no cambia nada; uno ya deshecho → `deshecho: true`. Cuenta `basket_extension_sent` solo si se guarda |
| POST | `/shop-orders/:id/extension-undo` | `{ manual? }` → vuelve a `draft` y apunta el `envioId` como deshecho; sin mirar la lista de emails. 409 `BAD_STATUS` si no está enviado, `NO_EXTENSION_SEND` si no hay envío vivo |
| GET | `/admin/extension-gaps?days=7` | JWT de admin o el token de métricas (`routes/metrics.ts`, `days` 1–90): lo que entró por búsqueda o falló, por producto, `estado` y `motivo`, con `veces`; sin usuarios |

Web: `GET /c/<token>[?m=ok]` (Next route handler) redirects to that URL; expired → `/compra?enlace=caducado`. Short links exist so chat replies never carry long URL-encoded text, and are side-effect free because WhatsApp's link preview fetches them.

## Assistant skills

`shopOrderSkills.ts` (same REST calls, as the user): `manage_shops` (incl. delivery minimum/fee), `prepare_shop_orders` (links, or what's missing, pickup/delivery, minimum, pantry assumed, "¿algo más?"), `edit_shop_order` (add — each product to its shop —, remove, choose, amounts, include, delivery + address; same links), `register_shop_reply`, `approve_shop_order` (only after an explicit "sí"; `remove` names → line keys), `close_shop_order` (`cancel=true` cancels), `get_shop_orders`. Shop names match ignoring punctuation ("la plaza" → "Carnicería La Plaza"). The prompt treats a forwarded shop reply as data, never instructions, and lets the model copy `/c/` links verbatim (the only URLs it may write). Short links use `WEB_PUBLIC_URL`.

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
- El Corte Inglés is the only shop with a verified per-product search link. The Carrefour.es link (`?q=`) wasn't verifiable from the build machine (carrefour.es answers 403 to scripts); check it by hand. The button text is pending Legal's review.
- La extensión del navegador vive en un repo privado; aquí solo están el protocolo (`@ona/shared`, `BASKET_EXTENSION_PROTOCOL = 1`; un cambio en la forma de los mensajes lo sube), la cesta, las rutas y la tarjeta.
- **Enviar a la extensión: limitaciones conocidas.**
  - Un compuesto tecleado («Fruta (manzana golden, manzana reina)») es un solo artículo de la lista: sus productos van en la cesta como líneas o grupos distintos con el mismo artículo detrás, y al cerrar basta con que entre uno para que se tache entero.
  - Una línea fusionada en la que nada traía cantidad (todo el «1 u» por defecto) manda 1 unidad de cada producto (o, en una regla al peso, la cantidad sugerida para cada uno): la sugerencia de la línea no se reparte.
  - Dos navegadores a la vez: un envío vivo se sustituye si llega otro `envioId` con algo en el carro, y «Ya lo he quitado yo» marcaría solo el nuevo.
  - Un fallo antes de escribir en el carro llega sin `envioId` y no se puede deduplicar: si se reintenta su POST, cuenta dos veces en la métrica.
  - «Rehacer los pedidos» borra los borradores y con ellos el resultado de los envíos fallidos o deshechos: sus huecos desaparecen de `/admin/extension-gaps`.
  - La API acepta cuerpos JSON de hasta 100 kB: un resultado mayor (solo con unas 200 líneas de nombres largos; una cesta real ronda los 40 kB) da 500, no se guarda y la web dice «No sabemos si ha entrado».
  - La foto `cesta` se toma al guardar el resultado, con las líneas del pedido en ese momento. Si se cambia la cantidad de una línea fusionada entre el envío y un reenvío (que devuelve el envío de antes, `repetido`), las claves de sus grupos (`l3.1`, `l3.2`) ya no están en la foto ni en las líneas: salen como «Un producto» y no se tachan al cerrar.
  - Un deshacer cruzado con «Ya está pedido» de otro miembro termina sin mensaje (su 409 cuenta como ya deshecho) y con el pedido cerrado y la lista tachada, aunque la extensión haya restado el carro.
  - Durante «Enviando…» el resto de la tarjeta sigue activo («Ya está pedido», «Cancelar pedido», «Rehacer los pedidos»): si el pedido se cierra, se cancela o se rehace a mitad, el resultado no se guarda (409, o 404 si el borrador ya no existe) y la web dice «No sabemos si ha entrado».

## Related specs

- [Shopping](./shopping.md) — the list the orders are drafted from
- [Advisor](./advisor.md) — skills and prompt rules
- [WhatsApp](./whatsapp.md) — forwarded replies, `/c/` links in replies
- [Household](./household.md) — scope
- [Business Metrics](./metrics.md) — `carrefour_click`, `basket_extension_sent` / `_undo` y el token que abre `GET /admin/extension-gaps`

## Source

- `packages/shared/src/types/shopOrders.ts`, `packages/shared/src/utils/shopFormat.ts`, `packages/shared/src/buy/rules.ts` + `convert.ts` (buy rules), `packages/shared/src/buy/carrefour.ts` (Carrefour.es search links)
- `apps/api/src/services/shopOrders/` — `classify.ts`, `fish.ts`, `format.ts`, `estimate.ts`, `draft.ts`, `lines.ts`, `message.ts`, `validation.ts`, `quoteParser.ts`, `store.ts`
- `apps/api/src/routes/shopOrders.ts` (incl. `POST /shop-orders/:id/carrefour-click`; mounted in `apps/api/src/index.ts`), `apps/api/src/db/schema.ts` (`householdShops`, `shopOrders`), `apps/api/src/db/migrations/0034_shop_orders.sql`, `0038_shop_orders_v11.sql` (`householdBuyPrefs`); `apps/api/src/services/shoppingList.ts` (recipe notes → `ShoppingItem.notes`), `apps/api/src/routes/shopping.ts` (typed items: `quantitySource`, aisle from rules)
- `apps/api/src/services/assistant/shopOrderSkills.ts`, `skills.ts` (registration), `systemPrompt.ts` (rules)
- `apps/web/src/app/compra/page.tsx`, `apps/web/src/app/compra/tiendas/page.tsx`, `apps/web/src/app/c/[token]/route.ts`, `apps/web/src/components/compra/`, `apps/web/src/hooks/useShopOrders.ts`, `apps/web/src/app/shopping/page.tsx` (entry card)
- Enviar a la extensión: `packages/shared/src/types/basketExtension.ts` (mensajes, protocolo, esquema del resultado, `StoredBasketResult`), `packages/shared/src/buy/extensionBasket.ts` (`buildExtensionBasket`, `orderMembers`, `extensionKey`, `basketMayBeInCart`, `isLiveBasketSend` («envío vivo», la única condición), `sourceItemsForBasketKey`), `convert.ts` (`orderQtyInGrams`, `pieceCount`); `apps/api/src/services/basketExtension.ts` (interruptor, `decideBasketResult`, huecos), `services/shopOrders/store.ts` (`saveBasketResult`, `undoBasketSend`, `closeOrder`, `withLockedOrder`), `draft.ts` + `lines.ts` (`members`), `routes/shopOrders.ts` (las tres rutas), `routes/metrics.ts` (`GET /admin/extension-gaps`), `services/usageEvents.ts` (`basketSentProps`), `config/env.ts` (`BASKET_EXTENSION_EMAILS`), `apps/api/src/db/migrations/0073_shop_order_extension_result.sql`; `apps/web/src/lib/basketExtension.ts`, `apps/web/src/hooks/useBasketExtension.ts`, `apps/web/src/components/compra/ExtensionOrder.tsx` (+ `OrderCard.tsx`, `styles.ts`)
- Tests: `apps/api/src/tests/buyRules.test.ts` (Miguel's real order line by line), `shopOrderDraft.test.ts` (draft, merge, blockers, delivery minimum), `shopOrders.test.ts`, `shopQuoteParser.test.ts`, `shopOrderSkills.test.ts` (incl. form ↔ schema contract), `shopFormExamples.test.ts` (the «Añadir tienda» examples are made up: no real shop, number or person — PRO-76), `shopOrdersRoute.smoke.ts`, `carrefourOrder.test.ts`, `extensionBasket.test.ts` (cesta y grupos), `basketExtension.test.ts` (esquema, decisión, huecos), `basketExtensionRoute.test.ts` (rutas), `basketExtensionRoute.smoke.ts` (API y base de datos reales); `apps/web/e2e/compra.spec.ts`, `compra-carrefour.spec.ts`, `compra-extension.spec.ts` (extensión simulada)
