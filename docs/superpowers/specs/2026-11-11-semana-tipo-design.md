# «Semana tipo» — diseño

**Fecha:** 2026-11-11 · **Estado:** aprobado por Miguel (D-182 y el diseño, 2026-11-11), revisado contra el código y simplificado (D-183). Maqueta: https://claude.ai/artifact/BAoENd9TwDzaj3aN8DbAbz (privada). Va con la revisión de las hojas del menú: ona-hq `proposals/2026-11-11-producto-hojas-del-menu.md` (E-72) y PRO-1174 a PRO-1180.

## Para qué

Que cada hogar diga una vez **lo que suele comer cada día** («los viernes por la noche, pizza»; «los jueves, una semana ceviche y otra carpaccio»; «legumbres el sábado, cada dos semanas») y que el menú de cada semana salga de ahí, con Mimo rellenando solo los huecos libres. Configurar tiene que pesar más que pedirle a la IA (Miguel: «el menú inteligente está demasiado promocionado»).

Hoy la idea está repartida, y cada pieza tiene sus propias reglas:
- **La plantilla del perfil:** comidas por día, comensales y número de platos (`mealDishCounts`).
- **Comidas fijas** (PRO-218).
- **Días de táper** (PRO-223).
- **Platos fijos de la ficha** (`fixed_dish`, PRO-1141).
- **Hechos de la ficha:** `skipped_meal` y `dish_frequency`.
- **«Tipo de comida» del menú** (`pinnedType`). Hoy no hace nada: la web lo manda (`hooks/useMenu.ts:275`), pero la ruta no lo lee (`routes/menus.ts:917-985`) y ninguna llamada al matcher lo pasa. `specs/menus.md:21` describe algo que no existe; se corrige con la fase 5.

La semana tipo junta todo eso en una rejilla.

## 1. De quién es y dónde se guarda

- **Es del hogar.** Una semana tipo por hogar (`households`). Si alguien vive solo, es la suya. La genere quien la genere (un miembro, el autoplan del jueves o Mimo), el menú usa la del hogar. Hoy la plantilla es de la persona que genera (`menuGenerator.ts:538-547`, `weeklyAutoplan.ts:57,116`), así que cada miembro podía ver una semana distinta.
- **Tabla propia:** `household_week_types` (`household_id` único, `slots jsonb`, `updated_at`), con migración que solo añade. **No va en `user_settings.template`.** Ese JSON tiene varias formas y el perfil lo guarda entero con una lista fija de claves (`apps/web/src/app/profile/page.tsx:412-415`; `PUT /user/:id/settings` sustituye sin mezclar, `routes/users.ts:427-460`): cualquier «Guardar cambios» del perfil borraría la semana tipo.
- **Rutas propias:** `GET /households/me/week-type` y `PUT /households/me/week-type/:day/:meal`, que cambia solo ese hueco. Si dos personas tocan el mismo hueco a la vez, gana la última.
- **La plantilla de hoy se queda donde está** para lo personal (peso, actividad). Las comidas por día, los comensales y los platos de cada hueco pasan a la semana tipo (§7).

## 2. Qué es un hueco

Cada hueco (día × comida) tiene:

- **Estado:**
  - **Libre:** «Cualquier receta». Mimo pone la que mejor encaje, como hoy.
  - **«No hay»:** esa comida no se planifica ese día. Sustituye a comensales = 0 y al hecho `skipped_meal`.
  - **Con opciones:** hasta 4.
- **Opciones**, de estas clases:
  - **Tipo de plato** (§3).
  - **Receta concreta:** del catálogo o del hogar.
  - **Algo fijo sin receta:** con lo que lleva por persona; la «comida fija» de hoy.
  - **Táper de la cena:** solo en desayuno, comida o merienda, de martes a domingo, como única opción del hueco. Son las reglas de hoy (`taper.ts:22,73-80`).
  - **Cualquier receta:** como un paso más de un turno.
- **Cómo se reparten:**
  - **Por turnos** (por defecto): una opción cada semana, por orden.
  - **Juntos:** todas en la misma comida. El número de platos de ese hueco pasa a ser el de las opciones (hasta 4) y no el de la comida (`mealDishCounts`, 1 a 3 hoy, `menuGenerator.ts:179-194,376`).
  - **Con una sola opción en una comida de 2 o 3 platos:** la opción ocupa el primero y los demás salen libres, como hoy.
- **«Cada N semanas»** no es un modo guardado: es cómo se elige y se lee un turno. «Pizza, cada 2» se guarda como el turno `[Pizza, Cualquier receta]`; «cada 3», con dos «cualquier receta». El panel lo enseña como «Cada 2».
- **Comensales y platos** del hueco, como hoy.
- **Qué semana del turno toca:** cada hueco guarda la semana en que se guardó. Esa semana toca la primera opción, la siguiente la segunda, y así sucesivamente, sigan o no cocinándose esas semanas. Cambiar el hueco vuelve a empezar.

## 3. Tipos de plato

Una lista cerrada en `@ona/shared` (`DISH_TYPES`: clave, etiqueta, familia, icono y si es un **plato** o un **tipo amplio**), que sustituye a `MEAL_TYPE_TAGS`:

| Familia | Tipos (amplios en cursiva) |
|---|---|
| Cuchara | Legumbres · Cremas y sopas · Guisos |
| Pescado, carne y huevo | *Pescado* · *Pollo* · *Carne* · Huevos y tortillas · *Plancha y brasa* |
| Bases | Pasta · Arroz · Pizza · Bocadillos y sándwiches |
| Frescos y crudos | Ensaladas · *Verduras* · Ceviche · Carpaccio y tartar |
| Del mundo | *Italiano* · *Japonés* · *Chino y wok* · *Indio* · *Mexicano* · *Sudamericano* · *Oriente Medio* |
| Desayunos | Tostadas · Cereales y avena · Yogur y fruta · Dulce de finde |

Salen «Mediterráneo» (no dice qué plato es) y «Batch cooking» (es una forma de cocinar).

**Los tipos de cada receta** (`recipes.dish_types text[]`, migración que solo añade) los pone una función con reglas fijas (`dishTypesOf`: nombre, etiquetas e ingredientes principales) al guardar o importar una receta, más un relleno de todas una vez. Sustituye a `scripts/tagRecipesByType.ts`, que tenía reglas toscas (la soja contaba como legumbre y como asiático). Si se equivoca con una receta, Cocina lo corrige al editarla.

**Un tipo con pocas recetas no frena nada** (Miguel: «cocina se encargará de pedirlas»). Cuando el generador no encuentra receta de un tipo, lo apunta con `recordCatalogWish` (`catalogWishes.ts:138`), que Cocina ya ve.

## 4. Dónde se configura

- **Perfil → «Tu semana tipo»** (sustituye a «Plantilla semanal», «Comidas fijas» y «Días de táper»):
  - **Rejilla:** la de «La semana» del menú, con un icono por opción en vez de fotos. Una opción ocupa el hueco; dos lo parten en dos; tres o cuatro, en cuatro. Los libres dicen «Cualquier receta»; los apagados, «no hay».
  - **Panel del hueco:** «Por turnos / Juntos», «Cada cuánto» (con una opción), las opciones con quitar y reordenar, «+ Añadir», comensales, «No hay <comida> este día» y «Así lo pondría Mimo», con las 4 semanas siguientes.
  - **Selector:** «Una receta concreta» (buscador), los tipos por familias y los comodines (con el táper solo donde vale).
- **Alta.** Se amplía la pregunta abierta que ya existe, «¿Algo más? Cuéntanos tu caso», que ya lee una IA (`onboardingMemoryAnalysis.ts:14-19`, `specs/auth.md:40`), en vez de añadir otro paso y otra llamada:
  - el texto de ayuda lleva ejemplos de costumbres («pasta los miércoles», «pescado una semana sí y otra no», «el domingo por la noche, sándwich mixto»), sin opciones prefijadas (Miguel: «no puede tener unas costumbres frecuentes que incluyan el día y el tipo de comida»);
  - el análisis escribe también la semana tipo, y la pantalla siguiente enseña «Así lo he entendido» (una fila por hueco) con «Está bien» y «Corregir», que vuelve al texto;
  - en el alta por WhatsApp, Mimo hace la misma pregunta.
- **Mimo, en la web y en WhatsApp:**
  - herramientas nuevas `get_week_type` y `set_week_type_slot` (día o días, comida, opciones, modo, frecuencia, «no hay», comensales);
  - entiende lenguaje natural y confirma en una línea («Hecho, en tu semana tipo: viernes, cena, pizza cada semana»);
  - si falta algo («los jueves ceviche», sin comida), pregunta una sola cosa;
  - `update_weekly_template` y `set_fixed_meal` pasan a escribir aquí;
  - **los hechos `skipped_meal`, `dish_frequency` y `fixed_dish` con día y comida dejan de crearse** (`upsert_profile_fact`, `fichaSkills.ts:150`; el repaso nocturno, `profile/refiner.ts:286,333`) y van a la semana tipo. Lo que no tiene día ni comida («nos gusta mucho la pizza») sigue en la ficha como gusto.
- **Desde el menú:** «Tipo de comida», en la hoja de la comida, escribe en el hueco de la semana tipo (ese día y esa comida, todas las semanas) y aplica también la semana que se ve, si esa comida no está fijada ni comida. Ya no hay «solo esta semana»: quien quiera otra cosa esta semana elige otra receta.

## 5. El generador: qué gana sobre qué

Para cada hueco de la semana, en este orden. Gana lo primero que aplique:

| # | Qué | Resultado |
|---|---|---|
| 1 | Día «sin cocinar» | sin hueco |
| 2 | Comida fuera esta semana («¿Alguna comida fuera?») | sin hueco, también si la semana tipo tiene algo |
| 3 | Comida fijada o ya comida | se queda como está |
| 4 | «No hay» en la semana tipo, salvo que «¿Viene alguien?» añada esa comida esta semana | sin hueco |
| 5 | Menú del cole (la cena evita lo que comieron) | se aplica como filtro **dentro** del paso 6 |
| 6 | Opción del turno o, si son juntas, todas | ver abajo |
| 7 | Hueco libre | como hoy |

Cómo se resuelve cada opción (paso 6):
- **Tipo:** recetas del hogar y del catálogo con ese tipo, por el filtro de siempre (alergias, dieta, auditoría, vetos, tiempo del día, festivos, aparatos, cole y variedad de la semana). Si ninguna encaja:
  - en un **plato** (Pizza, Ceviche…), sale escrito con su nombre y un aviso del porqué («No hay una pizza sin gluten de menos de 30 min»);
  - en un **tipo amplio** (Carne, Indio…), cualquier receta y el aviso;
  - en los dos casos se apunta la demanda para Cocina.
- **Receta concreta:** esa receta, sin los filtros de gustos, temporada, tiempo ni aparatos, como hoy con los platos fijos de la ficha (PRO-1141). Si rompe una alergia o la dieta de alguien de casa, no se pone: el hueco sale libre con el aviso de PRO-345, «En lugar de <receta>, que no encaja con vuestras alergias o dieta».
- **Algo fijo sin receta:** la nota «Fijo: <nombre>» con lo que lleva, que va a la compra (PRO-218).
- **Táper:** las reglas de PRO-223.

**«Cambiar al azar», regenerar un plato y `swap_meal` sin receta** respetan el hueco: eligen otra receta de ese tipo y, en una receta concreta o algo fijo, eligen libre con aviso. Ya no dan 409 como hoy con los platos fijos.

**Semanas ya generadas:** cambiar la semana tipo no toca las semanas hechas, salvo cuando el cambio sale de «Tipo de comida» en el menú (§4). Las semanas siguientes ya salen con lo nuevo. «Rehacer la semana» y el autoplan del jueves usan la semana tipo.

**Menú del mes:** no cambia. Al copiarse pone sus platos, como hoy.

## 6. En el menú

- **Mientras se genera:** «La semana» enseña al momento un esqueleto con los iconos de la semana tipo y «Buscando…», y se sustituye entero cuando llega el menú. El generador no se trocea: es una sola llamada.
- **Chip:** un plato que sale de la semana tipo lleva uno discreto con su tipo («Pizza · semana tipo»).
- **Hojas «···»:** las de PRO-1175 a PRO-1180, con dos respuestas de Miguel.
  - «Vetar esta receta» se queda en el primer nivel.
  - «Fijar» deja de poner gris la hoja y solo protege lo elegido al rehacer la semana. Es un cambio de lo que hace hoy (`specs/menus.md:14`) y se hace en PRO-1175.

## 7. Paso de lo viejo a lo nuevo

Todo en la fase 1, de una vez: se migran los datos, el generador pasa a leer solo la semana tipo y todo lo que hoy escribe en lo viejo pasa a escribir en la semana tipo (los botones de «Comidas fijas» y «Días de táper», `update_weekly_template`, `set_fixed_meal` y el `fixed_dish` del refinador y de `upsert_profile_fact`). Así no hay dos sitios vivos a la vez.

- **Migración, una vez y repetible sin cambiar nada.** Cada hogar sin fila se crea a partir de:
  - **la plantilla del dueño:** comidas, comensales y platos;
  - **sus comidas fijas:** algo fijo sin receta;
  - **sus días de táper:** táper;
  - **`fixed_dish` con día y comida:**
    - si su nombre encuentra receta con la búsqueda de PRO-1141, es una receta concreta;
    - si no, y el nombre es el de un tipo («pizza»), es un tipo;
    - si no, algo fijo sin receta;
    - dos en el mismo hueco van por turnos;
  - **`skipped_meal`:** «no hay»;
  - **`dish_frequency` con día y comida:** turno.

  `pinnedType` no se migra, porque nunca hizo nada.
- **Se retiran** en la misma fase `fichaFixedDishes.ts` como entrada del menú, `fixedMealsStore` como fuente aparte y `pinnedType`.

## 8. Fuera de esta versión

- Turnos de más de 4 pasos y frecuencias como «dos veces al mes en días distintos».
- Que Mimo proponga sola cambios de la semana tipo a partir de lo que se cocina (con datos de PRO-1174).
- Generación hueco a hueco, en directo.
- Iconos dibujados por diseño: valen los de la maqueta.

## 9. Pruebas

Cada fase lleva las suyas y su parte de spec y de `kb/sobre-mimoia.md`.

- **Unitarias (vitest):**
  - los turnos y «cada 2»;
  - «juntos»;
  - la tabla de §5;
  - un tipo sin recetas;
  - una receta concreta que rompe una alergia;
  - la migración, una vez y otra sin cambios;
  - `dishTypesOf` con un puñado de recetas reales.
- **Mimo:** casos en `scripts/replayWhatsAppTurns.ts`:
  - «los viernes pizza»;
  - «una semana sí y otra no»;
  - «quita el desayuno del domingo»;
  - «nos gusta mucho la pizza», que va a la ficha y no a la semana tipo.
- **e2e a 390×844 y 1440×900:**
  - la rejilla, de punta a punta;
  - guardar el perfil no borra la semana tipo;
  - la semana generada respeta los huecos dos semanas seguidas;
  - el alta con «Así lo he entendido».

## 10. Fases (cada una, una tarea del Taller, con su spec)

1. **Datos, migración y generador.**
   - Qué entra: `DISH_TYPES`, `dish_types` con su relleno, la tabla y sus rutas, la migración, el generador con la tabla de §5, y todo lo que hoy escribe en lo viejo desviado a la semana tipo (§7).
   - Quien no ha tocado nada ve el mismo menú.
   - Spec: `menus.md`, `recipes.md` y `household-profile.md`.
2. **Perfil:** «Tu semana tipo» (rejilla y panel). Se retiran «Comidas fijas» y «Días de táper» como pantallas.
3. **Mimo:** `get_week_type` y `set_week_type_slot` en lenguaje natural. Spec: `advisor.md`.
4. **Alta:** la pregunta abierta ampliada y «Así lo he entendido». En WhatsApp, Mimo hace la misma pregunta. Spec: `auth.md`.
5. **Menú:** «Tipo de comida» hacia la semana tipo, el chip, el esqueleto mientras se genera y «Llenar con mi semana tipo». Va con PRO-1175 a PRO-1180 y corrige `menus.md:21`.
