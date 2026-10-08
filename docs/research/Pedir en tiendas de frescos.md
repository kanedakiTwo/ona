# Traducir la receta al idioma del mostrador

ONA debe dejar de mandar a las tiendas las cantidades de la receta y escribir cada línea en la **unidad en que esa tienda vende**, con una tabla curada «cómo se compra» por producto que decida tienda, unidad, mínimo, paso, si se admite media pieza y qué hay que concretar. Las reglas son distintas en cada mostrador. **La frutería** se pide por piezas, cabezas, manojos o bandejas, con mínimo de una unidad, y solo se pide media pieza en las piezas grandes (melón, sandía, col, calabaza). **La charcutería** se pide siempre en gramos, nunca en «unidades», y diciendo el tipo (serrano, ibérico, cocido extra) y el corte. **La carnicería** se pide por pieza o en fracciones de kilo («un cuarto», «medio kilo»), diciendo el uso y la preparación. **La pescadería** necesita una especie concreta, un tamaño y una preparación: «2 doradas de ración, limpias para el horno (o lubinas, la que esté mejor hoy)». **El súper** se pide en envases, y la despensa no entra nunca sola. En el primer pedido real de Miguel, **solo 4 de las 33 líneas estaban bien tal cual**. El resto falla por cinco causas de código reproducidas con las funciones reales: cantidades de receta sin convertir, artículos manuales que pasan a «1 unidad», filas sin pasillo que acaban en el súper, nombres genéricos sin resolver y duplicados sin fusionar. El mensaje también falla fuera de las líneas: si falta la dirección, el domicilio se convierte sin aviso en «para recoger», nunca pregunta la hora de entrega, no sabe cuál es el pedido mínimo y no deja añadir nada antes de enviar. El arreglo cabe en el flujo actual: una función pura de conversión dentro del bucle del borrador (`draft.ts`), una tabla en `@ona/shared` con el mismo patrón que ya usa `fish.ts`, y cuatro campos nuevos (cantidad puesta o por defecto, nota de receta, entrega por pedido, mínimo de envío). Casi todos los pesos y mínimos de la tabla son estimaciones que tienen que validar Miguel o sus tiendas, y **ningún investigador encontró un solo pedido real por WhatsApp** a una tienda de frescos española, así que las plantillas de mensaje son una construcción razonada, no una copia de la práctica observada.

*Convenciones: «(est.)» marca una estimación propia sin fuente directa. Las citas a ficheros del repo apuntan al código de la rama actual. El diagnóstico línea a línea no es una suposición: las 33 líneas se pasaron por `classifyShopKind` y `lineRequestText` reales y salieron idénticas a las que vio Miguel.*

## Solo 4 de las 33 líneas llegaron bien a la tienda

El pedido real tenía 33 líneas repartidas en 4 tiendas: 3 a Ben-Car (carnicería), 22 a El Corte Inglés (súper, como lista web), 1 a Pescaderías Los Alonso y 7 a The Fruits of the World (frutería). De ellas, 13 eran artículos escritos a mano o «básicos» y 20 venían de recetas ([data_pedido_real_miguel.csv](<../research_notes/Pedir en tiendas de frescos/data_pedido_real_miguel.csv>)). Las quejas de Miguel resumen las reglas mejor que cualquier fuente: «normalmente es por unidades y con mínimos; no puedes pedir 25 g de ajo», «el jamón se pide en gramos siempre, y habrá que especificar qué jamón», «no puedes decir pescado entero así en general, tienes que decir uno concreto», y a domicilio «incluir siempre la dirección y pedir que te digan más o menos cuándo va a llegar» ([contexto.md](<../research_notes/Pedir en tiendas de frescos/contexto.md>)).

La tabla siguiente reescribe cada línea como debería haber salido. Va agrupada por la tienda a la que se mandó; «→ frutería» indica que la línea tenía que haber ido a otra tienda.

### Frutería (The Fruits of the World): 7 líneas enviadas

| # | Enviado | Cómo debe salir | Regla |
|---|---|---|---|
| 27 | `Tomate: 3 unidades` | `3 tomates de ensalada` | Plural natural y variedad. Los catálogos de frutería venden el tomate por variedad (pera, ensalada, raf, cherry); por defecto, «de ensalada» (est.) o la que diga la receta |
| 28 | `Zanahoria: 150 g` | `2 zanahorias` | Pieza de 80 g en el catálogo de ONA y 100 g en las tablas de la UCM: 150/80 = 1,9 → 2 |
| 29 | `Pepino: 1 unidad` | `1 pepino` | Bien; sobra la palabra «unidad» |
| 30 | `Guisantes: 300 g` | → súper: `Guisantes congelados: 1 bolsa` | El guisante fresco es de primavera (est.) y se vende en vaina, con un rendimiento desgranado sin fuente. Preguntar «¿frescos o congelados?» |
| 31 | `Cebolla: 225 g` | `2 cebollas` | Cebolla mediana de 110–150 g: 225 g son 1,5–2 piezas → 2 |
| 32 | `Pimiento verde: 1 unidad` | `1 pimiento verde italiano` | El pimiento siempre lleva el tipo (italiano, de freír, rojo para asar) |
| 33 | `Ajo: 25 g` | `1 cabeza de ajos` | La cabeza pesa unos 50 g; el mínimo es 1 cabeza |

### Carnicería (Ben-Car Boadilla): 3 líneas enviadas

| # | Enviado | Cómo debe salir | Regla |
|---|---|---|---|
| 1 | `Jamón: 50 g` (receta) | Fusionada con la 3: `100 g de jamón serrano, loncheado fino` | Charcutería en gramos, con un suelo de 100 g y pasos de 50 g (est.). Se pregunta una vez «¿serrano o ibérico?» y se recuerda la respuesta |
| 2 | `Jamón york: 1 unidad` (a mano) | `150 g de jamón cocido extra, en lonchas` | «1 unidad» de embutido al corte no significa nada. Para enviarla hace falta una cantidad: ONA propone 150 g (est.) y el usuario la confirma |
| 3 | `Jamón serrano: 1 unidad` (a mano) | (dentro de la 1) | Es el mismo producto que la 1. Si el usuario quiere más para casa, se suma a los 50 g de la receta |

### Pescadería (Los Alonso): 1 línea enviada

| # | Enviado | Cómo debe salir | Regla |
|---|---|---|---|
| 26 | `Pescado entero fresco (dorada, lubina, gallo, etc.): 2 unidades` | `2 doradas de ración, limpias para el horno (o lubinas, la que esté mejor hoy)` | Una especie concreta, con su tamaño y su preparación. Hoy la línea además sale marcada como «lonja» solo porque el nombre contiene «gallo» |

### Súper (El Corte Inglés, lista web): 22 líneas enviadas

| # | Enviado | Cómo debe salir | Regla |
|---|---|---|---|
| 4 | `Calabacín: 1 unidad` (a mano) | → frutería: `1 calabacín` | Un artículo manual no se cruza con el catálogo, que sí tiene `calabacin` en el pasillo `produce` |
| 5 | `Galletas daniela: 1 unidad` | `Galletas Daniela` (sin cantidad) y aviso «no lo encuentro en El Corte Inglés» | Sin regla para el producto, se manda solo el nombre. La búsqueda en ECI no devuelve ningún producto Daniela |
| 6 | `Yogur: 1 unidad` | `Yogur natural: 1 pack de 4` | Genérico con un valor por defecto razonable. Se fusiona con el `yogur natural` de las recetas |
| 7 | `Fruta (fresas, plátanos, naranjas, mandarinas, mango, melón): 1 unidad` | → frutería, en 6 líneas: `1 bandeja de fresas`, `6 plátanos de Canarias`, `1 kg de naranjas de zumo`, `1 kg de mandarinas`, `1 mango`, `1 melón piel de sapo (o medio si son muy grandes)` | Un compuesto con palabra de familia se divide en sus productos. Cada uno toma su unidad de venta, y las cantidades por defecto las confirma el usuario (est.) |
| 8 | `Queso: 1 unidad` | Bloqueada hasta elegir: «¿Qué queso? Cuña semicurado (300 g) · lonchas · rallado · otro» | Genérico sin valor por defecto. Además, buscar «queso» en ECI devuelve tartas de queso |
| 9 | `Queso rallado: 1 unidad` | `Queso rallado: 1 bolsa (200 g)` | Envase por defecto |
| 10 | `Queso sandwich: 1 unidad` | `Queso en lonchas: 1 paquete (200 g)` | Envase por defecto |
| 11 | `Leche: 1 unidad` (a mano) | Fusionada con la 14: `Leche entera: 1 brik (1 l)`, o los que diga el usuario | Manual + receta del mismo producto: una sola línea, y los 50 ml de la receta quedan dentro |
| 12 | `Pan: 1 unidad` | Se pregunta «¿barra, hogaza o molde?». Si es molde: `Pan de molde: 1 paquete (450 g)` | ECI online no tiene barra fresca, y buscar «barra de pan» devuelve barras de labios |
| 13 | `Feta: 200 g` | `Feta: 2 envases de 150 g` | En ECI el formato es de 150 g: 200/150 → 2 |
| 14 | `Leche entera: 50 ml` | (dentro de la 11) | — |
| 15 | `Mantequilla: 25 g` | `Mantequilla: 1 pastilla (250 g)`, con la marca «probablemente la tienes» y desmarcada por defecto | Básico de nevera en poca cantidad: 25 g son el 10 % del envase más pequeño |
| 16 | `Aceitunas negras: 22 unidades` | `Aceitunas negras sin hueso: 1 lata (150 g)` | La «u» de la receta es una aceituna, no un envase |
| 17 | `Alcaparras: 50 g` | `Alcaparras: 1 frasco (80 g)` | Envase |
| 18 | `Lentejas: 400 g` | `Lentejas cocidas: 1 frasco (400 g)` o `Lentejas pardinas: 1 paquete (1 kg)`, según la receta | La receta tiene que decir si son secas o cocidas |
| 19 | `Cebolla morada: 2 unidades` | → frutería: `2 cebollas moradas` | La fila del catálogo no tiene pasillo, así que acaba en el súper |
| 20 | `Harina de fuerza: 150 g` | `Harina de fuerza: 1 paquete (1 kg)` | Producto especial: se añade aunque se necesite poco, porque en casa no suele haber |
| 21 | `Hierbas aromáticas (romero, tomillo): 3 unidades` | → frutería: `1 manojo de romero` + `1 manojo de tomillo` | Compuesto, y la «u» de la receta es una ramita |
| 22 | `Limón: 5 unidades` | → frutería: `5 limones` | El catálogo tiene la fila `limón` sin pasillo y otra fila `limon` en `produce` |
| 23 | `Yema de huevo: 1 unidad` | `Huevos: media docena`, con la marca «probablemente los tienes» | Una yema es un huevo. Buscar «yema» en ECI devuelve yemas de espárragos |
| 24 | `Leche avena: 1 unidad` | `Bebida de avena: 1 brik (1 l)` | Nombre comercial. Buscar «leche avena» en ECI devuelve Danacol y lociones corporales |
| 25 | `Harina: 1 unidad` (a mano) | Se pregunta «¿harina de trigo normal o la de fuerza de la receta?». Si es normal: `Harina de trigo: 1 paquete (1 kg)` | Genérico y posible duplicado de la 20 |

Contando una línea en varias categorías cuando toca, el reparto de fallos es este ([ona_datos_y_codigo.md](<../research_notes/Pedir en tiendas de frescos/ona_datos_y_codigo.md>)). **5 líneas fueron a la tienda equivocada**, todas de frutería mandadas al súper, porque solo `aisle === 'produce'` lleva a la frutería ([classify.ts:27](../../apps/api/src/services/shopOrders/classify.ts)). **10 eran genéricas** o necesitaban una elección. **10 llevaban la cantidad de la receta** en vez de la unidad de venta, porque el borrador copia `quantity` y `unit` sin convertir ([draft.ts:66-81](../../apps/api/src/services/shopOrders/draft.ts)). **13 eran manuales con el «1 unidad» por defecto** ([routes/shopping.ts:607-618](../../apps/api/src/routes/shopping.ts)). Y había **4 grupos de duplicados**: jamón ×3, leche ×2, harina ×2 y yema con huevo. Con todo corregido, la frutería pasa de 7 a unas 16 líneas y el súper de 22 a unas 14. Es decir, el error más caro no era de redacción sino de reparto: casi la mitad de lo que tenía que ir a la frutería acabó en la lista del súper.

## Cada mostrador vende en su propia unidad

La regla de fondo, válida para las cuatro tiendas, es que **la unidad del pedido depende del producto, no de la receta**. Casi todo se cobra por kilo, pero se pide de tres formas: por pieza (ajo, melón, pollo, dorada), por peso redondo (patatas, picada, jamón, almejas) o por envase (leche, harina, aceitunas). Las tres tiendas de frescos tienen además su propio vocabulario de concreción; el súper se trata aparte, más abajo.

### La frutería cuenta piezas y solo parte las grandes

Las fruterías que venden en línea convierten casi todo en «pieza» con un peso aproximado: la tienda de Castellón en Glovo vende el pepino a 190 g la pieza, el pimiento verde de freír a 120 g, el plátano de Canarias a 170 g, los ajos en malla de 250 g, el perejil en paquete de 40 g, el cilantro en bandeja de 20 g y el tomate cherry en bandeja de 500 g ([Glovo, Frutería Castellón](https://glovoapp.com/ro/es/castellon-de-la-plana/stores/fruteria-castellon-de-la-plana)). La referencia académica española de peso por unidad da **50 g la cabeza de ajo y 4 g el diente**, 150 g la cebolla y el tomate medianos, 100 g la zanahoria, 150 g el limón y 1,5 kg el melón ([UCM, tablas de raciones y unidades](https://www.ucm.es/idinutricion/file/tablas-de-raciones-estandar_web)). Las mitades existen, pero solo en piezas grandes y como formato propio: «medio melón piel de sapo» de 1,23 kg frente a la pieza de 2,51 kg, y sandía entera (6,43 kg), media o en cuartos ([Glovo, Frutería Castellón](https://glovoapp.com/ro/es/castellon-de-la-plana/stores/fruteria-castellon-de-la-plana)). Una frutería de Bilbao vende además «berza, media unidad», y vende el mismo producto de dos maneras según el uso: **naranja de zumo por kilo y naranja de mesa por unidades** ([Glovo, Valdefrutas](https://glovoapp.com/es/es/bilbao/stores/fruteria-valdefrutas-bilbao)). Esto confirma la intuición de Miguel de que «media» es una excepción de las piezas grandes y que se pide preguntando.

La variedad, en cambio, solo es obligatoria en una lista corta. Los catálogos tratan como productos distintos el tomate (pera, ensalada, raf, cherry), la patata (para freír o para guisar), el pimiento (italiano, de freír, rojo), la manzana (golden, fuji, reineta, granny), la naranja (zumo o mesa) y la uva (blanca o negra, con o sin semilla) ([Glovo, Valdefrutas](https://glovoapp.com/es/es/bilbao/stores/fruteria-valdefrutas-bilbao)). En la patata el uso cambia el producto: agria para freír, red pontiac o fénix para guisar ([Consumer](https://www.consumer.es/?p=104853)). En el resto basta con el nombre genérico. Hay también una costumbre que merece una regla propia: «todavía en plazas de abastos, fruterías y mercadillos se regala un manojo de perejil fresco al cliente que lo pide» ([Directo al Paladar](https://www.directoalpaladar.com/ingredientes-y-alimentos/que-perejil-popular-hierbas-mediterraneas-sus-propiedades-mejores-recetas-que-usarlo)). Por eso ONA debería escribir «un manojo de perejil, si me lo podéis poner» y nunca gramos.

### La charcutería pesa en gramos y exige tipo

En el mercado, la charcutería al corte se vende siempre a €/kg. El Mercado Central de Zaragoza la vende online con **mínimo de 200 g y pasos de 100 g**, y la carne a granel con **mínimo de 500 g y pasos de 250 g** ([maza de jamón serrano](https://www.zaragoza.es/sede/servicio/mercados/mercado/1/producto/2665); [picada mixta](https://www.zaragoza.es/sede/servicio/mercados/mercado/1/producto/1372)). Esos son mínimos de pedido online; en el mostrador se pide menos, y El Corte Inglés vende el loncheado en sobres de 100–120 g ([ECI, Sotoalbos](https://www.elcorteingles.es/supermercado/marcas/sotoalbos/)). Por eso el suelo prudente para un WhatsApp es de 100 g en charcutería y 250 g en carne a granel (est.). El tipo de jamón no es un matiz: en la misma charcutería, el ibérico de cebo 50 % cuesta **65 €/kg**, la maza de serrano 21,95 €/kg y el jamón cocido extra 11,99 €/kg ([Charcutería Carmen](https://www.zaragoza.es/sede/servicio/mercados/mercado/1/detallista/70)). Dentro del ibérico, el precinto distingue bellota 100 % (negro), bellota (rojo), cebo de campo (verde) y cebo (blanco) ([Consumo Responde](https://www.consumoresponde.es/actualidad/noticias/precinto-etiquetado-mejores-referencias-calidad-origen-jamon-paleta-ibericos)). En el cocido, «extra» es la categoría sin almidones añadidos, y el «fiambre» es otro producto ([Directo al Paladar](https://www.directoalpaladar.com/actualidad-1/mejor-jamon-cocido-supermercado-ocu-mercadona-todos-tienen-mucha-sal-como-elegir-saludable)). Solo unos pocos embutidos se piden por unidad: la charcutería de Zaragoza vende chistorra, fuet, sobrasada y chorizo de ristra a €/ud, y chorizo y salchichón por piezas o medias ([Charcutería Carmen](https://www.zaragoza.es/sede/servicio/mercados/mercado/1/detallista/70)). «Jamón serrano: 1 unidad» no debería poder generarse nunca.

### La carnicería pide uso, pieza y fracción de kilo

Las carnicerías de mercado organizan la oferta por uso, no solo por pieza: «ternera de guisar», «ternera empanar», «magro guisar», «picada ternera / cerdo / mixta» ([Hnos. Pueyo](https://www.zaragoza.es/sede/servicio/mercados/mercado/1/detallista/63)). Las piezas naturales se piden por unidades con peso aproximado: el conejo, unos 1,3 kg, «entero» o «troceado» ([Pollería Navarro](https://www.zaragoza.es/sede/servicio/mercados/mercado/1/producto/172)); la hamburguesa de elaboración propia, unos 220 g ([Hnos. Pueyo](https://www.zaragoza.es/sede/servicio/mercados/mercado/1/producto/238)); el pollo de corral, hasta 3,5 kg, «entero, troceado o en cuartos» ([Pollería Julia](https://www.zaragoza.es/sede/servicio/mercados/mercado/1/producto/2716)). Hablando, el peso se dice en fracciones de kilo: «un cuarto», «medio kilo» ([Open University](https://www.open.edu/openlearn/languages/spanish/beginners-spanish-food-and-drink/content-section-1)). La picada, mejor «al momento» y pasada una vez para hamburguesa o dos para rellenos ([Consumer](https://www.consumer.es/?p=77821)). Lo normal es que el carnicero pregunte si se mezcla ternera con cerdo ([El Español](https://www.elespanol.com/cocinillas/recetas/20260519/cocineros-coinciden-albondigas-jugosas-no-llevan-cebolla-usa-carne-ajo-pan/1003744252021_30.html)). La consecuencia para ONA es que la nota de receta que hoy se tira («picada», «pechuga en tiras», «contramuslos con piel», «en taquitos grandes») es justo lo que el carnicero necesita leer.

### La pescadería necesita especie, tamaño y preparación

La tienda online de Pescaderías Los Alonso, que es la pescadería real de Miguel, se scrapeó entera. Vende el pescado entero por pieza con su tamaño: **dorada y lubina nacionales de 500–600 g a 7,13 € la pieza (12,98 €/kg)** y gallo de ración de 300 g ([dorada](https://pescaderiaslosalonso.com/tienda/pescados-frescos-pescaderias-los-alonso/pescado-azul/dorada-nacional/); [lubina](https://pescaderiaslosalonso.com/tienda/pescados-frescos-pescaderias-los-alonso/pescado-azul/lubina-500-grs-aprox/); [gallo](https://pescaderiaslosalonso.com/tienda/pescados-frescos-pescaderias-los-alonso/pescado-blanco/gallo-de-racion-nacional/)). Los cortes y el marisco van en bloques fijos: rodaja de merluza de 250 g, mejillón de 1 kg, boquerón de 400 g ([merluza](https://pescaderiaslosalonso.com/tienda/pescados-frescos-pescaderias-los-alonso/pescado-blanco/rodajas-de-merluza/); [mejillón](https://pescaderiaslosalonso.com/tienda/mariscos-en-pescaderias-los-alonso/mejillon-gigante-gallego-vivo/); [boquerón](https://pescaderiaslosalonso.com/tienda/pescados-frescos-pescaderias-los-alonso/pescado-azul/boqueron-malagueno/)). Cada producto se pide además con una preparación elegida de un vocabulario cerrado: *limpio, para el horno, abierta para el horno, para la espalda, para la sal, en lomos con o sin piel, en filetes, en rodajas, trozos*, y para el pescado pequeño *limpios, para freír, para vinagre, rebozar abierto* ([Los Alonso, tienda](https://pescaderiaslosalonso.com/tienda/)). Esa web también deja ver que aceptan pedidos por **WhatsApp (+34 616 943 425)** y que «entregamos a domicilio el mismo día» en su zona 1 si se pide antes de las 13:00, sin pedido mínimo a la vista ([Los Alonso](https://pescaderiaslosalonso.com/)). Para las raciones, un pescadero online calcula **400–500 g de pescado entero por persona** y 200–250 g de filete o lomo ([Pescado a Casa](https://pescadoacasa.com/cuanto-pescado-calcular-por-persona-en-navidad-o-fin-de-ano-%F0%9F%8E%84/)), así que una dorada de ración es una persona. Y el «pescado entero» genérico se resuelve sin pregunta abierta: la OCU recomienda «pedir consejo a tu pescadero de confianza» ([OCU](https://www.ocu.org/alimentacion/alimentos/noticias/acertar-al-comprar-pescado)), y una especie concreta seguida de «o la que esté mejor hoy» cumple a la vez la exigencia de Miguel y esa costumbre.

## Una tabla «cómo se compra» decide unidad, mínimo y tienda

El diseño que mejor encaja es una **tabla curada en código, con clave por nombre normalizado más alias**, y los regex actuales como respaldo para los nombres desconocidos. La clave no puede ser el UUID del ingrediente, porque `ingredients.id` se genera al azar en cada entorno y lo estable es el nombre, que es único ([schema.ts:115-117](../../apps/api/src/db/schema.ts)). El repo ya tiene este patrón: los rendimientos FAO de `fish.ts`, los básicos de despensa de `draft.ts` y los €/kg de referencia de `estimate.ts` son tablas por regex con tests. Los regex solos no bastan: deciden la tienda, pero no pueden expresar «mínimo una cabeza», «se admite medio» ni «la u de la receta es un diente». La tabla tiene sentido por volumen: el catálogo de producción tiene 198 filas, 150 de ellas usadas en recetas, y **la frutería concentra el 41 % de los usos** (275 de 670). Solo 22 de sus 62 filas tienen peso por unidad ([data_catalogo_ingredientes_prod.csv](<../research_notes/Pedir en tiendas de frescos/data_catalogo_ingredientes_prod.csv>)). Se puede curar a mano empezando por las 50 filas más usadas.

### Campos de cada regla

| Campo | Qué guarda | Ejemplo |
|---|---|---|
| `key` + `aliases` | Nombre canónico normalizado (sin acentos ni mayúsculas) y sus grafías; sirve también para fusionar duplicados | `ajo` ← `diente de ajo`, `dientes de ajo` |
| `shop` | `fruteria` · `carniceria` · `charcuteria` · `pescaderia` · `supermercado` · `despensa` | `jamon` → `charcuteria` (si el hogar no tiene charcutería: carnicería → súper) |
| `orderBy` | `pieza` · `peso` · `envase` | melón `pieza`; picada `peso`; leche `envase` |
| `saleUnit` | Singular, plural y gramos o ml por unidad | `{one:'cabeza', many:'cabezas', grams:50}` |
| `recipeUnit` | Qué significa «u» en las recetas | ajo: diente de 5 g; romero: ramita; aceituna: unos 3–5 g (est.) |
| `min` · `step` | Mínimo y paso, en unidades de venta o en gramos | jamón: min 100 g, paso 50 g (est.) |
| `half` | Si se puede pedir media pieza, y cómo se llama | melón, sandía (media y cuarto), col o berza, calabaza (trozo), pollo, chorizo |
| `choice` | Pregunta, opciones y valor por defecto (`null` = bloquea el envío) | jamón: «¿serrano o ibérico?», default `null` |
| `defaultPrep` | Preparación por defecto en el mensaje | dorada: «limpia para el horno»; jamón: «loncheado fino» |
| `variantNotes` | Notas de receta que cambian el producto | cebolla + «morada» → `cebolla morada`; tomate + «cherry» → `tomate cherry` |
| `shopPrepNotes` | Notas de receta que son trabajo de la tienda | ternera: «picada»; cordero: «en taquitos grandes»; pollo: «pechuga en tiras» |
| `tier` | Nivel en el súper: `despensa` · `nevera` · `normal` · `especial` | mantequilla `nevera`; alcaparras `especial` |
| `eciQuery` | Texto de búsqueda que funciona en El Corte Inglés | yema → «huevos»; leche avena → «bebida de avena» |

### Reglas de ejemplo para validar

| Producto | Tienda | Se pide por | Unidad de venta | Mínimo / paso | ½ | Elección | Origen del dato |
|---|---|---|---|---|---|---|---|
| Ajo | frutería | pieza | cabeza ≈ 50 g; diente 4–5 g | 1 cabeza | no | — | UCM |
| Cebolla | frutería | pieza | ≈ 110–150 g | 1 | no | blanca por defecto; morada si lo dice la nota | UCM + catálogo |
| Tomate | frutería | pieza (o ½ kg si son muchos) | ≈ 150 g | 1 | no | ensalada / pera / cherry | UCM; default (est.) |
| Melón | frutería | pieza | 1,5–2,5 kg; medio ≈ 1,2 kg | ½ | sí | piel de sapo por defecto | Glovo, UCM |
| Naranja | frutería | peso (zumo) o pieza (mesa) | 1 kg / unidad ≈ 225 g | 1 kg o 2 u | no | **zumo o mesa** | Glovo, UCM |
| Perejil | frutería | manojo | paquete ≈ 40 g | 1 | no | — | Glovo; «si me lo podéis poner» |
| Jamón serrano / ibérico | charcutería | peso | gramos | 100 g / 50 g (est.) | no | serrano / ibérico; default `null` | Zaragoza, ECI |
| Jamón cocido | charcutería | peso | gramos | 150 g / 50 g (est.) | no | default «cocido extra» | Directo al Paladar |
| Carne picada | carnicería | peso | fracciones de kilo | 250 g / 125–250 g (est.) | no | ternera / cerdo / mixta | Zaragoza (online 500 g) |
| Pollo (genérico) | carnicería | según nota | pechuga ≈ 180 g media; muslo ≈ 250 g; entero 1,7–3,5 kg | 1 pieza | medio pollo | pieza; default según receta | ECI, Zaragoza |
| Pescado entero | pescadería | pieza | dorada de ración 500–600 g | 1 por persona | no | dorada por defecto + «o lubina» | Los Alonso |
| Merluza | pescadería | peso | rodajas o lomos; bloque 250 g | 250 g | no | corte según receta | Los Alonso |
| Mantequilla | súper | envase | pastilla o tarrina de 250 g | 1 | no | — | ECI, Mercadona; tier `nevera` |
| Aceitunas negras | súper | envase | lata de 150 g | 1 | no | sin hueso por defecto (est.) | ECI |
| Harina de fuerza | súper | envase | paquete de 1 kg | 1 | no | — | ECI; tier `especial` |

### El conversor: de lo que necesita la receta a lo que se pide

La conversión debe ser una función pura (`toOrderQuantity`) llamada dentro del bucle del borrador, justo antes de crear la línea ([draft.ts:61-81](../../apps/api/src/services/shopOrders/draft.ts)). Primero lleva la necesidad a gramos o ml con `unitWeight` o `recipeUnit.grams`, y después aplica la regla del tipo de venta. La cantidad original se guarda para la app («1 cabeza · la receta usa unos 5 dientes»), pero **nunca se escribe en el mensaje**: la tienda solo ve la unidad de venta. Es la misma lógica que ya siguen las líneas de pescado en gramos, que se piden en limpio con el peso entero al lado ([format.ts:11-15](../../apps/api/src/services/shopOrders/format.ts)).

| Tipo | Regla | Ejemplos del pedido real |
|---|---|---|
| Pieza (frutería, pieza natural de carnicería) | `n = max(min, ceil(necesidad / peso − 0,15))`: redondea hacia arriba, salvo que falte menos del 15 % de una pieza (est.) | 25 g de ajo → 1 cabeza; 150 g de zanahoria → 2; 225 g de cebolla → 2 |
| Frutería a peso (patata, naranja de zumo, mandarina, judías, uvas) | Redondear a ¼, ½, 1, 1½ o 2 kg y decirlo así. Un producto pequeño que pase de unas 6 piezas se pide en kilos (est.) | 900 g de patata → «1 kg de patatas» |
| Carne a granel | Escalones de 250 / 375 / 500 / 750 / 1000 g y luego de 250 en 250, con suelo de 250 g (est.). Se escriben «un cuarto», «cuarto y mitad», «medio kilo», «tres cuartos», «un kilo» | 450 g de ternera picada → «medio kilo de carne picada de ternera» |
| Charcutería | Múltiplos de 50 g, suelo de 100 g (est.), en gramos redondos | 50 g de jamón → «100 g de jamón serrano» |
| Pescado entero | `piezas = ceil(limpio / (peso bruto × rendimiento FAO))`, con la ración de 500 g en dorada y lubina; si no hay gramos, 1 pieza por persona | 2 u → 2 doradas de ración |
| Pescado en corte y marisco | Bloques de 250 / 300 / 400 / 500 / 750 / 1000 g; mejillón con mínimo de 1 kg | 350 g de merluza → «400 g de merluza en rodajas» |
| Envase | `ceil(necesidad / envase)`, mínimo 1, absorbiendo excesos pequeños | 25 g de mantequilla → 1 pastilla; 22 aceitunas → 1 lata |
| Media pieza | Si la regla tiene `half` y la necesidad cabe en un 55 % de la pieza (est.) → «medio melón». Si tiene `half` pero no cabe → «1 melón (o medio si son muy grandes)» | — |
| Aviso de exceso | Si el redondeo pasa del doble de lo que se necesita, la app dice «sobrará» y no pregunta | 50 g → 100 g de jamón |

Este conversor arregla además un fallo silencioso: hoy, una cantidad en gramos por debajo de 12,5 g se redondea a 0 en tramos de 25 g y **la línea desaparece sin aviso** ([shoppingList.ts:79-87](../../apps/api/src/services/shoppingList.ts)), así que dos dientes de ajo o un poco de perejil nunca llegan al pedido. Con la tabla, cualquier necesidad mayor que cero de un producto con mínimo da al menos una unidad de venta.

### Genéricos: valor por defecto con alternativa, o pregunta

En el catálogo hay 54 filas genéricas, y en 17 de ellas la tienda no puede servir nada sin que alguien elija: pollo, ternera, cerdo, cordero, jamón, panceta, pescado entero, pulpo, pasta, fideos, setas, entre otras ([ona_datos_y_codigo.md](<../research_notes/Pedir en tiendas de frescos/ona_datos_y_codigo.md>)). Las fuentes justifican **dos tratamientos distintos**. ONA debe **preguntar una vez y recordar** solo en tres casos: cuando el genérico no deja deducir la pieza («carne», «cerdo», «ternera» sin uso), cuando la elección multiplica el precio por más de dos (ibérico frente a serrano: 65 frente a 21,95 €/kg) y cuando cambia la cantidad física (pollo de corral de 3,5 kg frente a uno industrial de 1,7 kg). En el resto, un **valor por defecto concreto con una alternativa con nombre** es mejor que la pregunta, porque cada pregunta abierta cuesta un viaje de ida y vuelta por WhatsApp.

| Genérico | Primero mira | Si no hay pista | ¿Pregunta? |
|---|---|---|---|
| Pescado entero | La nota y el uso de la receta (horno, plancha) | «2 doradas de ración, limpias para el horno (o lubinas, la que esté mejor hoy)». En Los Alonso cuestan lo mismo y la dorada es de piscifactoría, así que el precio es estable | No; selector Dorada · Lubina · Gallo · «Que me recomiende» |
| Pescado blanco / azul | La receta | «Medio kilo de merluza en lomos sin piel ni espinas (si no está buena hoy, otro que me recomendéis)» | No |
| Jamón | La nota («en taquitos», «loncheado») | — | **Sí, una vez**: «¿Serrano o ibérico?»; se recuerda |
| Jamón york | — | «Jamón cocido extra, en lonchas» | No |
| Carne picada | «de ternera», «de cerdo» | Picada mixta; ternera si es hamburguesa | No (la proporción es opcional) |
| Pollo | «pechuga», «contramuslos», «alitas» | Guiso → troceado; asado → entero | Una vez: «¿normal, campero o de corral?» |
| Ternera / cerdo / carne | «picada», «filetes», «guisar», «costillas» | — | **Sí**, si la receta no deja ver el uso |
| Tomate, pimiento, naranja, manzana, patata | Nota y uso de la receta | Tomate de ensalada, pimiento italiano, naranja de zumo… (est.) | No; se cambia en la tarjeta |
| Queso, pan, harina (manuales) | Coincidencia con algo de las recetas | — | **Sí**: «¿Qué queso?», «¿barra, hogaza o molde?», «¿la normal o la de fuerza?» |
| Yogur | Recetas (`yogur natural`, «griego») | Natural, pack de 4 | No |

Hay que evitar la cara opuesta del problema: un genérico nunca debe llegar tal cual al mensaje. Solo si el usuario elige «que me recomiende», la línea queda así: «Pescado para el horno, 2 raciones: ¿qué tenéis hoy fresco (dorada, lubina…)?».

### Duplicados, manuales sin cantidad y notas de receta

Los duplicados deben fusionarse **en el borrador, no en la lista**. La razón es que el estado de la lista (marcado, en casa) se guarda por `ingredientId|unit` y se rehace en cada lectura ([routes/shopping.ts:241-262](../../apps/api/src/routes/shopping.ts)), así que fusionar ahí rompería ese estado. La clave de fusión es la `key` de la regla, sacada del ingrediente, de un alias o del nombre del manual ya resuelto. Así se juntan `limón` + `limon` + `zumo de limón`, `ajo` + `dientes de ajo`, y `yema de huevo` con `huevo` (una yema es un huevo). Las necesidades se suman en gramos y se convierten una sola vez. Si hay un manual sin cantidad y una receta, manda la cantidad de la receta convertida. Si el manual tiene cantidad, se suman y se absorben los excesos de menos de un envase: 6 l de leche más 50 ml son 6 briks, no 7. Las **variantes de una misma familia no se fusionan solas**: receta `jamon` más manual «Jamón serrano», `harina de fuerza` más «Harina», o «Queso» más `feta` llevan la pregunta «¿El jamón de la receta es el serrano que has apuntado?». Aparte hay que limpiar el catálogo: 9 grupos de duplicados exactos (22 filas) se reasignan a su fila canónica (la clave foránea es `restrict`, así que se reasigna antes de borrar), se rellenan las 60 filas sin pasillo y se arreglan los nombres sucios del import (`cebollino fresco, un manojo`, `cdta y media de salsa worcestershire`, el solomillo con la preparación en el nombre).

Los **manuales** son hoy la fuente de ruido más grande: entran con `ingredientId: null`, cantidad 1, unidad `u` y pasillo `otros`, y el formulario empieza con «1» ya escrito ([routes/shopping.ts:607-618](../../apps/api/src/routes/shopping.ts); [ShoppingExtensions.tsx:81-83](../../apps/web/src/components/shopping/ShoppingExtensions.tsx)). Al añadirlos, ONA debe resolver el nombre (normalizar, buscar alias y, si no, `tokenSetMatch` sobre el catálogo), rellenar ingrediente y pasillo, y guardar si la cantidad la puso el usuario o es por defecto (`quantitySource: 'user' | 'default'`). El formulario debe empezar vacío. En el borrador, un manual sin cantidad se trata según la regla. Si se pide por pieza, sale 1 unidad de venta y se puede enviar («1 calabacín»). Si se pide por envase, sale 1 envase («Bebida de avena: 1 brik»). Si se pide **por peso, bloquea el envío hasta que el usuario pone gramos**, con una sugerencia de un toque («¿150 g?»), que es exactamente la queja del jamón. Si no hay regla, sale **solo el nombre, sin cantidad** («Galletas Daniela»), porque la tienda entiende un paquete mejor que «1 unidad». Un compuesto con palabra de familia («Fruta (fresas, plátanos…)», «Hierbas aromáticas (romero, tomillo)») se divide en hijos, cada uno con su regla.

Las **notas de receta** existen en la base de datos pero se pierden por el camino: `recipe_ingredients.note` no se selecciona al agregar la lista, `ShoppingItem` no tiene campo de nota y el borrador pone `note: null` en todas las líneas ([shoppingList.ts:349-364](../../apps/api/src/services/shoppingList.ts); [draft.ts:73](../../apps/api/src/services/shopOrders/draft.ts)). De 47 filas con notas, en 19 la nota cambia lo que hay que comprar ([data_catalogo_ingredientes_prod.csv](<../research_notes/Pedir en tiendas de frescos/data_catalogo_ingredientes_prod.csv>)). Hay tres casos. Si la nota es una variante, cambia el producto y separa la línea («morada en juliana fina» → cebolla morada; «cherry partido» → tomate cherry; «tipo japonés» → arroz redondo; «cocidos, escurridos» → garbanzos en bote). Si es trabajo de la tienda, va a `ShopOrderLine.note`, que ya se escribe entre paréntesis («picada», «en filetes de 2 cm», «en taquitos grandes», «desmigado»). Si es preparación en casa o una alternativa («en juliana», «rallado», «su zumo», «si vegano», «o bulgur»), se descarta reutilizando la lista de tokens de ruido de `ingredientTokenMatch.ts`. Esto cierra la limitación que hoy reconoce la spec: «recipe notes aren't carried into the list yet» ([shop-orders.md](../../specs/shop-orders.md)).

## En el súper, la despensa nunca entra sola

Para el súper conviene separar el pedido en tres niveles, siguiendo el modelo de la industria de receta-a-cesta. La API de Instacart para recetas tiene un indicador `enable_pantry_items` que **por defecto es `false`**, porque son «items that a user might already have at home and doesn't need to add to the cart» ([Instacart Developer Platform](https://docs.instacart.com/developer_platform_api/api/products/create_recipe_page/)). El catálogo de ONA muestra por qué importa: los ingredientes más usados son justo esos básicos, como aceite de oliva (47 usos), sal (38) y pimienta (19). Y los envases del súper están muy estandarizados (harina y legumbre seca en paquete de 1 kg, leche en brik de 1 l, mantequilla en 250 g, aceitunas en lata de 150 g, alcaparras en frasco de 80 g, feta en 150 g en ECI), así que las cantidades de receta se quedan en fracciones mínimas: **25 g de mantequilla son el 10 % de una pastilla, 50 ml de leche el 5 % de un brik y 150 g de harina de fuerza el 15 % del único paquete que hay** ([ECI, «mantequilla»](https://www.elcorteingles.es/supermercado/buscar/?question=mantequilla&catalog=supermercado); [ECI, «harina de fuerza»](https://www.elcorteingles.es/supermercado/buscar/?question=harina%20de%20fuerza&catalog=supermercado); [ECI, «alcaparras»](https://www.elcorteingles.es/supermercado/buscar/?question=alcaparras&catalog=supermercado); [Mercadona, lácteos](https://tienda.mercadona.es/api/categories/72/?lang=es&wh=mad1)).

| Nivel | Qué entra | Cómo sale | Ejemplos del pedido real |
|---|---|---|---|
| **Despensa** | Sal, pimienta, aceite, vinagre, especias secas, azúcar, harina de trigo común, salsa de soja, caldo en pastilla | **Nunca se añade sola.** Aparece en un bloque plegado «¿Te falta algo de esto?», todo desmarcado; si se marca, se añade el envase por defecto | (Hoy ya se omiten 19 por regex; la harina común manual sí entra porque el usuario la escribió) |
| **Nevera en poca cantidad** | Mantequilla, leche, nata, huevos o yema, queso rallado, parmesano, cuando la receta pide menos del 25 % del envase más pequeño (est.) | Línea con el envase más pequeño y la marca «probablemente lo tienes», **desmarcada por defecto**. Si el usuario ya escribió «leche», se fusiona sin preguntar | Mantequilla 25 g → «1 pastilla (250 g) · solo usas 25 g»; yema → «media docena de huevos» |
| **Resto** | Todo lo demás, y los básicos que pasan del umbral | `ceil(cantidad / envase)` envases, con la cantidad de receta solo en la app | Feta 200 g → 2 envases de 150 g; lentejas 400 g → 1 frasco de cocidas |
| **Especial** (dentro de «resto») | Lo que casi nadie tiene en casa: feta, alcaparras, harina de fuerza, aceitunas | Se añade siempre, aunque la cantidad sea pequeña. Lo decide la lista de la regla, no el porcentaje | Harina de fuerza 150 g → 1 paquete de 1 kg |

El umbral del 25 % es una decisión de diseño, no una cifra publicada por ningún proveedor, y hay que ajustarlo con el uso. Un «Mi despensa» por hogar, que recuerde lo marcado como «lo tengo», evitaría repetir la pregunta cada semana.

El Corte Inglés funciona en ONA como **lista web con un enlace de búsqueda por línea** (`shopSearchUrl` en [message.ts](../../apps/api/src/services/shopOrders/message.ts)), y Akamai bloquea las peticiones que no vienen de un navegador (HTTP 403), así que el servidor de ONA no puede resolver productos por su cuenta. Por eso la calidad del texto de búsqueda es la calidad del pedido. La búsqueda de ECI es literal y cubre toda la tienda, perfumería y limpieza incluidas, y las palabras genéricas fallan de forma llamativa:

| Lo que ONA busca hoy | Qué devuelve ECI | Búsqueda que funciona |
|---|---|---|
| [«barra de pan»](https://www.elcorteingles.es/supermercado/buscar/?question=barra%20de%20pan&catalog=supermercado) | Barras de labios Maybelline | Mejor no pedir pan fresco al súper online; «pan de molde» o «hogaza» |
| [«queso»](https://www.elcorteingles.es/supermercado/buscar/?question=queso&catalog=supermercado) | Tartas de queso y una tableta Milka | [«queso curado»](https://www.elcorteingles.es/supermercado/buscar/?question=queso%20curado&catalog=supermercado), «queso rallado», «queso sandwich» |
| [«leche avena»](https://www.elcorteingles.es/supermercado/buscar/?question=leche%20avena&catalog=supermercado) | Danacol, avena cocida, lociones corporales | [«bebida de avena»](https://www.elcorteingles.es/supermercado/buscar/?question=bebida%20de%20avena&catalog=supermercado) |
| [«yema»](https://www.elcorteingles.es/supermercado/buscar/?question=yema&catalog=supermercado) | Yemas de espárragos | «huevos» |
| [«cebolla morada»](https://www.elcorteingles.es/supermercado/buscar/?question=cebolla%20morada&catalog=supermercado) | Una sola cebolla («cebolla roja 500 g»), y luego pizzas y patatas fritas | «cebolla roja» (o mejor, frutería) |
| [«sal»](https://www.elcorteingles.es/supermercado/buscar/?question=sal&catalog=supermercado) · [«vinagre»](https://www.elcorteingles.es/supermercado/buscar/?question=vinagre&catalog=supermercado) | Sal de lavavajillas; vinagre de limpieza | «sal fina», «vinagre de vino» |
| [«alubias»](https://www.elcorteingles.es/supermercado/buscar/?question=alubias&catalog=supermercado) | Judías verdes | [«alubia blanca»](https://www.elcorteingles.es/supermercado/buscar/?question=alubia%20blanca&catalog=supermercado) |
| [«galletas daniela»](https://www.elcorteingles.es/supermercado/buscar/?question=galletas%20daniela&catalog=supermercado) | Ningún producto Daniela | Avisar «no lo encuentro aquí» y ofrecer moverlo de tienda |
| «mantequilla» | Mezcla de formatos | [«mantequilla 250 g»](https://www.elcorteingles.es/supermercado/buscar/?question=mantequilla%20250%20g&catalog=supermercado): los 6 primeros resultados son de 250 g |

La regla general es buscar el sustantivo con el que ECI nombra el producto, más el modificador que fija la categoría y, si ayuda, el tamaño: «harina de fuerza», «lentejas cocidas», «nata para cocinar», «mantequilla 250 g». Eso es el campo `eciQuery` de la tabla. Los nombres coloquiales, las partes de un producto y las palabras sueltas deben pasar siempre por esa traducción.

## El mensaje lleva dirección, hora y un hueco para añadir

El texto de hoy tiene tres defectos que no dependen de las líneas ([message.ts:26-40](../../apps/api/src/services/shopOrders/message.ts)). Si la tienda está en «domicilio» pero no hay dirección, el mensaje **cambia sin avisar a «para recoger en la tienda»**. Nunca pregunta a qué hora llegará el pedido ni a partir de qué hora se puede recoger. Y la entrega y la dirección son de la tienda, no del pedido, así que no se puede pedir a domicilio un día y recoger otro ([schema.ts:907-908](../../apps/api/src/db/schema.ts)). La solución es mover `fulfilment` y `address` a `shop_orders`, con el valor de la tienda por defecto y un selector en la tarjeta del borrador; **bloquear el envío a domicilio sin dirección**; y cerrar siempre con la pregunta de la hora. El lector de respuestas ya extrae `pickupText` ([shopOrders.ts:91](../../packages/shared/src/types/shopOrders.ts)), así que la respuesta de la tienda se aprovecha sin trabajo extra.

No se encontró **ningún corpus de pedidos reales por WhatsApp** a fruterías, carnicerías ni pescaderías españolas. Las plantillas siguientes combinan las fórmulas habladas documentadas («¿me pone medio kilo?», «un cuarto», «solo una pieza») ([glosario de mercado](https://andalucia.com/costa-del-sol/markets/glossary)), el vocabulario de la propia tienda (en el caso de Los Alonso) y los requisitos de Miguel. Son el pedido real de Miguel reescrito, con `[dirección]` en lugar de la suya; «Soy Miguel» sale del campo «tu nombre para la tienda».

**Frutería, a domicilio:**

> Hola, soy Miguel. Os paso un pedido para que me lo traigáis a [dirección]:
>
> - 1 cabeza de ajos
> - 2 cebollas
> - 2 cebollas moradas
> - 3 tomates de ensalada
> - 2 zanahorias
> - 1 pepino
> - 1 pimiento verde italiano
> - 1 calabacín
> - 5 limones
> - 1 manojo de romero y 1 de tomillo
> - 1 bandeja de fresas
> - 1 kg de naranjas de zumo
> - 1 kg de mandarinas
> - 6 plátanos de Canarias
> - 1 mango
> - 1 melón piel de sapo (o medio, si son muy grandes)
>
> ¿Me decís el total aproximado y más o menos a qué hora llegaría? Gracias.

**Carnicería, para recoger:**

> Hola, soy Miguel. Os paso un pedido para recoger en la tienda:
>
> - 100 g de jamón serrano, loncheado fino
> - 150 g de jamón cocido extra, en lonchas
>
> Si no hay algo, decidme qué me recomendáis en su lugar. ¿Me decís el precio por kilo, el total aproximado y a partir de qué hora puedo pasar? Gracias.

**Pescadería, a domicilio:**

> Hola, soy Miguel. Os paso un pedido para que me lo traigáis a [dirección]:
>
> - 2 doradas de ración, limpias para el horno (o lubinas, la que esté mejor hoy)
>
> ¿Me decís el total aproximado y más o menos a qué hora llegaría? Gracias.

**El Corte Inglés (lista web, una casilla y un enlace «Buscar» por línea):** Bebida de avena, 1 brik (1 l) · Leche entera, 1 brik (1 l) · Feta, 2 envases (150 g) · Alcaparras, 1 frasco (80 g) · Aceitunas negras sin hueso, 1 lata (150 g) · Lentejas cocidas, 1 frasco (400 g) · Harina de fuerza, 1 paquete (1 kg) · Queso rallado, 1 bolsa (200 g) · Queso en lonchas, 1 paquete (200 g) · Yogur natural, 1 pack de 4 · Guisantes congelados, 1 bolsa · Galletas Daniela · *pendientes de elegir:* Queso, Pan, Harina · *probablemente lo tienes (desmarcado):* Mantequilla 1 pastilla, Huevos media docena.

En la plantilla, la pregunta del precio y la de la hora van juntas al final, que es lo que hoy ya hace el cierre con la disponibilidad y el total; la de la hora es la que falta. En las líneas, las notas cortas («o medio, si son muy grandes», «la que esté mejor hoy») van entre paréntesis dentro de la propia línea, donde el tendero las lee en contexto, y no como campo aparte (est.). Un detalle de la carnicería: la fórmula «Si no hay algo, decidme qué me recomendáis» tiene sentido en carne y pescado, pero en un pedido de solo charcutería sobra; la plantilla puede omitirla cuando todas las líneas son al corte (est.).

**El pedido mínimo** necesita un campo propio. Hoy solo cabe en `notes`, un texto libre de 300 caracteres que nadie lee ([shopOrders.ts:187](../../packages/shared/src/types/shopOrders.ts)). Los mínimos publicados por tiendas de barrio rondan los **20 €** (la frutería de Ana Crespillo en Fuengirola ([fuente](https://fruteria.dljresultados.com/)), Cárnicas Rovi en Alicante ([fuente](https://alicantecarniceria.es/))), los 30 € (Mercats a un Clic en Barcelona ([fuente](https://www.mercatsaunclic.barcelona/es-ES/))) o los 40 € (la tienda web de Frutas Eloy ([fuente](https://tienda.frutaseloy.com/))), y algunas pescaderías no ponen ninguno (Ángel García en Madrid ([fuente](https://www.pescaderiasangelgarcia.com/envio-a-domicilio)); Los Alonso no muestra mínimo). Hay que añadir `deliveryMinEur` (y opcionalmente gastos y días de reparto) a `household_shops` y al formulario de tiendas. Al preparar el borrador, ONA compara con `sumEstimate`: «≈ 18 € de 20 € de mínimo: te faltan unos 2 €», y ofrece habituales para llegar. La estimación es débil: solo hay precios de referencia para frutería, carnicería y pescadería, y las líneas por unidad sin precio quedan en `null` ([estimate.ts:15-24, 48-65](../../apps/api/src/services/shopOrders/estimate.ts)). Por eso, cuando la mayor parte del importe es de referencia o desconocido, el aviso debe decir «no sé si llegas al mínimo de 20 €» en lugar de dar una cifra falsa. El súper no tiene ninguna base para estimar.

**Añadir cosas antes de enviar** responde a la observación de Miguel de que el cliente «casi siempre añade cosas que tiene en mente». Hoy es imposible: el `PATCH` del borrador solo acepta `key`, `remove`, `note`, `quantity` y `moveToShopId` ([shopOrders.ts:262-276](../../packages/shared/src/types/shopOrders.ts); [store.ts:336-379](../../apps/api/src/services/shopOrders/store.ts)). Hay que ampliarlo con `add: [{ name, quantity?, unit?, note? }]` y pasar cada añadido por la misma resolución, regla y conversión que un manual. También hay que crear el artículo en la lista, porque cerrar un pedido marca como comprados los artículos por `sourceItemId` ([store.ts:477-481](../../apps/api/src/services/shopOrders/store.ts)), y una línea sin artículo nunca se marcaría. En la interfaz bastan un «Añadir algo más» en `OrderCard.tsx` y en la skill de chat, y una pregunta «¿Algo más para la frutería?» con botones de habituales sacados de los pedidos cerrados de esa tienda (`shop_orders.lines`).

## Ocho cambios, en el orden de las quejas

El orden sigue el daño que hace cada fallo en un pedido real: primero lo que hace que la tienda no entienda la línea, después lo que la manda a la tienda equivocada, y al final la limpieza. Cada paso lleva su test, como exige la regla de tests del repo: un fixture con las 33 líneas reales de Miguel y el texto esperado de cada una sirve de red para todos.

| # | Cambio | Ficheros | Test que lo protege | Esfuerzo (est.) |
|---|---|---|---|---|
| 1 | Tabla `BuyRule` + conversor `toOrderQuantity`; el texto de la línea usa la unidad de venta y el plural («2 zanahorias», «1 cabeza de ajos»), nunca «N unidades» | nuevo `packages/shared/src/data/buyRules.ts`; nuevo `apps/api/src/services/shopOrders/buyRules.ts`; `draft.ts:61-81`; `format.ts`; `shopFormat.ts:12-25` | Unitarios: 25 g de ajo → 1 cabeza; 150 g de zanahoria → 2; 25 g de mantequilla → 1 pastilla; melón con `half`; 5 g de perejil → 1 manojo | M |
| 2 | Manuales: resolución contra catálogo y alias, `quantitySource`, formulario sin «1»; los manuales por peso sin cantidad bloquean el envío | `packages/shared/src/types/shopping.ts`; `routes/shopping.ts:588-618`; `ShoppingExtensions.tsx:81-83`; `appSkills.ts:438-442`; `staples/page.tsx` | «Jamón york» sin cantidad → línea `needsQuantity`; «calabacín» manual → frutería | M |
| 3 | Genéricos: `choice` con valor por defecto o bloqueo, selector en la tarjeta, preferencia recordada por hogar; división de compuestos; arreglar el falso «lonja» por «gallo» en el nombre | `buyRules.ts`; `ShopOrderLine.needsChoice` en `types/shopOrders.ts`; `OrderCard.tsx`; `fish.ts:28` | «pescado entero fresco (…)» → «2 doradas de ración, limpias para el horno (o lubinas…)»; «Fruta (…)» → 6 líneas | M |
| 4 | Enrutado: la regla manda; nueva regla `PRODUCE` por nombre (después de `PACKAGED`); guarda `^pan\b` para «pan de hamburguesa»; tipo lógico `charcuteria` con respaldo; tienda aprendida cuando el usuario mueve una línea | `classify.ts:16-41`; `store.ts:354-357`; migración de datos de pasillos | `limón` sin pasillo → frutería; pan de hamburguesa → súper | S |
| 5 | Entrega por pedido; domicilio sin dirección bloquea; pregunta de hora siempre; `deliveryMinEur` y aviso honesto de mínimo | nueva migración (`shop_orders.fulfilment`, `address`; `household_shops.delivery_min_eur`); `message.ts:26-40`; `schema.ts:891-915`; `shopOrders.ts:175-195, 262-276`; `draft.ts:88-108` | `buildOrderMessage` a domicilio lleva la dirección y «¿más o menos a qué hora llegaría?»; sin dirección → error | M |
| 6 | Añadir antes de enviar: `PATCH { add }` + artículo en la lista + «¿Algo más?» con habituales | `shopOrders.ts:262-276`; `store.ts:336-379, 477-481`; `OrderCard.tsx`; skill de chat | Añadido → aparece en el mensaje y queda marcado al cerrar | S |
| 7 | Notas de receta de punta a punta: variante, preparación de tienda o descartar | `shoppingList.ts:349-364`; `ShoppingItem.notes`; `draft.ts:73`; `ingredientTokenMatch.ts:39-54` | «ternera + picada» → «medio kilo de carne picada de ternera»; «cebolla + morada en juliana» → cebolla morada | M |
| 8 | Fusión por clave de compra en el borrador, pregunta para variantes de familia, súper en tres niveles, `eciQuery`, y limpieza del catálogo (duplicados, 60 pasillos, nombres sucios) | `draft.ts:40-50`; `message.ts` (`shopSearchUrl`); migración de datos | leche + leche entera → 1 línea; yema → huevos; búsqueda ECI de «leche avena» = «bebida de avena» | M |

El gate de specs del repo obliga a reescribir en el mismo PR las secciones de [shop-orders.md](../../specs/shop-orders.md) sobre preparación, enrutado y limitaciones («no pack-size rounding», «recipe notes aren't carried»), y la tabla de tiendas en la parte de modelo de datos. El punto 4 toca además la agrupación de `/shopping`, que hoy enseña en «Otros» las filas sin pasillo.

### Qué tienen que validar Miguel y sus tiendas

La mayoría de los números de la tabla tienen fuente, pero su aplicación a estas cuatro tiendas no. La forma más barata de validarlos es el propio uso: guardar cada vez que el usuario corrige una cantidad o una tienda, y preguntar a cada tienda tres cosas por WhatsApp. Lo que queda abierto, por prioridad:

| Dato | Estado | Quién lo valida |
|---|---|---|
| Mínimos al corte: 100 g de charcutería, 250 g de carne a granel | Estimación (el mercado de Zaragoza pide 200 y 500 g, pero solo online) | Ben-Car: «¿cuál es lo mínimo que me ponéis de jamón y de picada?» |
| Pedido mínimo a domicilio, gastos y franja de reparto de las 4 tiendas | Desconocido (Los Alonso no publica mínimo en su web y entrega el mismo día en su zona 1 si se pide antes de las 13:00) | Las tiendas; se guarda en `deliveryMinEur` |
| Si las tiendas aceptan líneas sin cantidad («Galletas Daniela», «perejil, si me lo podéis poner») | Desconocido | Miguel, con el primer pedido |
| Valores por defecto: tomate de ensalada, pimiento italiano, naranja de zumo, jamón loncheado fino, picada mixta, dorada | Estimación de producto | Miguel |
| Tolerancia del 15 % al redondear piezas y umbral del 25 % para «probablemente lo tienes» | Decisión de diseño sin fuente | Miguel, tras 2–3 semanas de pedidos |
| Pesos de pieza que no tienen fuente: manojo de acelgas o rábanos, trozo de jengibre, lima, aceituna por lata | Sin fuente | Correcciones del usuario en la tarjeta |
| Que Los Alonso entienda bien «limpias para el horno», «abierta para la espalda» | Son sus propias etiquetas web | Primer pedido real |
| Si la «lista rápida» de ECI acepta texto libre para pegar toda la lista | Sin verificar (solo una fuente secundaria) | Miguel, con sesión iniciada |

Por último, los pesos de referencia no siempre coinciden entre fuentes: el pepino pesa 125 g según la UCM y 190 g en la frutería de Glovo, y la coliflor 2 kg frente a 1,12 kg. La regla debe guardar un peso por defecto y aprender el de cada tienda con las correcciones, como ya hace `price_memory` con los precios.

## Conclusión

El primer pedido real demostró que el problema no es de redacción sino de modelo: ONA pensaba en ingredientes de receta y las tiendas venden productos con forma propia. El hallazgo que más cambia el plan es que **los arreglos baratos y los caros están en sitios distintos**. Los fallos de reparto (pasillos vacíos, regla de frutas por nombre, pan de hamburguesa) cuestan horas y corrigen de golpe casi la mitad de lo que estaba mal en la frutería. El trabajo de verdad está en curar la tabla «cómo se compra» y en tratar el artículo manual como un ciudadano de primera, porque 13 de las 33 líneas eran manuales y ninguna se cruzaba con nada. La carnicería y la pescadería ya se enrutaban bien. Su problema es la concreción, y la mitad de esa concreción ya existe en la base de datos, en notas de receta que hoy se tiran.

También cambia lo que se considera «terminado». Un pedido natural no es solo una lista bien escrita. Es una conversación que la tienda puede responder en un solo mensaje: con especie y preparación, con la dirección, con la pregunta de la hora y con un aviso honesto si no se llega al mínimo. Como no hay corpus de pedidos reales, la mejor fuente para las próximas semanas son las respuestas de las propias tiendas de Miguel. Cada «¿cuánto jamón quieres?» o «no tenemos dorada, ¿lubina?» que reenvíe a ONA es un dato para afinar la tabla, y ese circuito de corrección vale más que cualquier estimación de este informe.
