# «Cocinar ahora» — diseño

**Fecha:** 2026-11-03 · **Estado:** aprobado por Miguel en la sesión del 2026-11-03 (pestaña propia; Mimoia elige y Mimo explica; una receta preferente y dos alternativas; despensa confirmada como pregunta; los ingredientes secundarios no descartan recetas; el catálogo lo marca la oficina, no la API, también cada receta nueva). **Construido** en PRO-1105 a PRO-1109: lo que cambió al construirlo, en §10.

## Para qué

Que alguien que llega a casa sin plan, o con el plan del día pero sin ganas, pueda decidir en un minuto qué cocina **ahora** con lo que tiene, abrir la receta en el modo cocina y que el menú de la semana quede al día solo («✓ Comido»).

Casi todas las piezas existen ya y viven repartidas: Mimo contesta «¿qué hago hoy con lo que tengo?» por chat y WhatsApp, Recetas tiene el filtro «Con lo que tengo», Menú tiene la tarjeta «Con lo que tienes» y la despensa vive escondida en Perfil. Esta función las junta en una pantalla y cierra un hueco: hoy el modo cocina, al «Terminar», apunta la receta como cocinada (`POST /cook-logs` con `{ recipeId, servings }`) pero no se lo dice al menú.

## 1. La pestaña «Cocinar» (`/cocinar`)

- La barra de abajo pasa a 5 pestañas: **Menú · Cocinar · Compra · Recetas · Perfil**. En escritorio, la misma entrada en la barra lateral. Página solo con sesión (fuera de la lista de páginas abiertas de `routeAccess`).
- **La comida de ahora:** la primera comida de hoy, desde la que marca la hora (comida hasta las 16:00 hora de Madrid, después la cena: la regla de Mimo, `nextMealNow`), que **no esté comida**. Si la comida ya está comida, es la cena. Si las dos lo están, no hay comida de ahora (ver §4).
- Lo que se ve al entrar, de arriba abajo:
  1. **Lo que tocaba**, si la comida de ahora tiene una receta en el menú: «Hoy tocaban *Lentejas* · 40 min» con «Empezar a cocinar» (modo cocina con el contexto del menú, ver §4).
  2. **«¿Otra cosa? Cocinar ahora»** (o «Cocinar ahora» a secas si no había nada): abre las preguntas (§2).
  3. **«Con lo que tienes»**: la tarjeta que hoy está en `/menu`, que se muda aquí y deja de estar en el Menú. Pasa a usar la búsqueda de §3 con las respuestas por defecto (sin límite de tiempo, comensales de casa, «solo lo que hay»), para que no se contradiga con la propuesta. Igual que hoy: tocar una fila abre la receta; despensa vacía o sin coincidencias, la tarjeta no sale.
  4. **«Tu despensa»**: la despensa entera (nevera, congelador, despensa), la misma de `/profile/pantry`, que se muda aquí. `/profile/pantry` redirige a `/cocinar#despensa` y el enlace de Perfil apunta aquí.
- En la tarjeta de hoy de `/menu`, un enlace discreto «¿Otra cosa? Cocinar ahora» lleva a `/cocinar`.

## 2. Las preguntas (una por pantalla)

| Paso | Pregunta | Forma | Por defecto |
|---|---|---|---|
| 1 | **¿Cuánto tiempo tienes?** | 15 min · 30 min · 45 min · 1 h o más (un toque y avanza) | — |
| 2 | **¿Para cuántos?** | contador − / + y «Seguir» | los comensales que el menú usa para esa comida |
| 3 | **¿Puedes comprar algo?** | «Solo lo que hay» · «Sí, algo» (un toque y avanza) | — |
| 4 | **Confirma tu despensa** | lista editable y «Proponme una receta» | la despensa del hogar |

- **Confirma tu despensa:** agrupada por Nevera → Congelador → Despensa; la Despensa sale plegada. Cada fila deja cambiar la cantidad (− / + o tocar y escribir) y quitarla; «Añadir» usa el buscador del catálogo de ingredientes (como «Con lo que tengo»), para que lo añadido cuente en la búsqueda. **Cada cambio se guarda en la despensa real** al momento (`PATCH/POST/DELETE /pantry`): confirmar la despensa es también tenerla al día. Despensa vacía → el paso se titula «¿Qué tienes en casa?» y abre directamente el buscador.
- No se pregunta: si es comida o cena (sale de la hora), alergias, dieta, lo que no gusta ni aparatos de cocina (ya los sabemos por la ficha del hogar).
- «Atrás» en cada paso; las respuestas se mantienen al volver.

## 3. La búsqueda y la propuesta

### Imprescindibles y secundarios

Cada ingrediente de una receta es **imprescindible** (el pollo, la pasta, las lentejas: sin él no es ese plato) o **secundario** (perejil, comino, el limón del final, el queso de gratinar), y puede tener **sustitutos** (otro ingrediente del catálogo que vale en su lugar: nata → leche).

- **Dato nuevo** en `recipe_ingredients`: `role` (`essential` | `secondary` | `null` = sin marcar) y `substitute_ingredient_ids` (uuid[], vacío por defecto). Migración aditiva. Es independiente del texto libre `recipes.substitutions` de la pestaña Notas, que sigue igual (la oficina puede leerlo al marcar).
- **Quién lo marca: la oficina** (departamento de Cocina), con Claude Code de la oficina y **nunca con la clave de la API de producción**. Solo **el catálogo de Mimoia** (`author_id IS NULL`, borradores incluidos, para que el marcado llegue antes de publicar).
  - **Una pasada sobre todo el catálogo**, repartida en varias noches para no agotar la cuota.
  - **Cada receta nueva, en el proceso que la crea:** las tandas JSON de Cocina traen el marcado escrito en cada ingrediente (`imprescindible: true|false`, `sustitutos: [nombres]`; un sustituto que no casa con el catálogo se descarta y se avisa en el informe de la tanda, nunca crea un ingrediente ni rechaza la receta). Las demás recetas nuevas del catálogo (tandas desde fotos de libros, arreglos de Cocina) las recoge una tarea nocturna de Cocina que marca todo lo que tenga `role = null`.
  - Superficie para la oficina: `GET /admin/recipes/ingredient-roles/pending?limit=N` (recetas del catálogo con algún ingrediente sin marcar, con sus ingredientes) y `PUT /admin/recipes/:id/ingredient-roles` (`[{ recipeIngredientId, role, substituteIngredientIds }]`, validado con zod de `@ona/shared`), con las credenciales de admin que la oficina ya usa.
  - **Las recetas propias de los hogares no pasan por la oficina:** usan la regla automática. Meterlas exige antes cambiar `privacy.md` y la revisión de Legal; queda fuera de esta versión.
- **El marcado sobrevive a las ediciones.** Al guardar una receta editada (`persistRecipe` en modo edición borra y vuelve a insertar sus ingredientes), cada ingrediente que sigue en la receta conserva su `role` y sus sustitutos: se casa primero por el id de la fila (la edición ya lo devuelve) y, si no, por `ingredient_id` (un mismo ingrediente puede salir dos veces, en dos secciones); los nuevos entran sin marcar y la tarea nocturna los marca. Las dos formas de copiar una receta (el «Añadir a mis recetas» de la web, en `routes/recipes.ts`, y el de Mimo, en `assistant/skills.ts`) copian el marcado. El formulario de edición no lo enseña ni lo manda.
- **Regla automática**, mientras un ingrediente no está marcado (pura, en el mismo servicio): una línea `optional`, «al gusto» o «pizca» es secundaria; si la categoría del ingrediente es proteína, cereal o legumbre, imprescindible; si no, imprescindible cuando la línea pesa al menos el 15 % de los gramos de la receta (u y ml pasados a gramos con `unitWeight` / `density`; una línea que no se puede pasar a gramos no cuenta en el total y es secundaria). `category` puede ser nula (los ingredientes creados al importar no la llevan): entonces decide solo el peso. Los básicos (sal, aceite, agua, pimienta, harina: `BASIC_TERMS`) no cuentan nunca.

### Qué cuenta como «lo tienes»

Un ingrediente de la receta está cubierto si:
- está en la despensa con cantidad > 0 (por `ingredient_id`, con la misma coincidencia por palabra que «Con lo que tengo»), **o**
- está en los **básicos del hogar** activos (`household_staples`, texto libre: casan por palabra con el nombre del ingrediente, como «Con lo que tengo»), **o**
- alguno de sus sustitutos está en la despensa (solo presencia, sin mirar cantidad).

**Cantidades (solo imprescindibles):** si la despensa y la receta usan la misma unidad y lo que hay es menos de lo que pide la receta escalada a las personas del paso 2, cuenta como falta («te falta un poco de arroz»). Con unidades distintas se da por suficiente (convertir queda fuera, ver §6).

### Filtro

1. Solo recetas que el hogar puede comer: mismo cargador que el menú (alergias, dieta y lo que no gusta de **todos** los miembros, vetos de la semana, aparatos que faltan, borradores fuera), plato principal o versátil (`course = 'main'` o `null`, como el menú de un plato), y apta para esa comida.
2. **Tiempo total** (lo que tarda hasta comer, con horno y reposos). Cabe si `totalTime ≤ T`; entra con la marca «unos minutos más» si `T < totalTime ≤ 1,2 × T`. «1 h o más» no pone límite. Sin `totalTime` no entra.
3. **«Solo lo que hay»:** todos los imprescindibles cubiertos; los secundarios pueden faltar. Si así no sale ninguna, se enseñan las que tienen **un** imprescindible sin cubrir, con la línea «Con lo que hay justo no sale ninguna; a estas les falta una cosa».
4. **«Sí, algo»:** hasta 2 imprescindibles sin cubrir.
5. Fuera las valoradas «Mejor no» por el hogar.

### Orden

Cada criterio solo desempata el anterior:

1. Las que caben en el tiempo antes que las de «unos minutos más».
2. Menos imprescindibles sin cubrir.
3. Más ingredientes cubiertos por la despensa, contando doble los que caducan en 3 días o menos.
4. Menos secundarios sin cubrir.
5. Valoradas «Repetir a menudo» antes; cocinadas en los últimos 7 días, después.
6. Por nombre.

### La propuesta

- **Una receta preferente** (foto grande, nombre, tiempo, «No te falta nada» / «Puedes hacerla sin: perejil, comino» / «Te falta: pollo» / «Cambia la nata por leche») **y dos alternativas** debajo (nombre, tiempo y la misma línea corta). Exactamente tres; si hay menos, las que haya.
- **La frase de Mimo** en la preferente: una línea corta escrita solo con datos que se le pasan (qué ingredientes de la despensa usa, cuáles caducan, cuándo se cocinó por última vez, su valoración). Llega después de pintar la tarjeta, no la retrasa; si falla o tarda más de 5 s, no sale. Es la única llamada a la IA en vivo de la función (el modelo de Mimo, Opus 5.5). Se apunta en `cost_events` como `cook_now_phrase`; no gasta del tope mensual de Mimo; una cuenta en pausa no la recibe.
- **«Cambiar respuestas»** vuelve a las preguntas.
- **Ninguna receta** con esas respuestas: «Con esto no encuentro nada» y «Cambiar respuestas».

### Superficie

- `POST /cook-now/proposal` (con sesión) · cuerpo `{ minutes: 15 | 30 | 45 | null, servings: number, canBuy: boolean }` (zod en `@ona/shared`; la despensa se lee en el servidor, ya guardada en el paso 4) → `{ meal, items: [{ recipe (forma de tarjeta), fit: 'fits' | 'margin', missingEssential: string[], missingSecondary: string[], substitutions: [{ missing, use }] }], fallback: boolean }` con 0–3 elementos, el primero el preferente.
- `POST /cook-now/phrase` (con sesión) · `{ recipeId }` → `{ text: string | null }`.
- `POST /cook-now/choose` (con sesión, cuenta activa como el resto de escrituras del menú) · `{ recipeId, servings, displacedTo: number | null }` → en una sola escritura, mueve los platos de receta planeados de la comida de ahora a `displacedTo` (día 0–6 de esa semana, misma comida, conservando sus ajustes) o los quita si es `null`, y pone la receta (§4). Devuelve `{ menuId, day, meal, locked: boolean }`. La hoja de §4.2 se contesta **antes** de esta llamada, con el menú que la web ya tiene cargado.
- `GET /recipes/match-pantry` y `services/pantryMatcher.ts` se retiran (también su entrada en `routeTemplates.ts`): la tarjeta «Con lo que tienes» usa `POST /cook-now/proposal` con las respuestas por defecto.

## 4. «Cocinar esta» y el menú

1. **La receta entra en la comida de ahora** (§1) con las personas del paso 2 como raciones de ese hueco, y **sustituye todos sus platos** (como hace Mimo al elegir). Si esa semana no tiene menú, se crea una fila de menú solo con ese plato (como ya hace Mimo).
2. **Si había platos de receta planeados** en ese hueco (no sobras, ni tápers, ni platos «Del congelador», ni notas: esos se sustituyen sin preguntar), al pulsar «Cocinar esta» y antes de guardar nada, una hoja pregunta «¿Y las *lentejas*?» (si eran varios, van juntos); su respuesta viaja en la misma llamada (`displacedTo`):
   - **«Pasarlas a otro día»**: elige entre los días que quedan de la semana, de mañana al domingo, en la misma comida. Cada día dice qué pasaría: «libre» o «en lugar de *Merluza al horno*» (ese plato se quita). Los días saltados y las comidas bloqueadas salen desactivados. Si no queda ningún día, solo hay «Quitarlas».
   - **«Quitarlas»**. Cerrar la hoja también las quita.
3. **Comida bloqueada, o sin comida de ahora** (comida y cena ya comidas): la receta no entra en el menú. La propuesta lo dice («Esa comida está bloqueada en tu menú: la cocinas igual, pero no la apunto») y el modo cocina se abre sin contexto de menú.
4. **Se abre el modo cocina** de esa receta con las raciones y el contexto del menú (`menuId`, día, comida en la dirección).
5. **«Terminar»** en el modo cocina, con contexto de menú, hace lo mismo que «Marcar como cocinada» en `MealOptions`: `POST /cook-logs` con `menuId` / `dayIndex` / `meal` / `servings` (descuenta de la despensa) y `PATCH …/meal/:meal { eaten: true }`. Después, «¿Qué tal?» como hoy, y vuelve a `/menu` en ese día, que ya enseña «✓ Comido». Sin contexto de menú, todo sigue como hoy (vuelve a la receta). Vale también para el modo cocina abierto desde el Menú normal, que hoy no pasa el contexto.
6. **Si no se pulsa «Terminar»**, la receta queda en el menú de hoy sin marcar, y el «¿hiciste la cena?» de WhatsApp lo recoge como ya hace.

## 5. Qué cambia en lo que ya existe

- `/menu`: pierde la tarjeta «Con lo que tienes»; gana el enlace «¿Otra cosa? Cocinar ahora».
- `/profile/pantry`: redirige a `/cocinar#despensa` (también en `usagePaths.ts`, `routeTemplates.ts` y sus pruebas).
- Barra de abajo y lateral: cinco entradas.
- Modo cocina: acepta y usa el contexto del menú.
- `persistRecipe` y «Añadir a mis recetas»: conservan y copian el marcado.
- Lo que Mimo cuenta de Mimoia (`kb/sobre-mimoia.md`): la pestaña nueva.

## 6. Fuera de esta versión

- Mimo (`cook_with_what_i_have`) y el chip «Con lo que tengo» de Recetas siguen igual. Que su lista de lo que falta distinga imprescindibles de secundarios va en una tarea aparte.
- Marcar las recetas propias de los hogares con la oficina (pide cambiar la privacidad, ver §3).
- Preguntar por antojos (algo ligero, de cuchara, contundente).
- Alergias de invitados cuando son más que los de casa.
- Convertir unidades entre la despensa y la receta (kg ↔ g, unidades ↔ gramos).
- La pestaña como pantalla principal para los hogares que improvisan (D-069 lo deja para más adelante).
- Cambios en WhatsApp.

## 7. Pruebas

- **Unitarias (vitest, `apps/api/src/tests/`)**: regla automática (categoría, peso, línea sin gramos, «al gusto», `optional`, categoría nula); «lo tienes» (despensa, básicos por palabra, sustitutos, cantidad insuficiente con la misma unidad, unidades distintas); filtro de tiempo (cabe, +20 %, sin tiempo, sin límite); «solo lo que hay» con y sin caída a «falta una cosa»; «sí, algo» con 2 faltas; orden; 0–3 elementos; comida de ahora (hora, comida ya comida, las dos comidas comidas); el marcado sobrevive a una edición y se copia; validación del `PUT` de marcado; «Pasarlas a otro día» (libre, en lugar de, días desactivados).
- **Contrato**: el cuerpo que manda la web a `POST /cook-now/proposal` contra su esquema zod de `@ona/shared`.
- **Playwright (`apps/web/e2e/`, 390×844)**: pestaña «Cocinar» → 4 preguntas (editando una cantidad de la despensa) → propuesta con 1 + 2 → «Cocinar esta» sobre una comida planeada → «Pasarlas a otro día» → modo cocina → «Terminar» → `/menu` muestra «✓ Comido» en hoy y la receta movida en el otro día; y la redirección de `/profile/pantry`.

## 8. Documentación (en el mismo cambio)

- Spec nueva `specs/cook-now.md` y su fila en `specs/index.md`.
- `cook-from-pantry.md` (la tarjeta se muda y usa la búsqueda nueva; `match-pantry` retirado), `pantry.md` (dónde vive), `cook-log.md` y `cooking-mode.md` (contexto de menú y «✓ Comido»), `menus.md` (enlace y hoja «¿Y las lentejas?»), `recipes.md` y `catalog-import.md` (imprescindibles, secundarios, sustitutos, su marcado y que sobreviven a la edición), `design-system.md` (cinco pestañas), `feature-usage.md` (`/cocinar` y la dirección antigua de la despensa).
- `CLAUDE.md`, «Common pitfalls»: la barra de abajo pasa a cinco pestañas.
- En ona-hq: la tarea nocturna de Cocina que marca el catálogo y el campo nuevo en el formato de las tandas JSON.

## 9. Fases

1. Migración, conservar y copiar el marcado, superficie de admin y regla automática.
2. Servicio de búsqueda (puro) con sus pruebas, y `POST /cook-now/proposal`.
3. `/cocinar`: preguntas, propuesta, frase de Mimo, tarjeta y despensa mudadas, barra de cinco.
4. «Cocinar esta», hoja «¿Y las lentejas?» y contexto de menú en el modo cocina.
5. En ona-hq: tarea de Cocina (pasada del catálogo y marcado nocturno) y campo en las tandas.

## 10. Lo construido (PRO-1105 a PRO-1109, 2026-11-13)

Donde lo construido se separa de lo de arriba, vale esto (detalle en [`specs/cook-now.md`](../../../specs/cook-now.md)):

- **`GET /cook-now/today`** da la comida de ahora a la web: `{ weekStart, day, meal, menuId, planned[], slotServings, targets[] }`. La web no calcula la hora: la decide la API (hora de Madrid).
- **`POST /cook-now/choose`** contesta `{ placed: true, menuId, weekStart, day, meal }` o `{ placed: false, reason }` con `no_meal`, `not_found` o `banned`; no hay `locked`: desde PRO-1175 una comida bloqueada se sustituye como cualquier otra y también es destino de «Pasarlas a otro día».
- **`servings` va nulo** cuando coincide con los comensales del hogar, para que el hueco no guarde su propio número.
- **`requirePantryUse`** en `POST /cook-now/proposal`: la tarjeta «Con lo que tienes» pide solo recetas que usen algo de la despensa, y no cuenta como propuesta en los eventos.
- **El tiempo** de una receta es `totalTime` o, sin él, preparación + cocción (`recipeTotalMinutes`); solo sin ninguno de los dos se queda fuera.
- **La oficina escribe el marcado** con `x-cocina-token` / `COCINA_WRITE_TOKEN` (hasta ahora solo tenía tokens de lectura), o con el JWT de un admin.
- **La frase de Mimo se cobra al hogar**, sin persona, así que no suma al tope mensual de cada uno; Gratis no la recibe (PRO-385).
- **Eventos de uso**: `cook_now_proposed` (`canBuy`), `cook_now_chosen` (`displaced`) y `meal_cooked` con `fromMenu`.
- **Prueba del recorrido entero**: `apps/web/e2e/cook-now.spec.ts`, contra la API y el catálogo de verdad; en domingo, sin días a los que mover, quita el plato planeado en vez de pasarlo.
