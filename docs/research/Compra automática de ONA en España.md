# ONA llena el carrito; España exige socios

Sí, España es un problema para que ONA haga la compra por el usuario. El obstáculo es la infraestructura comercial, no la ley. A octubre de 2026 ningún supermercado español publica una API de carrito para terceros. Tampoco queda ningún agregador con programa para desarrolladores: Lola Market cerró en 2022 y la plataforma de Instacart solo admite empresas de EE. UU. y Canadá. Y Mercadona, con el **27,4 % del gasto**, prohíbe por contrato el acceso programático y compartir la contraseña «ni siquiera de manera temporal». De las cinco primeras cadenas, solo Carrefour y Dia (un 13 % del mercado) ofrecen alguna vía oficial a terceros, y ninguna deja precargar el carrito en su propia web. Las normas que sí condicionan el diseño (autenticación reforzada del pago, botón de «pedido con obligación de pago», ley de IA) son europeas y rigen igual en Francia, donde Jow funciona porque las cadenas firmaron acuerdos con él. Además, en ningún país un agente de terceros paga la compra del súper por su cuenta; OpenAI incluso retiró el pago dentro del chat en marzo de 2026. La ruta recomendada es que **ONA monte la cesta y el supermercado cobre**, en cuatro fases: primero, una lista neta y fiable (semanas). Segundo, una cesta sugerida con productos y formatos, que el usuario revisa en ONA y que se entrega por las vías oficiales que existen, el carrito precargado de Amazon.es y la afiliación de Carrefour (unos dos meses). Tercero, un acuerdo con una cadena receptiva al estilo de Jow (meses de negociación). Y no antes de 2027, el pago delegado con huella. Hay que evitar automatizar Mercadona desde los servidores de ONA, guardar contraseñas de supermercados, revender comida y montar logística propia. El código de ONA ya resuelve bien el «qué comprar», pero le falta por completo el «cómo comprarlo». Este informe no es asesoramiento jurídico.

*Convenciones: «(observado)» indica una comprobación directa que hizo el equipo de investigación el 7-oct-2026 (cabeceras HTTP, llamadas a la API pública de Mercadona, lectura de condiciones legales). «(Inferencia)» marca un razonamiento propio que ninguna fuente confirma. La última sección resume qué está verificado y qué no.*

## España sí es un problema, de infraestructura comercial y no de leyes

España es más difícil que EE. UU. o Francia para convertir un menú en un pedido real. Se parece más a Alemania o a Países Bajos, donde cada cadena se guarda el carrito para sí. La diferencia está en tres piezas que allí existen y aquí no.

La primera es **un agregador con programa para desarrolladores**. En EE. UU., una sola integración con Instacart da acceso a más de 1.800 cadenas, pero sus términos exigen ser empresa o residente de **EE. UU. o Canadá** ([Instacart Developer Terms](https://docs.instacart.com/developer_platform_api/guide/terms_and_policies/developer_terms)). En España, Instacart solo vende tecnología a empresas, como la web de entrega en el día de Costco ([Instacart/Costco](https://s25.q4cdn.com/251036341/files/doc_news/Costco-Launches-First-Same-Day-Websites-in-France-and-Spain-with-Instacart-01-30-2026-2026.pdf)). El equivalente español, Lola Market, agregaba más de 260 tiendas, Mercadona incluida, y **cerró el 5 de noviembre de 2022** ([Alimarket](https://www.alimarket.es/alimentacion/noticia/360401/lola-market-echa-el-cierre-tras-cerca-de-ocho-anos-de-operaciones)). Ulabox cerró en 2023 ([Alimarket](https://www.alimarket.es/alimentacion/noticia_amp/368884/el-supermercado-ulabox-cierra-sus-puertas-y-se-prepara-para-el-cambio-a-sezamo)) y Getir salió del país ese mismo año ([Alimarket](https://www.alimarket.es/alimentacion/noticia_amp/375286/getir-se-retira-de-espana--italia-y-portugal)).

La segunda es **una tradición de cadenas que dejan a un tercero cargarles el carrito**. En Francia, Jow llena carritos en Carrefour, Intermarché, Leclerc o Monoprix y cobra una comisión ([Journal du Net](https://www.journaldunet.com/retail/1528101-hellofresh-jow-les-commis-le-panier-repas-continue-de-faire-des-adeptes/)). En España no consta ninguna integración receta→carrito de Jow, Mealz, Whisk o Cookidoo, y el dominio [jow.es](https://jow.es) está aparcado y a la venta (observado).

La tercera es **una API pública de carrito**, como la de Kroger, que añade productos a la cesta del usuario mediante OAuth ([Jentic](https://jentic.com/apis/kroger)). **Ningún supermercado español publica una API de catálogo, carrito o pedido para terceros**, ni abierta ni para socios ([MercaEx](https://readme.hex.pm/merca_ex/0.1.0)).

Mercadona pesa más que todo lo demás junto. Concentra el **27,4 % del gasto** (Worldpanel, 1S 2026), el triple que Carrefour con su 9,1 % ([Revista Mercados](https://revistamercados.com/lidl-dia-ganan-cuota-mercado-distribucion-alimentaria-2026/)), y es el n.º 2 del canal online con el 9,8 % ([NIQ](https://nielseniq.com/global/es-eu/news-center/2026/el-ano-2025-prolonga-la-tendencia-positiva-del-gran-consumo-impulsando-a-espana-como-uno-de-los-mercados-mas-dinamicos-del-sector-segun-niq/)). Sus condiciones de uso, actualizadas el 5 de junio de 2026, dicen literalmente que «no está permitido extraer ningún tipo de información de la Plataforma mediante alguna técnica de programación». Añaden que la contraseña no puede comunicarse a terceros «ni siquiera de manera temporal», y que si se incumple pueden bloquear la cuenta ([Mercadona T&C](https://tienda.mercadona.es/legal/terms/es/), observado). Su robots.txt excluye `/api` ([robots.txt](https://tienda.mercadona.es/robots.txt)) y la web está protegida por Akamai Bot Manager. Según una herramienta de la comunidad, el login, el carrito y el pago lanzados desde IP de centro de datos, como el Railway donde corre ONA, reciben «desafíos duros» ([mercadona-cli](https://mintlify.wiki/ivorpad/mercadona-cli/guides/agent-integration)).

Técnicamente sí se puede. La API JSON no oficial funciona, y existen un CLI con pago completo y un servidor MCP que solo llena el carrito ([GitHub](https://github.com/ivorpad/mercadona-cli); [Glama](https://glama.ai/mcp/servers/lu2l2fiila)). Pero cualquier producto de ONA hecho así nacería incumpliendo el contrato y dependería de que Mercadona no cambie un endpoint. La cobertura además tiene huecos. En una prueba directa con la API de códigos postales, 51 de 52 capitales tenían servicio, pero **Málaga capital y Marbella respondieron «fuera de zona»**, y también muchas poblaciones rurales como Ponferrada, Benavente o Mieres (observado). El pedido mínimo es de **60 € más 8,20 €** de preparación.

El resto del mercado está fragmentado. Lidl, la tercera cadena con el 7,3 %, **no vende alimentación online en España** ([Merca2](https://www.merca2.es/lidl-lanza-tienda-online)). Consum, Condis, Caprabo, Gadis, Ahorramas o bonÀrea solo cubren su región. Las cinco primeras cadenas suman el 52 % del gasto. De ellas, solo Carrefour (afiliación en Awin) y Dia (a través de su tienda en Amazon) ofrecen una vía oficial para que un tercero les lleve ventas, lo que equivale a un **13 % del mercado** (inferencia, sumando sus cuotas). Ninguna deja precargar el carrito en su propia web. Carrefour prohíbe modificar los enlaces de afiliado, y tanto Carrefour como Dia prohíben enlazar a su web sin consentimiento previo ([Awin 25399](https://ui.awin.com/merchant-profile/25399); [Carrefour aviso legal](https://www.carrefour.es/aviso-legal/mas-info/); [Dia aviso legal](https://www.dia.es/l/aviso-legal)).

Encima, las cadenas españolas están construyendo su propia versión de lo que ONA quiere hacer. En abril de 2026 Eroski lanzó **Smart Shop: compra por WhatsApp con IA que propone menús y monta la cesta**, en piloto en 9 tiendas de Bilbao ([Eroski](https://corporativo.eroski.es/notas-de-prensa/eroski-lanza-la-compra-por-whatsapp-con-inteligencia-artificial-y-entrega-ultrarrapida/)). Alcampo llena el carrito con IA predictiva ([Merca2](https://www.merca2.es/2026/06/19/plan-alcampo-tecnologia-2399813/)) y Carrefour tiene ClubIA ([La Ecuación Digital](https://www.laecuaciondigital.com/tecnologias/inteligencia-artificial/carrefour-lanza-clubia-el-primer-asistente-de-inteligencia-artificial-en-programas-de-fidelizacion-del-retail-espanol/)). Es razonable que vean a ONA más como un competidor por la relación con el cliente que como un canal de venta (inferencia).

La regulación no es un problema específico de España. La autenticación reforzada (SCA) de PSD2, el botón de pedido, el RGPD y la ley de IA son normas europeas y se aplican igual en Francia, donde Jow tiene entre 6 y 7 millones de usuarios. En pagos hechos por agentes, España va incluso por delante. En marzo de 2026, Santander y Mastercard completaron el primer pago real hecho de principio a fin por un agente de IA en Europa ([Santander](https://www.santander.com/en/press-room/press-releases/2026/03/santander-and-mastercard-complete-europes-first-live-end-to-end-payment-executed-by-an-ai-agent)). BBVA, CaixaBank, Bankinter y Abanca participaron en las transacciones reales de Visa de julio ([El Español](https://www.elespanol.com/invertia/empresas/banca/20260702/bbva-caixabank-bankinter-abanca-completan-visa-transaccion-agente-ia-piloto-europeo/1003744308386_0.html)).

Y la demanda crece. El online de gran consumo subió un **17,7 % en 2025** según NIQ y un 16,6 % según Circana. Mercadona online creció un 26 %, hasta 1.061 M€ ([Que.es](https://www.que.es/2026/04/11/mercadona-juan-roig-colmenas/)). Que no haya en España ningún actor receta→carrito establecido es a la vez el problema y la oportunidad.

| Pieza de infraestructura | EE. UU. | Francia | Reino Unido | Alemania / Países Bajos | **España** |
|---|---|---|---|---|---|
| Agregador multicadena con programa para desarrolladores | Sí (Instacart) | No, pero Jow y Mealz cumplen ese papel | Históricamente Whisk | No | **No** (Lola Market cerró en 2022) |
| API pública de carrito de una cadena | Sí (Kroger, sin pago) | No (acuerdos privados) | Solo la de Tesco de 2009, ya histórica | No (solo librerías no oficiales de Picnic) | **No** |
| Apps de terceros receta→carrito a escala | eMeals, Samsung Food, NYT Cooking | Jow (6-7 M de usuarios) | Samsung Food / Whisk | Casi todo dentro de la app de cada cadena | **Ninguna encontrada** |
| Asistente de la cadena dentro de ChatGPT (2026) | Instacart | Carrefour (marzo) | Tesco, beta propia | Knuspr, Albert Heijn | **No** (el de Carrefour existe en Francia y Bélgica, no aquí) |
| Peso del online en el gasto de alimentación | ~19 % | ~7-12 % según el estudio, con *drive* | ~12 % | — | **~3,6-7,3 %** (ver abajo) |

La tabla sintetiza las notas de precedentes internacionales ([Grocery Dive](https://www.grocerydive.com/news/kroger-jow-shoppable-recipes-grocery-ecommerce-profitability/706931/); [Ecommerce News](https://ecommerce-news.es/carrefour-integra-un-asistente-de-compra-con-ia-en-chatgpt-para-crear-cestas-personalizadas/); [EuroShop](https://www.euroshop-tradefair.com/en/media-news/euroshopmag/retail-technology/grocery-retail-is-embracing-conversational-commerce); [ESM](https://www.esmmagazine.com/index.php/retail/uk-grocery-inflation-steady-at-3-3-in-february-2025-kantar-283734); [SDCExec](https://www.sdcexec.com/home/news/22959069/brick-meets-click-us-egrocery-sales-surge-to-record-127b-in-december-2025); [LSA](https://www.lsa-conso.fr/le-drive-porte-les-ventes-de-pgc-en-ligne-et-la-livraison-a-domicile-gagne-du-terrain-en-france,455886)).

### 3,6 % o 7,3 %: las dos cifras de penetración miden universos distintos

Las notas recogen dos cifras para el peso del online en el gasto de gran consumo de 2025:

- **Circana: 3,6 %.** El canal «todavía representa solo el 3,6 % del valor», según la cita de Retail Actual ([Retail Actual](https://www.retailactual.com/noticias/20260205/gran-consumo-cifras-tendencias-2026)).
- **NIQ: 7,3 %**, con un crecimiento del 17,7 %. Así lo cita una investigadora a partir de la nota de prensa de enero de 2026 ([NIQ](https://nielseniq.com/global/es-eu/news-center/2026/el-ano-2025-prolonga-la-tendencia-positiva-del-gran-consumo-impulsando-a-espana-como-uno-de-los-mercados-mas-dinamicos-del-sector-segun-niq/)). El investigador de supermercados leyó la misma página y su herramienta de resumen le dio también el 7,3 %. Lo marcó como probable confusión con la cuota física de Lidl, que en Worldpanel es justo un 7,3 %. Ninguno de los dos citó la frase literal de NIQ, así que **esa cifra no está verificada**.

Las propias cifras de las notas apoyan que el 7,3 % sí es un dato de NIQ:

- **Primer cruce.** Mercadona vendió 1.061 M€ online. Si eso es el 9,8 % del online según NIQ, el online total rondaría los 10.800 M€, es decir, **alrededor del 8 % de los 131.000 M€** de gasto total que da la misma nota de NIQ. Con un 3,6 %, el online sería de unos 4.700 M€ y a Mercadona le correspondería el 22 %, más del doble de lo que le atribuye NIQ.
- **Segundo cruce.** Con un 7,3 % de online, una cuota online del 9,8 % y una cuota total del 27,4 %, el online de Mercadona sería el 2,6 % de sus ventas, casi exactamente el **2,5 % que declara la compañía** ([Que.es](https://www.que.es/2026/04/11/mercadona-juan-roig-colmenas/)). Con un 3,6 % saldría un 1,3 %.

Son cálculos propios que mezclan paneles (Worldpanel y NIQ) y suponen que la cifra online de Mercadona es solo de España. Son indicios, no pruebas.

La lectura más coherente es que las dos cifras son reales pero miden universos distintos (inferencia). El ranking online de NIQ lo encabeza Amazon con el 36,6 %, muy por delante de cualquier supermercado. Eso apunta a un gran consumo en sentido amplio, con mucho peso de droguería, limpieza y mascotas, categorías en las que Amazon es fuerte. La fuente secundaria no da la definición del 3,6 % de Circana.

Para lo que le importa a ONA, que es la compra semanal de alimentación en un supermercado y con mucho producto fresco, la cifra prudente es **3,6-4 %**, y el 7,3 % es el techo del gran consumo en sentido amplio. Con cualquiera de las dos, **más del 92 % del gasto se hace en tienda física**, frente a un 12,3 % de online en el Reino Unido o un 19 % en EE. UU. Así que la conclusión de producto no cambia: para la gran mayoría de usuarios de ONA, «hazme la compra» va a significar durante años «prepárame la lista para ir al súper». El 1,2 % que todavía circula es de 2018 y está desfasado ([FoodRetail](https://www.foodretail.es/retailers/ecommerce-alimentos-movil_0_1262573734.html)). Conviene leer directamente la nota de NIQ para cerrar la duda.

## La ruta recomendada: ONA monta la cesta y el supermercado cobra

El principio que lo ordena todo es separar el problema en dos mitades:

- **La mitad de ONA**: lo que sabe hacer y nadie más tiene (el menú de la semana, el tamaño del hogar, la despensa, las preferencias), convertido en una cesta que el usuario revisa.
- **La mitad de la cadena**: el catálogo vivo, la franja de entrega y el cobro.

Es la arquitectura de Jow, de Mealz con Carrefour Bélgica y de Knuspr, y también la de la API de Kroger, que se para en el carrito ([Mealz](https://www.mealz.ai/blog-posts/agent-de-courses-ia-carrefour-belgique-chatgpt); [Jentic](https://jentic.com/apis/kroger)). Hoy es la única que encaja sin fricción con la SCA y con el botón de pedido del art. 98.2 del TRLGDCU, porque quien pulsa «pagar» en la web de la cadena es el propio usuario. La hoja de ruta avanza de menos a más dependencia de terceros, y cada fase vale por sí misma aunque la siguiente no llegue.

| Fase | Plazo orientativo (inferencia) | Qué recibe el usuario | Qué construye ONA | Señal para pasar a la siguiente |
|---|---|---|---|---|
| **0. Lista neta** | 2-3 semanas | «Hazme la compra» devuelve la lista del periodo descontando la despensa y lo básico que ya tiene en casa, sin duplicados entre miembros del hogar, ordenada por pasillos y exportable | Arreglos a–f de la sección de código | Los usuarios la usan para comprar y reportan pocos errores |
| **1. Cesta sugerida con relevo oficial** | ~2 meses de un desarrollador | Cesta con tipo de producto, formato («1 bandeja de 500 g de carne picada») y € estimados; revisión en `/compra/[id]`; botón a Amazon.es con el carrito ya cargado, o a Carrefour con la lista al lado | Matching, formatos, perfil de entrega, pedido como foto fija, skills y página de revisión | Matching preciso y cestas que llegan al relevo: son los datos para negociar |
| **2. Socio de distribución** | 3-9 meses de negociación + 3-6 semanas de integración | Carrito real ya cargado en la cadena socia; la franja y el pago se hacen allí | Adaptador por cadena, cola de trabajos y vinculación de cuenta si la cadena la ofrece | Contrato firmado |
| **3. Pago delegado** | 2027 o después | «Confirmo con la huella y ONA cierra el pedido» | Integración con tokens de agente (Visa/Mastercard) y con AP2, UCP o ACP | Una cadena española acepta tokens de agente y ONA puede registrarse como agente de confianza |

### Fase 0: la lista neta es el producto para más del 90 % de la compra

Más del 92 % del gasto en alimentación se hace en tienda física y los clientes de Mercadona no tienen vía oficial. Para la mayoría de usuarios, «hazme la compra» va a significar durante bastante tiempo «dame la lista exacta para ir al súper». Hoy esa lista tiene defectos que un pedido real multiplicaría:

- **Pierde la variante del ingrediente.** Escribe «ternera 500 g» en lugar de carne picada y «pasta 250 g» en lugar de placas de lasaña.
- **No descuenta la despensa real.**
- **El asistente y la app no ven la misma lista.** El skill `get_shopping_list` que usa el asistente calcula una lista distinta de la que muestra la app.
- **Puede haber dos listas por hogar.** Dos miembros del mismo hogar pueden tener la lista en estados distintos.

El detalle está en la sección de código. La fase 0 corrige todo esto y añade una política para lo básico «que ya tienes» (sal, aceite, especias), para que la cesta no meta un litro de aceite cada semana.

El gancho en WhatsApp ya existe: el recordatorio proactivo de compra de los sábados ([`outbound.ts:148-151`](../../apps/api/src/services/whatsapp/outbound.ts)) puede pasar a preguntar «¿te preparo la compra?».

### Fase 1: una cesta en formato súper que se enchufa donde hay vía oficial

La pieza que más valor crea no depende de ninguna cadena: convertir cada línea en un tipo de producto y un formato que se pueda comprar. Por ejemplo, redondear 375 g de carne picada a una bandeja de 500 g o 4 huevos a media docena, y apuntar lo que sobra como despensa para el menú siguiente. Es lo que hacen Jow e Instacart, y el gestor de despensa de ONA es una ventaja aquí ([Instacart docs](https://docs.instacart.com/developer_platform_api/guide/concepts/recipe/)). Esta cesta en formato súper ya mejora la compra en Mercadona o en la tienda física. Además, donde hay una vía oficial, cada línea se asocia a un producto concreto.

**La vía más prometedora es el formulario «Add to Cart» de Amazon Associates.** Precarga varios productos con sus cantidades en el carrito del usuario mediante los parámetros `ASIN.n`/`Quantity.n` y la etiqueta de afiliado, y el usuario paga en Amazon ([Amazon PA-API 5](https://webservices.amazon.co.jp/paapi5/documentation/add-to-cart-form.html)). En España cubriría dos cosas:

- **Amazon Fresh**, en seis ciudades (Madrid, Barcelona, Valencia, Sevilla, Zaragoza y Guadalajara), con más de 14.000 referencias en Madrid ([Amazon](https://press.aboutamazon.com/es/news/company-news/2026/7/centro-amazon-fresh-madrid-quinto-aniversario)).
- **La tienda de Dia dentro de Amazon**, con franjas de 2 horas en una quincena de zonas urbanas, Málaga incluida ([Amazon.es](https://www.amazon.es/gp/help/customer/display.html?nodeId=GTGBAWKHSRPLZDE8)).

Hay tres cosas sin verificar que deciden si esta vía sirve, y hay que comprobarlas antes de escribir código:

- que el formulario funcione en amazon.es (la URL `https://www.amazon.es/gp/aws/cart/add.html` se ha deducido por analogía con la de .com);
- que acepte productos (ASIN) de Fresh y de Dia;
- que ONA cumpla los requisitos de PA-API para poder buscar esos productos.

**La segunda vía es la afiliación de Carrefour en Awin**: 5 % de la cesta, cookie de 15 días y una cesta media de más de 120 € ([Awin](https://ui.awin.com/merchant-profile/25399)). Como los enlaces no se pueden modificar, el usuario llega a carrefour.es con la lista de ONA al lado y tiene que montar el carrito a mano. Es poco, pero es legal, inmediato y trae los primeros ingresos.

El flujo por WhatsApp sería este:

1. El usuario escribe «hazme la compra».
2. Un skill prepara la cesta en segundo plano. Casar entre 30 y 60 líneas no cabe con holgura en un turno del asistente.
3. ONA envía un mensaje proactivo del tipo «Tu cesta está lista: 42 productos, 87,40 €, faltan 2», con los botones Confirmar y Revisar.
4. «Revisar» abre `/compra/[id]` en la PWA para cambiar productos.
5. «Confirmar» entrega la cesta a la cadena, donde el usuario elige franja y paga.

Hay tres reglas de diseño:

- **La confirmación la impone el servidor**, no el prompt (ver la sección de código).
- **Si no se llega al pedido mínimo, la cesta avisa**, en vez de rellenarse sola hasta alcanzarlo.
- **El asistente se identifica como IA.**

Lo más importante que produce esta fase son datos: la precisión del matching, el porcentaje de líneas que el usuario cambia, cuántas cestas llegan al relevo y el importe medio. Son justo los argumentos que necesita la fase 2.

### Fase 2: un socio, y el orden en que conviene llamar a las puertas

Jow no ganó Francia por tecnología, sino por acuerdos con cada cadena. Cada una acepta el carrito que le carga Jow, le paga una comisión inferior al 10 % y elige con él productos de más margen o con exceso de stock ([Grocery Dive](https://www.grocerydive.com/news/kroger-jow-shoppable-recipes-grocery-ecommerce-profitability/706931/)). Su argumento comercial es el que ONA tendría que llevar a una cadena española, apoyado en los datos de la fase 1: cestas semanales precargadas de 80-130 €, el 70 % del contenido decidido por la app y «+5 puntos de margen» según su fundador ([Le Panier](https://lepanier.io/jow-la-bataille-des-parts-destomac-pour-occuper-la-cuisine-avec-jacques-edouard-sabatier/)).

El orden lógico de puertas (inferencia) sería este:

1. **Carrefour España.** Ya tiene afiliación. Su grupo hizo con Mealz el asistente de ChatGPT de Francia y Bélgica y se adhirió al protocolo UCP de Google ([FoodRetail](https://www.foodretail.es/retailers/carrefour-permitira-comprar-online-directamente-desde-la-ia-de-google.html)). También puede elegir a Mealz en lugar de a ONA.
2. **Dia.** Tiene la cobertura online más amplia (84 % de la población según la propia empresa, sin verificar en la fuente original) y ya está acostumbrada a vender a través de terceros como Amazon o Just Eat.
3. **Alcampo.** Funciona sobre la plataforma de Ocado, y su robots.txt es el único que se declara abierto a «LLMs y asistentes», salvo carrito y pago ([robots.txt](https://www.compraonline.alcampo.es/robots.txt)).
4. **Bon Preu.** También va sobre Ocado y fue el servicio online mejor valorado por la OCU en 2024, aunque solo cubre Cataluña ([AJ Bell](https://www.ajbell.co.uk/news/articles/ocado-plans-new-fulfilment-centre-spain-support-partner-bon-preu)).
5. **Eroski.** Puede ser socio o competidor, porque su Smart Shop por WhatsApp hace lo mismo que ONA.

Mercadona va la última: no ha dicho nada en público sobre colaborar con terceros.

En lo técnico, cada socio exige un adaptador propio (L, de una a tres semanas) y una cola de trabajos. Lo que marca la duración real es el ciclo comercial.

### Fase 3: el pago delegado llegará, pero no lo decide ONA

Los medios de pago para agentes existen, pero ningún supermercado español los acepta:

- **Visa** ha hecho transacciones reales de agente con BBVA, CaixaBank, Bankinter y Abanca, autenticadas con *passkeys*, pero en comercios de viajes y retail, sin ningún supermercado ([Visa](https://www.visa.co.uk/about-visa/newsroom/press-releases.3457328.html)).
- **Santander** describe su prueba como un piloto, no como un despliegue comercial.
- **Stripe**: sus Shared Payment Tokens ya listan España, pero están en *preview* y solo sirven si el vendedor cobra con Stripe ([Stripe](https://docs.stripe.com/agentic-commerce/concepts/shared-payment-tokens.md?agent-seller=agent)).
- **Google**: el pago con UCP solo funciona en EE. UU., Canadá y Australia ([Google](https://support.google.com/merchants/answer/16837055?hl=en)).
- **Redsys**, la principal pasarela de cobro de los supermercados españoles, no ha anunciado nada.

Incluso cuando llegue, el modelo europeo mantiene un paso del usuario en cada compra (huella o *passkey*), así que «pagar sin tocar el móvil» no es un objetivo realista. A ONA le basta con diseñar el pedido como un objeto con estados (borrador, revisado, confirmado, enviado). Así, el día que exista este medio de pago será un paso más y no una reescritura.

### Cuatro atajos que no lo son, y la tentación Mercadona

Hay cuatro caminos que parecen atajos y no lo son:

- **Automatizar la web del supermercado desde el servidor de ONA** con las credenciales del usuario. Choca con las condiciones de Mercadona y de Carrefour y con sus protecciones antibots (Akamai y Cloudflare), y convertiría a ONA en custodio de credenciales de mucho valor, con todo lo que exigen el RGPD y la guía de la AEPD sobre IA agéntica.
- **Revender**, es decir, cobrar al usuario y que ONA compre al súper. ONA pasaría a ser operador alimentario, con registro sanitario, IVA a tres tipos y responsabilidad de comerciante, y probablemente incumpliría las condiciones de las cadenas.
- **Montar logística propia.** Es el negocio de HelloFresh, cuyos ingresos cayeron un 9 % a tipo de cambio constante en 2025 ([Nasdaq](https://www.nasdaq.com/articles/hellofresh-fy25-net-loss-narrows-revenues-orders-down-warns-fy26)).
- **Apoyarse en agentes de navegador genéricos.** En una prueba de Xataka sobre Mercadona, el agente de ChatGPT Atlas confundió ajo morado con cebolla roja y añadió productos que nadie había pedido para llegar al mínimo ([Xataka](https://www.xataka.com/robotica-e-ia/agente-chatgpt-atlas-me-ha-hecho-compra-mercadona-ahora-tengo-despensa-llena-ajos)).

La tentación Mercadona merece análisis propio, porque es la única forma de llegar al 27 % del mercado. La variante menos mala sería la del servidor MCP de la comunidad: el usuario inicia sesión en su propio navegador, una extensión (o un paso dentro de la app) escribe el carrito desde su dispositivo, ONA nunca ve la contraseña ni la tarjeta y el pago se hace en la app de Mercadona ([Glama](https://glama.ai/mcp/servers/lu2l2fiila)). Ese diseño esquiva el bloqueo de las IP de centro de datos y se parece más a «el usuario usando su propia cuenta». Es la lógica con la que un tribunal de apelación de EE. UU. dio la razón a Perplexity frente a Amazon, aunque eso no tiene valor en España ([Cooley](https://www.cooley.com/news/insight/2026/2026-08-06-ninth-circuit-rules-on-ai-agent-access-to-third-party-websites-under-cfaa)).

Aun así, este diseño sigue incumpliendo la cláusula de «técnica de programación», expone al usuario a que le bloqueen la cuenta y deja el producto a merced de un cambio de endpoint. Según notas internas no verificadas, un competidor, Comodón, ya llena la cesta de Mercadona «usando tokens de sesión, sin API oficial» ([nota interna](../../company/research_notes/Fase%20cero%20de%20productos%20explosivos/nutricion_consumo.md)). La recomendación (juicio propio) es no construir el producto sobre esto. Si se quiere medir la demanda, que sea un experimento cerrado: usuarios avisados del riesgo, sin pago y con un interruptor para apagarlo.

### La compra no paga la empresa: 3-6 € por pedido

Las comisiones de alimentación son bajas:

- **Carrefour:** 5 %.
- **Amazon Fresh España:** alrededor del 3 % según una fuente secundaria ([Influencer Hero](https://www.influencer-hero.com/es/blogs/amazon-influencer-commission-rates)). En EE. UU., Amazon la bajó al 1 % en abril de 2025 ([Lasso](https://getlasso.co/amazon-affiliate-commission-rate/)).
- **Acuerdos de Jow:** menos del 10 %.

Con una cesta de 100 €, una comisión del 2-5 % deja 2-5 € por pedido. Si se añade una tasa de 0,99 € como la de Jow, son 3-6 €, es decir, unos 12-25 € al mes por cada hogar que pide todas las semanas (cálculo ilustrativo, no una previsión). Las apps que sobreviven en EE. UU. cobran suscripción, como eMeals, o venden publicidad, como Jow o Chicory.

El *retail media* (marcas que pagan para que su garbanzo sea el que entra en la cesta) es la mayor fuente potencial de ingresos, pero choca de frente con un «asistente nutricional con opinión». Si se usa, tiene que ser transparente y la nutrición tiene que mandar en el orden de los productos. La compra es, por tanto, una palanca de retención y de valor para la suscripción de ONA, no un negocio independiente.

## Ocho vías de integración, solo dos oficiales y en marcha

| Vía | ¿Viable hoy? | Riesgo legal / de condiciones de uso | Cobertura | Esfuerzo para ONA | Ingresos |
|---|---|---|---|---|---|
| 1. Lista neta y exportación (texto por pasillos, compartir) | Sí; ya existe una versión básica | Ninguno | 100 % de usuarios, también en tienda física | S–M (fase 0) | Ninguno directo; retención |
| 2. Carrito precargado en Amazon.es (formulario Add-to-Cart de Associates) | Probable: está documentado para Amazon, pero no verificado en .es con Fresh ni con Dia | Bajo (programa oficial) | Amazon Fresh en 6 ciudades y Dia en Amazon en ~15 zonas; Amazon es el n.º 1 online (36,6 %) | M–L (casar productos, requisitos de PA-API) | ~3 % en Fresh (fuente secundaria); 1 % en EE. UU. |
| 3. Afiliación de Carrefour (Awin) | Sí, el programa está activo | Bajo si los enlaces no se modifican; prohibido anunciarse en buscadores | Carrefour online, nacional (9,1 % del mercado) | S | 5 % de la cesta, cookie de 15 días, cesta media >120 € |
| 4. API no oficial de Mercadona / automatización desde el dispositivo | Técnicamente sí (CLI, MCP) | Alto: las condiciones lo prohíben, riesgo de bloqueo de la cuenta, Akamai, RGPD si se guardan credenciales | La mayor (27,4 %), con huecos (Málaga, zonas rurales); mínimo de 60 € | L, y frágil | Ninguno (no hay afiliación) |
| 5. Plataformas de reparto rápido (Glovo, Uber Eats, Just Eat) | No: sus APIs son para comercios y repartidores, no para que un tercero haga pedidos | Bajo, pero no hay producto que integrar | Urbana; surtidos de ~4.500 referencias, no sirven para la compra semanal | — | — |
| 6. Acuerdo con una cadena (modelo Jow/Mealz) | Depende de una negociación de meses | Bajo (contrato) | La de la cadena socia: Carrefour 9,1 %, Eroski 4,1 %, Dia 4,0 %, Alcampo 2,8 % | L por cadena, más el ciclo comercial | Comisión <10 %, *retail media*, tasa por pedido |
| 7. ONA como revendedor (vendedor oficial de la compra) | Sí, pero sería otra empresa | Alto: operador alimentario (RGSEAA), IVA al 4/10/21 %, responsabilidad de comerciante, condiciones de las cadenas, posible licencia de pagos | Nacional en teoría | XL | Margen, menos costes de logística |
| 8. Pagos por agente (Visa/Mastercard, AP2, UCP, ACP, Stripe SPT) | No para supermercados españoles en 2026 | Bajo cuando exista; la SCA sigue aplicándose | Ninguna hoy | Desconocido | Los de la vía comercial que haya debajo |

**Solo las vías 2 y 3 son oficiales y funcionan hoy**, y solo la 2 carga el carrito de verdad. La 1 es la base para todos.

**Los intermediarios no resuelven el problema.** Las tres plataformas de reparto que siguen vivas tienen APIs de otro tipo. La Partners API de Glovo es para que los comercios gestionen su tienda desde el TPV ([Last.app](https://help.last.app/portal/en/kb/articles/integrations-glovo)), y Uber Direct sirve para enviar mercancía propia ([FashionUnited](https://fashionunited.es/noticias/retail/uber-lanza-en-espana-su-servicio-de-delivery-para-el-e-commerce/2023111641974)). Esto solo serviría si ONA comprara y revendiera. Además, el surtido de reparto rápido de Carrefour en Just Eat es de unas 4.500 referencias ([Retail Tech Innovation Hub](https://retailtechinnovationhub.com/home/2025/1/15/carrefour-and-just-eat-look-to-reign-in-spain-as-they-bring-rapid-delivery-service-to-the-european-country)), pensado para una compra urgente, no para la semanal.

**Instacart sí ha llegado a España, pero no como algo que ONA pueda contratar.** Además de Costco, compró Instaleap en abril de 2026 ([Pulse 2.0](https://pulse2.com/instacart-acquisition-of-instaleap-expands-global-enterprise-platform-across-europe-latin-america-and-the-middle-east/amp/)), pero no ofrece ningún programa para desarrolladores en Europa. Sus términos en EE. UU. prohíben además mostrar en la misma pantalla precios de varias cadenas, una pista de las condiciones que pondría si algún día lo abre aquí.

**Faltan también datos de producto.** Pepesto vende una API europea de catálogos y precios, pero no cubre ninguna cadena española y Mercadona figura como «próximamente» ([Pepesto](https://www.pepesto.com/agentic-grocery-shopping/)). Los extractores de Mercadona en Apify cuestan 1-3 dólares por cada 1.000 productos, pero cargan con el mismo problema de condiciones de uso ([Apify](https://apify.com/abotapi/mercadona-es-scraper)). Open Food Facts tiene 96.755 productos españoles editados en 2025 y es una fuente abierta de códigos EAN y formatos ([Open Food Facts](https://es.openfoodfacts.org/fechas-ultima-edicion)).

**El único precedente español de receta→carrito es de 2016**: el programa «Click to Buy» de SoySuper con Recetasgratis.net, que llevaba recetas a carritos de Carrefour, Dia y Ulabox ([Alimarket](https://www.alimarket.es/alimentacion/noticia_amp/215685/soysuper-traduce-recetas-en-carros-de-la-compra)). Diez años después no hay sucesor.

## Fuera de España tampoco paga el agente: carrito y relevo

**Los precedentes con éxito comercial se paran todos en el carrito.**

- **Jow.** En febrero de 2024 tenía 6 millones de usuarios, una cesta media de unos 100 € y una retención del 50 %. Cobra comisiones inferiores al 10 %, publicidad y una tasa de 0,99 € por pedido ([Journal du Net](https://www.journaldunet.com/retail/1528101-hellofresh-jow-les-commis-le-panier-repas-continue-de-faire-des-adeptes/)). El usuario edita la cesta y paga en el *drive* de la cadena.
- **Mealz.** En Bélgica, el asistente que hizo para Carrefour limita las sugerencias a unas **1.000 recetas probadas por personas**, sin generación libre, y declara un 99 % de precisión al casar ingredientes con productos. Después, la cesta pasa a carrefour.be para pagar ([Open Garden](https://www.open-garden.com/p/avec-carrefour-belgique-mealz-fait-entrer-les-courses-dans-chatgpt-et-prepare-le-retail-media-conver)).
- **Kroger.** Su API pública añade productos al carrito, pero el pago, la franja y el seguimiento se quedan en su app ([Jentic](https://jentic.com/apis/kroger)).

**Quien sí intentó pagar dentro del chat dio marcha atrás.** OpenAI lanzó Instant Checkout en septiembre de 2025, con Instacart como primer socio de alimentación. En marzo de 2026 lo recortó y ahora manda a los compradores a las apps de cada comercio, porque la gente investiga en ChatGPT pero no compra allí ([Retail Insight Network](https://www.retail-insight-network.com/news/openai-shifts-chatgpt-shopping-plans-to-retailer-run-apps-report/)); la conversión del botón de compra fue, según la prensa, inferior al 1 % ([Marketing4eCommerce](https://marketing4ecommerce.net/openai-abandona-instant-checkout-claves/)). Carrefour Francia, Knuspr y Albert Heijn montan la cesta en ChatGPT y devuelven al usuario a su web para pagar ([EuroShop](https://www.euroshop-tradefair.com/en/media-news/euroshopmag/retail-technology/grocery-retail-is-embracing-conversational-commerce)). Es el consenso del sector en 2026, y lo que haría falta replicar en España.

**Los agentes generalistas siguen fallando**, lo que confirma que el paso de revisión no es opcional:

- A mediados de 2025, ChatGPT Agent metió 15 de 16 productos en una cesta de Kroger y Operator, 13; el primero estuvo unos seis minutos bloqueado en el login ([Understanding AI](https://www.understandingai.org/p/chatgpt-agent-a-big-improvement-but)).
- Operator compró una docena de huevos por **31,43 dólares** sin pedir permiso ([ADN/Washington Post](https://www.adn.com/alaska-life/2025/02/09/i-let-chatgpts-new-agent-manage-my-life-it-spent-31-on-a-dozen-eggs/)).
- Atlas infló una cesta de Mercadona para llegar al mínimo, que entonces era de 50 €.

La lección técnica es la misma en todos los casos: el LLM interpreta la petición, y el emparejamiento con productos concretos es determinista y está validado de antemano.

**El catálogo cerrado de ONA permite copiar el modelo de Mealz.** La cifra del 99 % de Mealz solo es posible porque su catálogo de recetas es cerrado y está curado. El de ONA también lo es (83 recetas del sistema en la base de datos local), así que conviene preparar, con ayuda de un LLM y revisión humana, la correspondencia entre los pocos centenares de ingredientes que usa ONA y un puñado de productos por cadena. Las recetas creadas por los usuarios quedarían para un sistema de respaldo que busca y luego pide confirmación. De Instacart conviene copiar dos cosas: mandar nombres genéricos sin marca ni peso, con la cantidad en varias unidades, y dejar los básicos de despensa sin marcar bajo el rótulo «quizá ya lo tienes» ([Instacart docs](https://docs.instacart.com/developer_platform_api/guide/concepts/recipe/)).

**Los kits de comida no son un modelo para ONA.** HelloFresh está en España desde noviembre de 2022 ([ESM](https://esmmagazine.com/technology/meal-kit-maker-hellofresh-enters-spain-226702)) y en 2025 perdió clientes activos, de 7,3 a 6,9 millones ([Nasdaq](https://www.nasdaq.com/articles/hellofresh-fy25-net-loss-narrows-revenues-orders-down-warns-fy26)). Gousto solo es rentable con 342 millones de libras de ventas ([Grocery Gazette](https://www.grocerygazette.co.uk/2026/05/13/gousto-sales-return-to-growth/)), y Carrefour vendió Quitoque ([LSA](https://www.lsa-conso.fr/carrefour-vend-sa-start-up-quitoque-a-terence-capital,445526)). Hacer los envíos uno mismo es otro negocio, con mucho capital detrás.

## La ley empuja al mismo diseño: el usuario pulsa «pagar»

Esta sección resume el análisis de los investigadores sobre normas y jurisprudencia. No es asesoramiento jurídico.

**Pagos: la autenticación reforzada se aplica entera.** No hay un régimen especial para los pagos hechos por agentes: PSD2 y la SCA se aplican completas ([Osborne Clarke](https://www.osborneclarke.com/insights/agentic-payments-new-challenge-europes-payments-ecosystem)). Las vías para evitarla no encajan con una compra de supermercado:

- **Exención por importe bajo:** solo cubre hasta 30 €, con un acumulado de 100 € o 5 operaciones ([Reglamento Delegado 2018/389](https://eur-lex.europa.eu/eli/reg_del/2018/389/oj)). No sirve para una cesta normal.
- **Análisis de riesgo:** lo decide el banco o la pasarela del comercio, no ONA.
- **Pagos iniciados por el comercio:** exigen que el cobro «no dependa de una acción específica del pagador» ([EBA Q&A 2018_4131](https://www.eba.europa.eu/single-rule-book-qa/qna/view/publicId/2018_4131)). Si ONA pregunta «¿confirmo el pedido?» por WhatsApp, el «sí» del usuario es probablemente esa acción. Es una cuestión abierta.

El nuevo Reglamento de Servicios de Pago mantiene esta lógica y aún no se aplica ([Norton Rose Fulbright](https://www.nortonrosefulbright.com/en/knowledge/publications/cedd39c6/psd3-and-psr-from-provisional-agreement-to-2026-readiness)). En la práctica, la fricción de cada pedido se puede reducir a un toque, pero no eliminar, salvo que ONA sea quien cobra, con todo lo que eso implica.

**Consumo: el pedido solo obliga con el botón correcto.** El art. 98.2 del TRLGDCU exige que el consumidor confirme expresamente que el pedido implica pagar, con un botón que diga «pedido con obligación de pago» o algo equivalente. Si no, «no quedará obligado» ([Gómez-Acebo & Pombo](https://ga-p.com/publicaciones/pulsar-el-boton-de-pedido-en-los-contratos-electronicos-no-siempre-obliga-al-comprador/)). Nadie ha resuelto si un agente puede dar esa confirmación en nombre del consumidor ([CERRE](https://cerre.eu/publications/agentic-ai-and-consumer-protection/)), y la Digital Fairness Act, que podría aclararlo, se espera para finales de 2026 ([PrivacyLaws](https://www.privacylaws.com/news/eu-proposal-on-digital-fairness-act-expected-by-the-end-of-2026/)).

Mientras tanto, que el usuario pulse el botón de la propia cadena es la lectura más segura. Si ONA es solo una herramienta, el supermercado sigue siendo el comerciante. Responde de la información precontractual, la conformidad, la información alimentaria y la factura. Los productos perecederos quedan fuera del derecho de desistimiento de 14 días ([Ministerio de Consumo](https://portal-cec.consumo.gob.es/sites/default/files/documentos/FOLLETO_DERECHO_DESISTIMIENTO_JULIO_2026.pdf)). Si el agente se equivoca (ajo por cebolla), la reclamación práctica del usuario será contra ONA. Por eso las condiciones de ONA deben repartir ese riesgo sin excluir las protecciones obligatorias.

**Credenciales y automatización: no es ilegal en sí, pero sí arriesgado.** La prohibición de PSD2 de acceder raspando pantallas solo afecta a las cuentas de pago, y una cuenta de supermercado no lo es ([Pinsent Masons](https://pinsentmasons.com/out-law/news/psd2-screen-scraping-ban-confirmed-in-finalised-standards)). Aun así, guardar contraseñas convierte a ONA en responsable del tratamiento de una credencial de mucho valor. La guía de la AEPD sobre IA agéntica de febrero de 2026 pide:

- minimizar los datos;
- trabajar con listas blancas de servicios externos;
- diseñar el sistema para que falle de forma segura;
- no confiar solo en la supervisión humana, por el «sesgo de automatización» ([Andersen](https://es.andersen.com/blog/2026/03/12/la-aepd-realiza-un-analisis-de-la-inteligencia-artificial-agentica-desde-la-perspectiva-de-proteccion-de-datos/)).

Una sentencia del Tribunal de Justicia de la UE (*Ryanair v PR Aviation*) permite a una web imponer contractualmente la prohibición de extraer sus datos ([MediaLaws](https://www.medialaws.eu/ecj-clarifies-database-directive-scope-in-screen-scraping-case/)). El caso *Ryanair v Atrápalo* del Supremo español se refería a navegar sin iniciar sesión ([ECIJA](https://www.ecija.com/actualidad-insights/ryanair-pierde-su-batalla-legal-frente-a-las-agencias-de-viajes-online/)). En una cuenta con sesión iniciada sí hay un contrato aceptado, así que cláusulas como la de Mercadona probablemente se pueden hacer valer (inferencia).

En el extremo está el art. 197 bis del Código Penal, que castiga acceder «vulnerando las medidas de seguridad» ([BOE](https://www.boe.es/buscar/act.php?id=BOE-A-1995-25444)). Nadie lo ha probado contra un agente autorizado por el usuario. En EE. UU., Amazon demandó a Perplexity por su agente de compras, y la apelación dejó abiertas las reclamaciones por incumplimiento de contrato ([Cooley](https://www.cooley.com/news/insight/2026/2026-08-06-ninth-circuit-rules-on-ai-agent-access-to-third-party-websites-under-cfaa)).

**Revender y ley de IA.** Si ONA revende, pasa a ser operador alimentario, inscrito en el RGSEAA y responsable de lo que vende ([AESAN](https://www.aesan.gob.es/operadores-economicos/comercializacion-alimentos-internet)), y factura IVA al 4, 10 y 21 % ([TaxDown](https://taxdown.es/taxductor/iva-superreducido)). Si en lugar de eso cobra a los usuarios para pagar a terceros, podría estar prestando un servicio de pago que requiere licencia (cuestión abierta). Por otro lado, desde el 2 de agosto de 2026 el art. 50 de la ley de IA obliga a que los asistentes dejen claro que el usuario habla con una IA ([Jones Walker](https://www.joneswalker.com/en/insights/blogs/ai-law-blog/yes-august-2-still-matters-the-eu-approved-a-high-risk-ai-delay-but-most-trans.html?id=102nbon)). Esto aplica al asistente de ONA en la app y en WhatsApp, aunque un agente de compra no es un uso de alto riesgo.

Antes de lanzar, conviene que un abogado revise tres puntos: las condiciones de ONA sobre errores del agente, cualquier variante que toque cuentas de supermercado y cualquier escenario en el que ONA cobre dinero para pagar a terceros.

## El código de ONA resuelve qué comprar, no cómo comprarlo

Las referencias corresponden al commit `80e6386` (7-oct-2026). El árbol de trabajo tiene cambios sin confirmar en `engine.ts`, `types.ts`, `schema.ts` y `inbound.ts`, que pueden desplazar algunas líneas. Se han vuelto a comprobar `get_shopping_list` en [`skills.ts:252`](../../apps/api/src/services/assistant/skills.ts), `MAX_TOOL_ROUNDS` en [`engine.ts:103`](../../apps/api/src/services/assistant/engine.ts) y el borrado de la lista en [`shopping.ts:279`](../../apps/api/src/routes/shopping.ts). Ya existe una migración `0032_assistant_reviews.sql` sin confirmar, así que la siguiente será la 0033. Las cifras del catálogo salen de la base de datos local, no de producción.

**Lo que ya existe cubre bien el «qué comprar».**

- **Generación de la lista** ([`shoppingList.ts:288-536`](../../apps/api/src/services/shoppingList.ts)):
  - convierte unidades y escala por hogar (adultos + 0,5 × niños);
  - aplica los ajustes que el hogar hace a las recetas y redondea por tramos;
  - incorpora básicos fijos, artículos manuales y precios manuales con total semanal ([`shoppingList.ts:691-708`](../../apps/api/src/services/shoppingList.ts)).
- **Presupuesto:** existe la clave `weekly_budget_eur` en la memoria del usuario ([`userMemory.ts`](../../packages/shared/src/types/userMemory.ts)).
- **Exportación** en texto con la Web Share API ([`page.tsx:85-100`](../../apps/web/src/app/shopping/page.tsx)).
- **Asistente:**
  - sistema de skills que se amplía añadiendo una entrada a un array ([`appSkills.ts:857-883`](../../apps/api/src/services/assistant/appSkills.ts));
  - llamadas a la propia API REST como si fuera el usuario ([`appApi.ts`](../../apps/api/src/services/assistant/appApi.ts)).
- **WhatsApp:**
  - botones de respuesta y enlaces a cualquier ruta de la app mediante `navigateTo` ([`render.ts:20-46`](../../apps/api/src/services/whatsapp/render.ts));
  - mensajes proactivos con un recordatorio de compra los sábados.

**Lo que falta es todo el «cómo comprarlo».**

- **No existe ningún concepto de cadena, producto, SKU o código de barras** (0 resultados al buscarlo en el código). Tampoco hay dirección, código postal ni cadena preferida en el modelo de usuario ([`schema.ts:20-79`](../../apps/api/src/db/schema.ts)).
- **No hay estado de pedido.** Cada `GET /shopping-list` borra la lista y la vuelve a crear con un id nuevo ([`shopping.ts:279-293`](../../apps/api/src/routes/shopping.ts)), así que un pedido tiene que guardar una foto fija de la lista.
- **El agregador nunca lee la nota del ingrediente** ([`shoppingList.ts:334-349`](../../apps/api/src/services/shoppingList.ts)).
- **El catálogo está pensado para nutrición, no para productos.** Tiene entradas como «pasta», «atún» o «pollo». En local hay 151 ingredientes, de los que solo 13 tienen densidad y 25 tienen peso por unidad, con duplicados («pimenton dulce» y «pimentón dulce») y filas basura.
- **No hay cifrado en reposo.** Los tokens de restablecimiento de contraseña se guardan en claro ([`passwordReset.ts:38-43`](../../apps/api/src/services/passwordReset.ts)).
- **No hay cola de trabajos.** Solo existe un temporizador interno de 5 minutos ([`notificationScheduler.ts:312-383`](../../apps/api/src/services/notificationScheduler.ts)).
- **No hay navegador sin interfaz en producción.**
- **WhatsApp solo envía texto y botones de respuesta** ([`client.ts:45-62`](../../apps/api/src/services/whatsapp/client.ts)). Fuera de la ventana de 24 horas depende de una plantilla que sigue pendiente de aprobación.
- **Las confirmaciones dependen del prompt.** Las acciones delicadas, como `delete_recipe`, piden confirmación solo porque lo dice el prompt ([`appSkills.ts:663-672`](../../apps/api/src/services/assistant/appSkills.ts)). Para gastar dinero, eso no basta.

### Arreglos previos (fase 0)

| # | Arreglo | Dónde | Tamaño |
|---|---|---|---|
| a | Que `get_shopping_list` lea la lista guardada mediante `GET /shopping-list`; hoy la recalcula desde el último menú y pierde el estado, los básicos y los artículos manuales | [`skills.ts:251-307`](../../apps/api/src/services/assistant/skills.ts) | S |
| b | Conservar la nota o variante («picada», «placas de lasaña») al agregar y no fusionar líneas cuando la variante difiere; ajustar la clave `(ingredientId\|unit)` con la que se conserva el estado de cada línea | [`shoppingList.ts:334-349, 507-524`](../../apps/api/src/services/shoppingList.ts); [`shopping.ts:248-268`](../../apps/api/src/routes/shopping.ts) | S–M |
| c | Probable bug: los básicos (`staple`) pierden `checked`/`inStock` al regenerar la lista | [`shopping.ts:250-275`](../../apps/api/src/routes/shopping.ts) | S |
| d | Restar de la lista las cantidades reales de `pantry_items` | [`specs/pantry.md`](../../specs/pantry.md) | M |
| e | Política de básicos «ya en casa» (sal, aceite, especias en cda/cdita/pizca) | — | S |
| f | Una lista por hogar: hoy hay una fila por usuario aunque el ámbito sea el hogar, con riesgo de pedir dos veces | [`shopping.ts:279`](../../apps/api/src/routes/shopping.ts) | S–M |
| g | Limpiar el catálogo: duplicados, pasillos vacíos, filas basura, densidades y pesos por unidad | pestaña de huecos del catálogo en `/admin` | M, continuo |

### Componentes nuevos

| # | Componente | Tamaño | Fase |
|---|---|---|---|
| 1 | Adaptadores por cadena (`services/retailers/<cadena>.ts`, como los de `services/sources/*`): buscar productos, precio, formato, disponibilidad por código postal, montar el carrito y hacer el relevo | L por cadena | 1 (Amazon), 2 (socio) |
| 2 | Caché de productos y servicio de matching: reutilizar la cascada de `recipeExtractor.matchIngredients` (tokens → Claude por lotes → respaldo) y recordar lo que elige cada hogar; tablas `retailer_products` y `household_product_prefs` | L | 1 |
| 3 | Resolución de formatos y cantidades (375 g → bandeja de 500 g; 20 ml de aceite → «ya lo tienes»); es una función pura, apta para TDD | M | 0–1 |
| 4 | Perfil de entrega y de cadena por hogar: dirección, código postal, teléfono, cadenas preferidas, marcas fijas; mismo patrón que `household_staples` | S–M | 1 |
| 5 | Vinculación de la cuenta de la cadena y cifrado en reposo (hoy no hay ninguna utilidad de cifrado) | M–L + revisión legal | 2, solo si el socio lo exige |
| 6 | Pedido con estados: `grocery_orders` (borrador → revisado → confirmado → enviado → aceptado/fallido → entregado) y `grocery_order_items` como foto fija; al entregarse, alimenta `pantry_items` | M | 1 |
| 7 | Skills `prepare_grocery_order`, `confirm_grocery_order` (con comprobación en el servidor: solo un borrador revisado, reciente y del mismo usuario), `get_order_status` y `cancel_grocery_order`; líneas de prompt, texto de acuse y `navigateTo` | S–M | 1 |
| 8 | Página de revisión `/compra/[id]`: cambiar productos, cantidades, líneas sin producto, total frente a `weekly_budget_eur`; diseñada primero para móvil y con prueba e2e de Playwright a 390×844 | M | 1 |
| 9 | Ejecución en segundo plano: tabla de trabajos en la base de datos procesada por el temporizador de 5 min (o un servicio *worker* aparte), con el resultado enviado por `sendProactive` | M (L con *worker* y navegador) | 1–2 |
| 10 | Salvaguardas: imputar el coste LLM del matching al presupuesto del asesor, tope de gasto por pedido y registro de auditoría (patrón `admin_audit_log`) | S | 1 |
| 11 | Specs y tests: `specs/grocery-orders.md` con su fila en el índice; actualizar `shopping.md`, `advisor.md` y `whatsapp.md`; vitest para el matcher, los formatos y la máquina de estados; Playwright para la revisión | Incluido en cada pieza | Todas |

Tamaños: S ≈ un día o menos, M ≈ 2-5 días, L ≈ 1-3 semanas. Son estimaciones a partir de cómo se construyeron funciones parecidas en el repo.

El camino crítico tiene dos riesgos. El primero es el acceso a las cadenas (componente 1), que no depende del código. El segundo es la calidad del matching sobre un catálogo genérico (componente 2). Todo lo interno de ONA sigue patrones que ya existen en el repo.

**El motor del asistente obliga a trabajar en segundo plano.** Usa Claude Haiku 4.5, con un máximo de 6 rondas de herramientas por turno, `max_tokens` de 1024 y un tiempo límite de 90 segundos en la llamada a la propia API ([`engine.ts:96-103`](../../apps/api/src/services/assistant/engine.ts)). Casar una cesta completa cabe mejor en un trabajo en segundo plano que avisa al terminar, como en el flujo descrito en la fase 1.

## Qué está verificado y qué es inferencia

| Afirmación | Estado | Base |
|---|---|---|
| Cláusulas de Mercadona («técnica de programación», contraseña intransferible); mínimo de 60 € + 8,20 € | Verificado | Lectura directa de las condiciones del 5-jun-2026 (observado) |
| Cobertura de Mercadona: 51/52 capitales; Málaga y Marbella fuera | Verificado en una fecha concreta | Llamadas a la API de códigos postales; lo de Málaga podría ser una pausa temporal y conviene repetirlo |
| Akamai en Mercadona, Dia y ECI; Cloudflare en Carrefour | Verificado | Cabeceras HTTP (observado) |
| Ningún supermercado español publica una API para terceros | Muy probable | Búsquedas sin resultado en todas las cadenas; una ausencia no se puede probar |
| Carrefour en Awin: 5 %, 15 días, enlaces sin modificar | Verificado con matiz | Perfil de Awin; un segundo investigador no pudo ver la página de condiciones (404) |
| El carrito precargado de Amazon funciona en amazon.es con productos de Fresh y Dia | **Sin verificar** | Documentado para Amazon en general; es la primera prueba que hay que hacer |
| Comisión de Amazon Fresh en España ~3 % | Sin verificar | Fuente secundaria; en EE. UU. es del 1 % |
| Penetración online: 3,6 % frente a 7,3 % | Conflicto resuelto en parte | Ver la subsección de penetración; falta leer la nota de NIQ |
| Dia llega al 84 % de la población | Sin verificar en la fuente original | Síntesis de búsqueda a partir de notas de Dia |
| Jow, Mealz, Instacart y Whisk no tienen integraciones en España | Muy probable | Búsquedas sin resultado; jow.es aparcado (observado) |
| El asistente de Carrefour en ChatGPT no está en España | Verificado | Prensa de septiembre de 2026 |
| Los pilotos de pago con agentes en España no incluyen supermercados | Verificado | Notas de prensa de Visa y Santander |
| Las cadenas españolas aceptarían un acuerdo tipo Jow | Inferencia sin pruebas | Solo indicios (Carrefour en Francia y Bélgica, robots.txt de Alcampo) |
| Comodón llena la cesta de Mercadona con tokens de sesión | Sin verificar | Nota interna de investigación |
| El 18 % de los españoles delegaría la compra de alimentación en una IA | Débil | Una sola encuesta citada por [DA Retail](https://distribucionactualidad.com/el-18-espanoles-delegaria-compras-alimentacion-ia/); metodología no revisada |
| Estado del código, tablas y rutas | Verificado | Lectura del repo en `80e6386`; los tamaños S/M/L son estimaciones |
| Interpretaciones jurídicas («sí» por WhatsApp como acción del pagador, art. 197 bis, contratos de las cuentas) | Inferencia, no asesoramiento | Análisis de los investigadores sobre las normas y la jurisprudencia citadas |

## Conclusión

La investigación cambia la pregunta. «¿Puede ONA hacer la compra en España?» tiene una respuesta corta: no de forma autónoma, ni aquí ni en ningún otro sitio. La pregunta útil es qué parte de la compra le corresponde a ONA. El carrito se está convirtiendo en algo que las propias cadenas montan con IA: Eroski por WhatsApp, Alcampo con su carrito predictivo, Carrefour con Mealz fuera de España. Lo que ninguna cadena tiene es la cesta *neta* de un hogar (el menú, menos la despensa, menos lo que siempre hay en casa), con las raciones y la nutrición detrás. Ese activo vale lo mismo si el usuario compra en Mercadona, en Amazon o en el mercado del barrio. En un país donde más del 92 % de la compra sigue siendo presencial, es además lo que la mayoría va a usar. Invertir primero en la calidad de esa cesta no es un plan B: es la parte del producto que ONA puede defender.

La segunda implicación tiene que ver con el orden. Jow pudo empezar por las integraciones porque Francia ya tenía *drive* y cadenas dispuestas a colaborar. En España, ONA tiene que hacerlo al revés: ganarse a un socio con usuarios y datos de conversión, porque no hay ninguna API que contratar. Y hay una ventana de tiempo: Carrefour ya tiene su agente en Francia y Bélgica, y es probable que lo traiga a España (inferencia), momento en el que elegirá proveedor y canales. Las dos acciones más baratas y que más información dan por euro se pueden hacer ya: comprobar en un día si el carrito precargado de Amazon.es acepta productos de Fresh y de Dia, y leer la nota original de NIQ para fijar el tamaño real del canal online.
