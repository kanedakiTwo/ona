/**
 * PRO-1304 · El examen fijo de Mimo. Los 75 turnos del examen del histórico
 * (del 6-oct al 23-nov, informe de la oficina del 2026-11-23), reescritos
 * como hogares inventados. Por caso: quiénes son (`hogar`), el momento
 * (`situacion`) y la conversación previa (`historial`), que son los datos
 * de prueba de Mimo; el mensaje; `debe` y `no_debe`; las `herramientas`
 * esperadas; `sin_modelo` (le toca al código) y el `criterio_principal`.
 * Copia literal del fichero de casos de ese informe: se regenera de allí y
 * aquí no se toca.
 *
 * Los pasa y los puntúa `scripts/mimoExam.ts` con el corrector de
 * `mimoExam.ts` (specs/advisor.md → «Examen fijo de Mimo»).
 */

export type ExamCriterion = 'hecho_entero' | 'respeta_la_casa' | 'platos_con_sentido' | 'corto_sin_relleno' | 'rapido' | 'verdad_comprobada'

export interface ExamCase {
  id: string
  /** Tipo de petición (alta, cambiar_plato, generar_menu…): el informe da la nota por tipo. */
  tipo: string
  dificultad: 'trivial' | 'normal' | 'dificil'
  canal: 'whatsapp' | 'app'
  /** Quiénes son y lo que tienen guardado. */
  hogar: string
  /** Día, hora, el menú y el catálogo de ese momento, lo que Mimo acaba de preguntar. */
  situacion: string
  historial: { de: 'mimo' | 'hogar'; texto: string }[]
  mensaje: string
  debe: string[]
  no_debe: string[]
  herramientas: string[]
  /** Lo correcto es que conteste el código, sin gastar un turno de modelo. */
  sin_modelo: boolean
  criterio_principal: ExamCriterion
}

export const MIMO_EXAM_CASES: ExamCase[] = [
  {
    "id": "h-001",
    "tipo": "cambiar_plato",
    "dificultad": "trivial",
    "canal": "whatsapp",
    "hogar": "Dos adultos. Cocinan 3-4 días por semana y aprovechan sobras. Les gustan las cenas ligeras.",
    "situacion": "Es lunes por la noche. El menú de la semana que viene ya está generado y lo están repasando con Mimo. En ese menú solo hay un plato de lubina: la Lubina al horno de la cena del martes. El Revuelto de calabacín está en el catálogo. No hay ninguna pregunta pendiente.",
    "historial": [],
    "mensaje": "La lubina de la cena cámbiala por un revuelto de calabacín",
    "debe": [
      "Cambia la cena del martes de la semana que viene (la lubina) por Revuelto de calabacín",
      "Localiza el plato por su nombre, sin preguntar de qué día habla",
      "Confirma en una línea con el plato nuevo y el que quita"
    ],
    "no_debe": [
      "Preguntar qué día o qué plato quiere",
      "Añadir consejos, ofertas o el menú entero"
    ],
    "herramientas": [
      "swap_meal"
    ],
    "sin_modelo": false,
    "criterio_principal": "hecho_entero"
  },
  {
    "id": "h-002",
    "tipo": "ver_menu",
    "dificultad": "trivial",
    "canal": "whatsapp",
    "hogar": "Dos adultos y un niño de 7 años. Cocinan casi a diario.",
    "situacion": "Es domingo a mediodía. La próxima semana ya tiene menú generado. No hay nada pendiente.",
    "historial": [],
    "mensaje": "Enséñame lo que toca la próxima semana",
    "debe": [
      "Enseña, día a día, lo planificado para la próxima semana (imagen o lista)",
      "Lo saca del menú guardado, sin pasar por el modelo",
      "Como mucho cierra con una línea para pedir cambios"
    ],
    "no_debe": [
      "Regenerar o cambiar el menú",
      "Enseñar la semana en curso en vez de la siguiente"
    ],
    "herramientas": [
      "get_weekly_menu"
    ],
    "sin_modelo": true,
    "criterio_principal": "rapido"
  },
  {
    "id": "h-003",
    "tipo": "registro_comida",
    "dificultad": "trivial",
    "canal": "whatsapp",
    "hogar": "Dos adultos y una hija de 16 años. Cocinan 3-4 días por semana.",
    "situacion": "Es sábado, 22:20. Hace un cuarto de hora Mimo mandó el aviso de la cena: preguntaba si habían hecho la Dorada al horno con verduras de esta noche y daba tres respuestas posibles: «Sí, ¡a repetir!», «Sí, estuvo bien» y «No». La pregunta sigue pendiente y el hogar contesta escribiendo una de las tres.",
    "historial": [],
    "mensaje": "si, a repetir",
    "debe": [
      "Apunta como cocinada la cena de hoy, que es la del aviso",
      "Guarda la valoración más alta para esa receta",
      "Confirma en una o dos líneas nombrando el plato"
    ],
    "no_debe": [
      "Preguntar de qué plato habla",
      "Pasar por el modelo para algo que el código resuelve solo"
    ],
    "herramientas": [
      "log_cooked",
      "update_recipe_notes"
    ],
    "sin_modelo": true,
    "criterio_principal": "hecho_entero"
  },
  {
    "id": "h-004",
    "tipo": "registro_comida",
    "dificultad": "trivial",
    "canal": "whatsapp",
    "hogar": "Una pareja y un hijo de 12 años. Cocinan unos días y tiran de sobras otros.",
    "situacion": "Es martes, 15:00. Anoche a las 22:00 Mimo mandó el aviso de la cena del lunes (Tortilla de calabacín): «¿La hicisteis? Responde: Sí, hecho / No». Nadie contestó hasta ahora. Hoy martes el menú tiene Pollo al curry de comida, que a esta hora no consta como cocinado.",
    "historial": [],
    "mensaje": "si, hecho",
    "debe": [
      "Apunta como cocinada la cena del lunes, que es la del aviso pendiente",
      "Confirma en una línea nombrando ese plato y ese día"
    ],
    "no_debe": [
      "Apuntar como cocinada la comida de hoy",
      "Hablar de las sobras de un plato que nadie ha confirmado"
    ],
    "herramientas": [
      "log_cooked"
    ],
    "sin_modelo": true,
    "criterio_principal": "verdad_comprobada"
  },
  {
    "id": "h-005",
    "tipo": "registro_comida",
    "dificultad": "trivial",
    "canal": "whatsapp",
    "hogar": "Dos adultos y dos adolescentes. Cocinan 3-4 días por semana.",
    "situacion": "Es viernes, 9:30. El miércoles a las 22:00 Mimo mandó el aviso de la cena de ese día (Crema de puerros) con botones para contestar, entre ellos «No la hice». No hubo respuesta. El jueves la cena era Macarrones con tomate y de esa no se mandó aviso. Ahora pulsan un botón del aviso del miércoles.",
    "historial": [],
    "mensaje": "[botón] No la hice",
    "debe": [
      "Aplica el botón a la cena del miércoles, que es la del aviso donde estaba el botón",
      "Deja esa cena como no hecha y lo confirma en una línea con plato y día"
    ],
    "no_debe": [
      "Marcar la cena del jueves u otra comida distinta de la del aviso",
      "Pasar por el modelo"
    ],
    "herramientas": [
      "mark_meal_eaten"
    ],
    "sin_modelo": true,
    "criterio_principal": "verdad_comprobada"
  },
  {
    "id": "h-006",
    "tipo": "cambiar_plato",
    "dificultad": "trivial",
    "canal": "whatsapp",
    "hogar": "Dos adultos. Regla guardada: garbanzos como mucho dos veces por semana.",
    "situacion": "Es viernes por la mañana y están repasando el menú. Mimo acaba de avisar de que el domingo y el lunes sale la misma cena (Sopa de fideos) y ha preguntado si cambia la del domingo, con los botones «Sí, cámbiala» y «No, déjala».",
    "historial": [
      {
        "de": "mimo",
        "texto": "El domingo cenáis sopa de fideos y el lunes vuelve a salir. ¿Te cambio la del domingo por otra cena sencilla?"
      }
    ],
    "mensaje": "[botón] No, déjala",
    "debe": [
      "Confirma en una línea que la cena del domingo se queda como estaba",
      "No cambia nada del menú"
    ],
    "no_debe": [
      "Cambiar algún plato",
      "Volver a preguntar o añadir ofertas"
    ],
    "herramientas": [],
    "sin_modelo": true,
    "criterio_principal": "corto_sin_relleno"
  },
  {
    "id": "h-007",
    "tipo": "cortesia",
    "dificultad": "trivial",
    "canal": "whatsapp",
    "hogar": "Una persona que vive sola y cocina 3-4 días por semana.",
    "situacion": "Es viernes a mediodía. Mimo acaba de dejarle organizado qué adelantar para la comida y la cena de hoy. No hay ninguna pregunta pendiente.",
    "historial": [],
    "mensaje": "Muchas gracias",
    "debe": [
      "Contesta con una sola línea amable",
      "No usa herramientas ni cambia nada"
    ],
    "no_debe": [
      "Añadir ofertas, encuestas o enlaces",
      "Repetir el plan o hacer otra pregunta"
    ],
    "herramientas": [],
    "sin_modelo": true,
    "criterio_principal": "corto_sin_relleno"
  },
  {
    "id": "h-008",
    "tipo": "duda_cocina",
    "dificultad": "trivial",
    "canal": "whatsapp",
    "hogar": "Dos adultos y un niño de 9 años. Llevan pocos días usando Mimo.",
    "situacion": "Es viernes a mediodía. Mimo acaba de mandar la receta de la cena de hoy (Lubina al horno con verduras) y en los ingredientes pone «30 ml de AOVE».",
    "historial": [],
    "mensaje": "¿Y AOVE qué significa?",
    "debe": [
      "Aclara en una frase que AOVE es aceite de oliva virgen extra",
      "Como mucho añade cuánto lleva esa receta"
    ],
    "no_debe": [
      "Repetir la receta",
      "Alargarse más de dos líneas"
    ],
    "herramientas": [],
    "sin_modelo": false,
    "criterio_principal": "corto_sin_relleno"
  },
  {
    "id": "h-009",
    "tipo": "alta",
    "dificultad": "trivial",
    "canal": "whatsapp",
    "hogar": "Un adulto y dos hijos de 13 y 15 años, que cuentan como adultos para las raciones. Cocinan todos los días.",
    "situacion": "Es miércoles a mediodía, recién hecha el alta. Mimo preguntó cuánto cocinan con los botones «Casi a diario», «3-4 días» y «Poco». El hogar contestó escribiendo que cocinan todos los días; el alta se cerró con eso y el primer menú ya está generado y enviado. Dos minutos después pulsan un botón de aquella pregunta, que ya estaba contestada.",
    "historial": [],
    "mensaje": "[botón] Casi a diario",
    "debe": [
      "Reconoce que ese dato ya estaba guardado y que no hay nada que cambiar",
      "Lo resuelve el código, sin gastar un turno de modelo",
      "Como mucho una línea de respuesta"
    ],
    "no_debe": [
      "Repetir el alta o regenerar el menú",
      "Añadir preguntas u ofertas"
    ],
    "herramientas": [],
    "sin_modelo": true,
    "criterio_principal": "rapido"
  },
  {
    "id": "h-010",
    "tipo": "cambiar_plato",
    "dificultad": "normal",
    "canal": "whatsapp",
    "hogar": "Dos adultos y dos niños de 6 y 9 años. Cocinan a diario. Acaban de darse de alta: todavía no hay gustos guardados.",
    "situacion": "Es miércoles, 13:40. El primer menú (de hoy a domingo) se generó hace diez minutos. Hoy hay Coliflor gratinada de comida y Sepia con guisantes de cena; ningún otro plato de la semana lleva coliflor ni sepia.",
    "historial": [],
    "mensaje": "Yo sacaría la sepia y la coliflor",
    "debe": [
      "Cambia los dos platos (la comida y la cena de hoy) por otros",
      "Guarda que en casa no gustan la sepia ni la coliflor",
      "Confirma con los platos nuevos y los que quita"
    ],
    "no_debe": [
      "Preguntar por cuáles cambiarlos antes de actuar",
      "Poner un sustituto que lleve sepia o coliflor"
    ],
    "herramientas": [
      "swap_meal",
      "update_memory"
    ],
    "sin_modelo": false,
    "criterio_principal": "hecho_entero"
  },
  {
    "id": "h-011",
    "tipo": "gustos_reglas",
    "dificultad": "normal",
    "canal": "whatsapp",
    "hogar": "Dos adultos y dos niñas de 7 y 11 años. Cocinan casi a diario. Sin gustos guardados todavía.",
    "situacion": "Es jueves por la noche, el día del alta. El menú va de hoy a domingo. De lo que queda, solo un plato lleva pimiento: el Pisto con huevo de la comida del sábado. Mimo acaba de explicar que lo que no gusta en casa se le puede decir por el chat.",
    "historial": [],
    "mensaje": "La pequeña no soporta el pimiento",
    "debe": [
      "Guarda que la niña pequeña no quiere pimiento",
      "Mira lo que queda de semana y dice qué platos lo llevan (el pisto del sábado)",
      "Ofrece cambiar ese plato o da una salida sencilla para ella"
    ],
    "no_debe": [
      "Tratarlo como una alergia y mandar al perfil de la app",
      "Decir que no hay platos afectados sin haberlo mirado"
    ],
    "herramientas": [
      "update_memory",
      "get_recipe_details"
    ],
    "sin_modelo": false,
    "criterio_principal": "respeta_la_casa"
  },
  {
    "id": "h-012",
    "tipo": "gustos_reglas",
    "dificultad": "normal",
    "canal": "whatsapp",
    "hogar": "Dos adultos y un chico de 14 años. Cocinan casi a diario. Gusto guardado hace cinco minutos: al chico no le gustan los guisantes.",
    "situacion": "Es jueves por la noche. El menú va de hoy a domingo. Mañana viernes hay Coliflor con bechamel de cena; es el único plato con coliflor de la semana.",
    "historial": [],
    "mensaje": "Apunta otra más: nada de coliflor en ningún menú",
    "debe": [
      "Guarda que no quieren coliflor",
      "Cambia la cena del viernes por un plato sin coliflor y sin guisantes",
      "Confirma con el plato nuevo y el que quita"
    ],
    "no_debe": [
      "Poner un sustituto que lleve guisantes, el gusto guardado del chico",
      "Dejar el arreglo en manos del hogar («apártale su parte»)"
    ],
    "herramientas": [
      "update_memory",
      "swap_meal",
      "get_recipe_details"
    ],
    "sin_modelo": false,
    "criterio_principal": "respeta_la_casa"
  },
  {
    "id": "h-013",
    "tipo": "gustos_reglas",
    "dificultad": "normal",
    "canal": "whatsapp",
    "hogar": "Dos adultos y dos niños de 4 y 9 años. Cocinan a diario. Sin reglas guardadas.",
    "situacion": "Es jueves por la tarde, el día del alta. El menú va de hoy a domingo y tiene dos cenas con pasta: hoy, Espaguetis con ajo y aceite; el sábado, Fideos a la cazuela. Mimo acaba de preguntar si quieren cambiar algún plato.",
    "historial": [],
    "mensaje": "Una duda: cuando haya cosas que en casa no tomamos, pasta por la noche por ejemplo, ¿vale con ponértelo aquí?",
    "debe": [
      "Contesta que sí, que basta con decirlo en el chat",
      "Guarda la regla: nada de pasta en las cenas",
      "Lista las cenas de esta semana que llevan pasta y ofrece cambiarlas"
    ],
    "no_debe": [
      "Contestar solo a la pregunta sin guardar la regla",
      "Mandar al perfil de la app como si fuera una alergia"
    ],
    "herramientas": [
      "update_memory"
    ],
    "sin_modelo": false,
    "criterio_principal": "respeta_la_casa"
  },
  {
    "id": "h-014",
    "tipo": "duda_cocina",
    "dificultad": "normal",
    "canal": "whatsapp",
    "hogar": "Dos adultos y dos adolescentes. Cocinan 3-4 días por semana.",
    "situacion": "Es domingo a mediodía. Acaban de ver el menú de la semana que viene; el viernes hay Bacalao con tomate de comida, para 4.",
    "historial": [],
    "mensaje": "¿Qué bacalao tengo que coger para lo del viernes?",
    "debe": [
      "Mira qué plato es y cuánta cantidad hace falta para sus raciones",
      "Explica las opciones de compra (ya desalado, en salazón, congelado) y cuál es la más cómoda",
      "Da los plazos contando hacia atrás desde el viernes: cuándo ponerlo a desalar o a descongelar"
    ],
    "no_debe": [
      "Contestar en general sin mirar la receta del menú",
      "Mandar la receta entera"
    ],
    "herramientas": [
      "get_todays_menu",
      "get_recipe_details"
    ],
    "sin_modelo": false,
    "criterio_principal": "verdad_comprobada"
  },
  {
    "id": "h-015",
    "tipo": "despensa_sobras",
    "dificultad": "normal",
    "canal": "whatsapp",
    "hogar": "Dos adultos y una niña de 8 años. Cocinan 3-4 días por semana.",
    "situacion": "Es martes, 12:45. Hoy el menú tenía Merluza al horno con patatas de comida (el hogar la acaba de quitar en la app y el hueco está vacío) y Crema de calabacín de cena.",
    "historial": [],
    "mensaje": "Lo de este mediodía lo he borrado: tengo hecho de ayer un guiso de garbanzos con espinacas y nos lo vamos a comer",
    "debe": [
      "Pone ese guiso ya hecho en el hueco de hoy a mediodía",
      "Lo apunta como plato ya cocinado, sin sumar nada a la lista de la compra",
      "Confirma en una o dos líneas"
    ],
    "no_debe": [
      "Añadir sus ingredientes a la compra",
      "Tocar la cena",
      "Añadir ofertas (invitar a alguien, enlaces para recomendar)"
    ],
    "herramientas": [
      "add_freezer_dish"
    ],
    "sin_modelo": false,
    "criterio_principal": "hecho_entero"
  },
  {
    "id": "h-016",
    "tipo": "avisos",
    "dificultad": "normal",
    "canal": "whatsapp",
    "hogar": "Dos adultos y dos niños de 6 y 8 años. Cocinan 3-4 días por semana. Tienen los avisos de WhatsApp encendidos y casi nunca los contestan.",
    "situacion": "Es miércoles, 22:15. Hace un cuarto de hora llegó el aviso automático de la cena: preguntaba si habían hecho el Pollo al limón de esta noche y si lo repetirían. Ese plato es la cena de hoy en su menú de la semana.",
    "historial": [],
    "mensaje": "¿pero eso dónde me lo estás proponiendo, en la web?",
    "debe": [
      "Explica que es el aviso automático de «¿hiciste la cena?» y que el plato es la cena de hoy de su menú",
      "Dice para qué sirve contestar: apuntarlo y afinar los menús",
      "Ofrece apagar ese aviso si no lo quiere"
    ],
    "no_debe": [
      "Apagar el aviso sin que lo pida",
      "Mandar la receta o el menú entero"
    ],
    "herramientas": [],
    "sin_modelo": false,
    "criterio_principal": "verdad_comprobada"
  },
  {
    "id": "h-017",
    "tipo": "cuenta_app",
    "dificultad": "normal",
    "canal": "whatsapp",
    "hogar": "Dos adultos y dos chicos de 10 y 14 años. Acaban de darse de alta.",
    "situacion": "Es jueves por la noche, diez minutos después del alta. No hay ninguna pregunta pendiente. Llega una imagen sin texto: es una captura de la app, no la foto de una receta.",
    "historial": [],
    "mensaje": "[imagen] Captura de pantalla de la app: la pantalla de la lista de la compra se ve desplazada y cortada por un lado",
    "debe": [
      "Reconoce que es una captura de la app con un fallo de pantalla, no una receta",
      "Da en pocas líneas un paso para salir del atasco (recargar, o cerrar y abrir)",
      "Pasa el fallo al equipo y lo dice"
    ],
    "no_debe": [
      "Decir que va a leer o guardar la receta de la foto",
      "Describir la pantalla apartado por apartado",
      "Aprovechar para ofrecer invitaciones u otras cosas"
    ],
    "herramientas": [
      "leave_feedback"
    ],
    "sin_modelo": false,
    "criterio_principal": "hecho_entero"
  },
  {
    "id": "h-018",
    "tipo": "cambiar_plato",
    "dificultad": "normal",
    "canal": "whatsapp",
    "hogar": "Tres adultos. Cocinan casi a diario. Recién dados de alta.",
    "situacion": "Es viernes por la tarde. El alta se acaba de cerrar y el primer menú cubre solo de hoy a domingo: el martes y el miércoles de esta semana ya han pasado. La semana que viene todavía no tiene menú.",
    "historial": [],
    "mensaje": "¿Me cambias la comida del martes y también la cena del miércoles?",
    "debe": [
      "No cambia nada",
      "Explica en una línea que esos días de esta semana ya han pasado y que la semana que viene aún no tiene menú",
      "Hace una sola pregunta: a qué semana se refiere"
    ],
    "no_debe": [
      "Generar un menú nuevo sin que lo pidan",
      "Decir que ha cambiado algo",
      "Hacer más de una pregunta"
    ],
    "herramientas": [],
    "sin_modelo": false,
    "criterio_principal": "verdad_comprobada"
  },
  {
    "id": "h-019",
    "tipo": "cambiar_plato",
    "dificultad": "dificil",
    "canal": "whatsapp",
    "hogar": "Dos adultos y dos chicas de 12 y 15 años. Cocinan 3-4 días por semana.",
    "situacion": "Es domingo, 18:00. La próxima semana está generada. Traía desayunos, pero el hogar los ha quitado en la app (puede quedar alguno suelto). Cenas: martes, Fajitas de pollo; jueves, Tortilla de patatas. El miércoles a mediodía hay Canelones de carne. No hay ningún desayuno fijo guardado.",
    "historial": [],
    "mensaje": "Mimo, te cuento varias cosas. Los desayunos los he borrado: en casa desayunamos casi siempre café con leche, pan con tomate y algo de fruta, así que cuenta con eso de aquí en adelante. Y para la semana próxima: cambia entre sí la cena del martes y la del jueves. Los canelones nos encantan y los hacemos alguna vez, pero para un miércoles dan demasiado trabajo; ponme otra cosa ese día. Con eso, déjame la semana rehecha.",
    "debe": [
      "Guarda el desayuno habitual como desayuno fijo para los próximos menús",
      "Intercambia las cenas del martes y el jueves de la próxima semana",
      "Cambia los canelones del miércoles por un plato rápido y apunta que gustan, pero para el fin de semana",
      "Confirma los cuatro encargos, uno por línea, sin tocar los platos que no se pidió cambiar"
    ],
    "no_debe": [
      "Regenerar la semana entera y perder los platos que no se pidió cambiar",
      "Dejar algún encargo sin hacer o sin confirmar"
    ],
    "herramientas": [
      "get_weekly_menu",
      "set_fixed_meal",
      "update_memory",
      "move_meal",
      "swap_meal"
    ],
    "sin_modelo": false,
    "criterio_principal": "hecho_entero"
  },
  {
    "id": "h-020",
    "tipo": "generar_menu",
    "dificultad": "dificil",
    "canal": "whatsapp",
    "hogar": "Dos adultos y un hijo de 17 años. Cocinan unos días y aprovechan sobras. Reglas guardadas: nada de pasta; patata como mucho una vez por semana; garbanzos como mucho dos veces por semana; las sobras se comen dejando un día en medio.",
    "situacion": "Es lunes por la tarde. La semana que viene todavía no tiene menú. No hay preguntas pendientes.",
    "historial": [],
    "mensaje": "La semana próxima quiero que las cenas sean más ligeras",
    "debe": [
      "Genera el menú de la semana que viene con cenas ligeras todos los días (cremas, verduras, pescado, huevo)",
      "Respeta en comidas y cenas las reglas guardadas: sin pasta, patata una vez y garbanzos dos veces como mucho",
      "Enseña el menú y resume en pocas líneas qué ha tenido en cuenta"
    ],
    "no_debe": [
      "Dejar platos que rompen una regla guardada y preguntar si los cambia",
      "Dejar cenas contundentes sin tocar",
      "Tardar varios minutos en contestar"
    ],
    "herramientas": [
      "get_weekly_menu",
      "generate_weekly_menu",
      "swap_meal"
    ],
    "sin_modelo": false,
    "criterio_principal": "respeta_la_casa"
  },
  {
    "id": "h-021",
    "tipo": "generar_menu",
    "dificultad": "dificil",
    "canal": "whatsapp",
    "hogar": "Dos adultos y una niña de 9 años. Cocinan 3-4 días por semana. Platos favoritos guardados: croquetas, guisos de cuchara y pasta.",
    "situacion": "Es lunes, 22:30. Esta semana (de hoy a domingo) todavía no tiene menú. En casa tienen dos lubinas compradas la semana pasada y sin cocinar, y los ingredientes de la Sepia con guisantes, que estuvo en el menú anterior y no se hizo. La semana pasada el menú tuvo Menestra de verduras, Tortilla de calabacín y un plato que el hogar llama «los nidos», nombre que no coincide con ninguna receta del catálogo.",
    "historial": [],
    "mensaje": "De lo que me pusiste hace unos días cociné la menestra, los nidos y la tortilla de calabacín, y los tres salieron muy ricos.\n\nPara estos días, mete algo con las lubinas que tengo compradas y no llegué a hacer, y también la sepia con guisantes, que ya tengo todo en casa.",
    "debe": [
      "Genera el menú de la semana con un plato de lubina y la Sepia con guisantes, los dos en los primeros días porque el pescado ya está comprado",
      "El resto del menú no repite ingrediente principal: ni más platos del mismo pescado, ni tres arroces, ni dos currys",
      "Guarda buena valoración de los platos que gustaron y pregunta cuál es el que no reconoce"
    ],
    "no_debe": [
      "Entregar un menú con el mismo ingrediente principal varios días",
      "Inventarse a qué receta se refiere el plato que no encuentra"
    ],
    "herramientas": [
      "generate_weekly_menu",
      "search_recipes",
      "swap_meal",
      "update_recipe_notes"
    ],
    "sin_modelo": false,
    "criterio_principal": "platos_con_sentido"
  },
  {
    "id": "h-022",
    "tipo": "cambiar_plato",
    "dificultad": "normal",
    "canal": "whatsapp",
    "hogar": "Dos adultos y un niño de 6 años. Cocinan casi a diario. Recién dados de alta. Platos favoritos: potajes, pollo asado y verduras a la plancha.",
    "situacion": "Es viernes por la tarde, justo después del alta. El hogar pidió cambiar dos platos de días que esta semana ya han pasado; Mimo contestó que no había tocado nada, que la semana que viene aún no tenía menú, y preguntó a qué semana se refería con los botones «Semana que viene» y «Esta semana». El hogar nunca ha visto el menú de la semana que viene, porque todavía no existe.",
    "historial": [
      {
        "de": "hogar",
        "texto": "¿Puedes cambiarme lo del lunes por la noche y lo del jueves a mediodía?"
      },
      {
        "de": "mimo",
        "texto": "No he tocado nada: el lunes y el jueves de esta semana ya han pasado y la semana que viene aún no tiene menú. ¿A cuál te refieres?"
      }
    ],
    "mensaje": "[botón] Semana que viene",
    "debe": [
      "Genera el menú de la semana que viene y lo enseña",
      "Deja claro que es un menú nuevo",
      "Pregunta qué quiere cambiar ahora que lo ve, o qué prefiere en esos dos huecos"
    ],
    "no_debe": [
      "Cambiar por su cuenta la cena del lunes y la comida del jueves de un menú que el hogar aún no ha visto",
      "Presentar esos cambios a ciegas como lo que se pidió"
    ],
    "herramientas": [
      "generate_weekly_menu"
    ],
    "sin_modelo": false,
    "criterio_principal": "hecho_entero"
  },
  {
    "id": "h-023",
    "tipo": "salud_nutricion",
    "dificultad": "normal",
    "canal": "whatsapp",
    "hogar": "Dos adultos y dos niñas de 2 y 6 años. Cocinan casi a diario. Recién dados de alta, sin reglas guardadas.",
    "situacion": "Es viernes por la mañana, cinco minutos después del alta. El primer menú va de hoy a domingo. Hoy a mediodía hay Carrilleras de ternera con vino tinto; el domingo hay Merluza en salsa verde, que lleva vino blanco. No hay ninguna pregunta pendiente.",
    "historial": [],
    "mensaje": "Las carrilleras llevan vino tinto y aquí come una niña de 2 años",
    "debe": [
      "Cambia las carrilleras de hoy por un plato sin alcohol para toda la casa",
      "Guarda la regla: en esta casa no se cocina con alcohol",
      "Revisa el resto de la semana y cambia o avisa de los demás platos con vino o licor (la merluza del domingo)"
    ],
    "no_debe": [
      "Quedarse en preguntar qué prefiere sin cambiar nada",
      "Asegurar que el alcohol se evapora y que el plato es apto",
      "Dejar otro plato con alcohol en la semana sin decirlo"
    ],
    "herramientas": [
      "get_recipe_details",
      "get_weekly_menu",
      "swap_meal",
      "update_memory"
    ],
    "sin_modelo": false,
    "criterio_principal": "respeta_la_casa"
  },
  {
    "id": "h-024",
    "tipo": "generar_menu",
    "dificultad": "dificil",
    "canal": "whatsapp",
    "hogar": "Tres adultos que comparten casa. Cocinan 3-4 días por semana. No hay nada guardado sobre aparatos ni costumbres.",
    "situacion": "Es domingo, casi medianoche. La semana que viene no tiene menú. Llega una nota de voz larga que anuncia una lista de lo que hay en casa, pero la lista no ha llegado: ni en ese mensaje ni en otro.",
    "historial": [],
    "mensaje": "Hola, mira, ahora te mando un listado de lo que hay en casa para cocinar, ¿vale? Las especias no te las pongo, ni las salsas tipo mayonesa o tomate frito, que de eso hay, pero no lo voy a meter. Hay cosas que vienen ya hechas, de abrir y calentar. A ver, lo que necesito es un menú para toda la semana, con comidas y con cenas, somos tres, y que pueda dejar adelantado todo lo que se pueda. Y si ves que encaja, pues metes algo de freidora de aire, de eso que se hace en nada, que la tenemos, y también hay una olla programable. Pues eso, la semana entera planificada para los tres y me dices qué cosas puedo cocinar el sábado por la mañana para tenerlas ya listas. Gracias, ¿eh?",
    "debe": [
      "Dice que la lista no ha llegado y la pide (pegada, en audio o en foto)",
      "Guarda lo que sí ha dicho: freidora de aire, olla programable y que adelantan platos el sábado por la mañana",
      "Resume en pocas líneas qué preparará cuando la tenga: comidas y cenas para tres y qué dejar hecho el sábado"
    ],
    "no_debe": [
      "Generar un menú genérico del catálogo sin la lista",
      "Inventarse lo que hay en casa",
      "Hacer varias preguntas a la vez"
    ],
    "herramientas": [
      "update_memory"
    ],
    "sin_modelo": false,
    "criterio_principal": "respeta_la_casa"
  },
  {
    "id": "h-025",
    "tipo": "receta_pasos",
    "dificultad": "normal",
    "canal": "whatsapp",
    "hogar": "Dos adultos. Cocinan 3-4 días por semana. Están en su primera semana.",
    "situacion": "Es viernes a mediodía. El menú va de hoy a domingo y quedan seis platos por cocinar. La receta de la cena de hoy ya se la mandó Mimo entera hace un rato. Las recetas completas están en la app. Un mensaje de WhatsApp muy largo llega cortado, y cada hogar tiene un tope mensual de gasto del asistente.",
    "historial": [],
    "mensaje": "¿Me pasas todas las recetas de esta semana?",
    "debe": [
      "Manda un resumen por plato de lo que queda de semana: día, plato, tiempo y lo que conviene adelantar",
      "Remite a la app para ver las recetas completas",
      "Ofrece mandar entera la receta que toque cocinar ahora"
    ],
    "no_debe": [
      "Mandar todas las recetas completas en un solo mensaje, que llega cortado",
      "Repetir la receta que ya mandó",
      "Gastar en un solo turno buena parte del tope mensual"
    ],
    "herramientas": [
      "get_weekly_menu"
    ],
    "sin_modelo": false,
    "criterio_principal": "corto_sin_relleno"
  },
  {
    "id": "h-026",
    "tipo": "ver_menu",
    "dificultad": "trivial",
    "canal": "whatsapp",
    "hogar": "Dos adultos y un niño de 6 años. Cocinan casi a diario. Sin normas guardadas que afecten al caso.",
    "situacion": "Es martes, 20:00. El menú de la semana está generado; hoy hay arroz con verduras de comida y tortilla de calabacín de cena. Mimo no ha preguntado nada y no hay avisos pendientes.",
    "historial": [],
    "mensaje": "Oye, ¿qué nos toca esta noche de cena?",
    "debe": [
      "Dice la cena de hoy (tortilla de calabacín) en una línea",
      "El plato sale del menú guardado, no se lo inventa"
    ],
    "no_debe": [
      "Recitar el menú del día entero o el de toda la semana",
      "Añadir encuestas, consejos o más de una pregunta de seguimiento"
    ],
    "herramientas": [
      "get_todays_menu"
    ],
    "sin_modelo": true,
    "criterio_principal": "rapido"
  },
  {
    "id": "h-027",
    "tipo": "ver_menu",
    "dificultad": "trivial",
    "canal": "whatsapp",
    "hogar": "Un adulto y dos adolescentes de 13 y 16 años. Cocinan casi a diario.",
    "situacion": "Es jueves, 22:20. Esta semana hay comida y cena de lunes a viernes; el sábado solo tiene cena y el domingo no tiene ningún plato. Hace un minuto el hogar apuntó como hecha la cena de hoy (crema de puerros).",
    "historial": [],
    "mensaje": "pásame el menú semanal",
    "debe": [
      "Da el menú de toda la semana, día por día, con comida y cena",
      "Dice qué huecos están sin planificar (la comida del sábado y todo el domingo)",
      "Lo que cuenta coincide con el menú guardado"
    ],
    "no_debe": [
      "Dar solo el menú de hoy",
      "Inventar platos para los huecos vacíos o generar un menú nuevo"
    ],
    "herramientas": [
      "get_weekly_menu"
    ],
    "sin_modelo": true,
    "criterio_principal": "hecho_entero"
  },
  {
    "id": "h-028",
    "tipo": "registro_comida",
    "dificultad": "trivial",
    "canal": "whatsapp",
    "hogar": "Dos adultos. Cocinan a diario. Tienen activado el aviso de la cena.",
    "situacion": "Es jueves, 22:20. La cena de hoy en el menú es crema de calabacín. Hace veinte minutos Mimo mandó el aviso de la cena preguntando si la habían hecho, con los botones «Sí, la hice» y «No». El hogar pulsa el botón.",
    "historial": [
      {
        "de": "mimo",
        "texto": "¿Qué tal la crema de calabacín de esta noche, la habéis hecho? Así queda apuntada."
      }
    ],
    "mensaje": "[botón] Sí, la hice",
    "debe": [
      "Apunta como cocinada la cena de hoy (crema de calabacín)",
      "Confirma en una línea con el día y el plato"
    ],
    "no_debe": [
      "Apuntar otra comida u otro día",
      "Añadir preguntas, ofertas o encuestas después de confirmar"
    ],
    "herramientas": [
      "log_cooked"
    ],
    "sin_modelo": true,
    "criterio_principal": "rapido"
  },
  {
    "id": "h-029",
    "tipo": "registro_comida",
    "dificultad": "trivial",
    "canal": "whatsapp",
    "hogar": "Dos adultos y dos niños de 4 y 9 años. Los viernes cenan pizza. Tienen activado el aviso de la cena.",
    "situacion": "Es sábado, 10:25 de la mañana. Anoche, a las 22:00, Mimo preguntó si habían hecho la cena del viernes (pizza de verduras), con los botones «Sí, la hice» y «No». Nadie contestó hasta ahora. Hoy sábado hay pollo asado de comida y sopa de fideos de cena, todavía sin cocinar.",
    "historial": [
      {
        "de": "mimo",
        "texto": "¿Cayó al final la pizza de verduras esta noche? Así la dejo apuntada."
      }
    ],
    "mensaje": "[botón] Sí, la hice",
    "debe": [
      "Apunta como cocinada la cena de ayer viernes (la pizza), que es por la que preguntaba el aviso",
      "Confirma nombrando el día y el plato que ha apuntado"
    ],
    "no_debe": [
      "Marcar como hecha la comida o la cena de hoy sábado",
      "Confirmar sin decir qué plato y de qué día"
    ],
    "herramientas": [
      "log_cooked"
    ],
    "sin_modelo": true,
    "criterio_principal": "hecho_entero"
  },
  {
    "id": "h-030",
    "tipo": "lista_compra",
    "dificultad": "trivial",
    "canal": "whatsapp",
    "hogar": "Dos adultos y un niño de 8 años. Tienen configuradas sus tiendas: una frutería, una carnicería y un supermercado.",
    "situacion": "Es jueves, 16:10. Esta mañana el hogar pidió hacer la compra y Mimo le mandó la lista repartida por tiendas, con un enlace de pedido para cada una. Desde entonces no ha cambiado nada en el menú ni en la lista. No hay preguntas pendientes.",
    "historial": [],
    "mensaje": "mándame otra vez la compra, anda",
    "debe": [
      "Vuelve a mandar la lista de la compra tal como está, repartida por tiendas",
      "La manda directamente, sin preguntar nada antes"
    ],
    "no_debe": [
      "Preguntar cantidades, tiendas o si quiere añadir algo antes de mandarla",
      "Regenerar el menú o cambiar la lista"
    ],
    "herramientas": [
      "get_shopping_list"
    ],
    "sin_modelo": true,
    "criterio_principal": "corto_sin_relleno"
  },
  {
    "id": "h-031",
    "tipo": "cortesia",
    "dificultad": "trivial",
    "canal": "whatsapp",
    "hogar": "Tres adultos. Cocinan casi a diario.",
    "situacion": "Es jueves, 13:45. Hace una hora el hogar preguntó por la comida de hoy y esa pregunta se quedó sin contestar. En el menú, hoy hay garbanzos con espinacas de comida y ensalada de tomate y queso fresco de cena.",
    "historial": [
      {
        "de": "hogar",
        "texto": "¿Qué hay hoy para comer?"
      }
    ],
    "mensaje": "Buenas",
    "debe": [
      "Saluda en una línea",
      "Contesta lo que quedó sin responder: dice la comida de hoy (garbanzos con espinacas), con o sin la cena"
    ],
    "no_debe": [
      "Quedarse en el saludo y preguntar en qué puede ayudar, sin dar el menú de hoy",
      "Enumerar todo lo que sabe hacer"
    ],
    "herramientas": [],
    "sin_modelo": true,
    "criterio_principal": "corto_sin_relleno"
  },
  {
    "id": "h-032",
    "tipo": "avisos",
    "dificultad": "trivial",
    "canal": "whatsapp",
    "hogar": "Dos adultos y un niño de 4 años. Cocinan 3 o 4 días a la semana. Tienen activados los avisos por WhatsApp.",
    "situacion": "Es miércoles, 12:30. El hogar recibe el aviso antes de cocinar y el recordatorio de la compra de los sábados, y lleva semanas sin contestar a ninguno. No hay preguntas pendientes.",
    "historial": [],
    "mensaje": "me quiero dar de baja",
    "debe": [
      "Explica que para dejar de recibir los avisos por WhatsApp basta con escribir BAJA (y ALTA para volver)",
      "Distingue eso de cancelar el plan o borrar la cuenta, y dice dónde se hace o a quién pedir ayuda",
      "Lo cuenta en dos o tres líneas"
    ],
    "no_debe": [
      "Desactivar los avisos o cancelar algo por su cuenta, sin que el hogar lo confirme",
      "Intentar retenerle o preguntarle por qué se va",
      "Inventar un enlace o un contacto"
    ],
    "herramientas": [],
    "sin_modelo": false,
    "criterio_principal": "corto_sin_relleno"
  },
  {
    "id": "h-033",
    "tipo": "duda_cocina",
    "dificultad": "normal",
    "canal": "whatsapp",
    "hogar": "Dos adultos y una niña de 9 años. Cocinan a diario.",
    "situacion": "Es lunes, 14:25. La cena de hoy en el menú es judías verdes rehogadas con ajo. El hogar acaba de preguntar qué cena hoy. En el catálogo hay varios platos con brócoli (por ejemplo, pollo a la plancha con brócoli).",
    "historial": [
      {
        "de": "hogar",
        "texto": "¿Qué toca esta noche?"
      },
      {
        "de": "mimo",
        "texto": "Esta noche cenáis judías verdes rehogadas con ajo, para los tres."
      }
    ],
    "mensaje": "No me acordé de comprar las judías verdes. En casa hay brócoli. ¿Cómo lo apaño?",
    "debe": [
      "Da una solución que se pueda cocinar esta noche con el brócoli (por ejemplo, rehogarlo como iban a ir las judías), con el cómo en pocas líneas",
      "Si propone otros platos del catálogo, dice qué ingredientes faltarían en cada uno",
      "Ofrece dejarlo cambiado en la cena de hoy, sin cambiar el menú por su cuenta"
    ],
    "no_debe": [
      "Dar como única salida ir a comprar las judías verdes",
      "Cambiar la cena del menú sin preguntar",
      "Proponer platos que piden varias cosas que no tiene sin avisarlo"
    ],
    "herramientas": [
      "cook_with_what_i_have"
    ],
    "sin_modelo": false,
    "criterio_principal": "platos_con_sentido"
  },
  {
    "id": "h-034",
    "tipo": "receta_pasos",
    "dificultad": "normal",
    "canal": "whatsapp",
    "hogar": "Dos adultos. Cocinan casi a diario y tienen robot de cocina.",
    "situacion": "Es martes, 20:00. La cena de hoy son puerros gratinados con bechamel. La receta guardada tiene ingredientes y cantidades para 4 raciones (puerro, leche, queso curado, mantequilla y harina) y el enlace de la página de donde salió, pero le faltan los pasos. Mimo acaba de decir la cena y ha ofrecido cambiarla o explicarla.",
    "historial": [
      {
        "de": "hogar",
        "texto": "¿Qué hay de cena hoy?"
      },
      {
        "de": "mimo",
        "texto": "Esta noche tocan puerros gratinados con bechamel. ¿Pongo otra cosa en su lugar o te digo la manera de hacerlos?"
      }
    ],
    "mensaje": "Venga, explícame cómo se hacen.",
    "debe": [
      "Dice claramente que la receta guardada trae ingredientes pero no pasos",
      "Da los pasos con su conocimiento de cocina, usando los ingredientes y las cantidades guardados",
      "Los pasos van numerados y llevan tiempos y temperaturas para poder seguirlos"
    ],
    "no_debe": [
      "Presentar los pasos como si fueran los guardados en la receta",
      "Contestar solo que no hay pasos y dejarle sin saber cómo hacerla",
      "Cambiar ingredientes o cantidades de la receta sin decirlo"
    ],
    "herramientas": [
      "get_recipe_details"
    ],
    "sin_modelo": false,
    "criterio_principal": "verdad_comprobada"
  },
  {
    "id": "h-035",
    "tipo": "duda_cocina",
    "dificultad": "normal",
    "canal": "whatsapp",
    "hogar": "Dos adultos y dos niños de 6 y 9 años. Cocinan 3 o 4 días a la semana.",
    "situacion": "Es jueves, 20:15, y el hogar está cocinando en ese momento unos macarrones con carne picada que no están en el menú. Hace dos horas Mimo le explicó la receta por pasos. Pregunta por nota de voz, con la sartén en el fuego.",
    "historial": [
      {
        "de": "mimo",
        "texto": "Para la carne: sartén muy caliente, la repartes bien y la tienes dos o tres minutos quieta, que coja color; después la rompes con la paleta y la terminas cuando ya no se vea cruda."
      }
    ],
    "mensaje": "Vale, ya tengo la picada al fuego y me surge una cosa. La he repartido por la sartén y la he dejado sin tocar unos minutos, que cogiera color, y ahora la estoy rompiendo con la paleta. Mi duda es si, mientras la rompo, tengo que ir volteando los trozos y que se hagan por la otra cara, o si me pongo a darle vueltas sin parar, o si es mejor no moverla. ¿Cómo lo hago?",
    "debe": [
      "Contesta directamente: sí hay que girar los trozos, pero sin remover todo el rato (dejarla quieta a ratos)",
      "Lo da en tres pasos cortos como mucho, para leerlo de un vistazo mientras cocina",
      "Dice en una frase el porqué: si se remueve sin parar, la carne suelta jugo y se cuece en vez de dorarse"
    ],
    "no_debe": [
      "Repetir la receta entera",
      "Usar herramientas, tocar el menú u ofrecer guardar la receta",
      "Pasar de unas seis líneas"
    ],
    "herramientas": [],
    "sin_modelo": false,
    "criterio_principal": "corto_sin_relleno"
  },
  {
    "id": "h-036",
    "tipo": "duda_cocina",
    "dificultad": "normal",
    "canal": "whatsapp",
    "hogar": "Tres adultos. Tienen robot de cocina.",
    "situacion": "Es sábado, 9:00. El hogar va a hacer una masa de crepes con una receta suya que no está guardada en Mimoia. No hay nada pendiente con el menú. Pregunta por nota de voz.",
    "historial": [],
    "mensaje": "Voy a hacer masa de crepes en el robot de cocina. La receta pone 300 gramos de harina, 80 de mantequilla, dos huevos y unas cuantas cosas más, pero resulta que de harina solo me quedan 200 y quiero hacer menos cantidad. ¿Me vale sacar la proporción? O sea, 200 entre 300, y ese número aplicárselo a todo lo demás. ¿O eso se calcula de otra forma?",
    "debe": [
      "Confirma que sí: se calcula el factor (200 ÷ 300 ≈ 0,67) y se multiplica cada ingrediente por él",
      "Da ya calculada la mantequilla (unos 53 g)",
      "Avisa de que los huevos no salen exactos (1,3) y da una salida práctica, como batirlos y pesar la parte o usar uno y compensar el líquido",
      "Todas las cuentas que da están bien"
    ],
    "no_debe": [
      "Equivocarse en el factor o en alguna cantidad",
      "Decir que no se puede reducir, o que hay que hacerlo de otra forma, sin motivo",
      "Tocar el menú o guardar una receta"
    ],
    "herramientas": [],
    "sin_modelo": false,
    "criterio_principal": "verdad_comprobada"
  },
  {
    "id": "h-037",
    "tipo": "cambiar_plato",
    "dificultad": "normal",
    "canal": "whatsapp",
    "hogar": "Dos adultos y tres niños de 5, 8 y 11 años. Cocinan 3 o 4 días a la semana. No hay ninguna norma guardada sobre comer fuera entre semana.",
    "situacion": "Es martes, 10:45. El aviso de la mañana ha dicho el menú de hoy: guiso de pollo con verduras de comida y tortilla de patatas de cena. Mañana miércoles también hay comida planificada (albóndigas en salsa). No hay preguntas pendientes.",
    "historial": [],
    "mensaje": "Al mediodía como en la oficina; a mí ponme nada más que la cena",
    "debe": [
      "Quita la comida de hoy y deja la cena como está",
      "Confirma en una línea qué ha quitado y qué queda para esta noche",
      "Pregunta si es solo hoy o todos los días de entre semana, antes de tocar otros días o la plantilla"
    ],
    "no_debe": [
      "Quitar las comidas de otros días o cambiar la plantilla sin preguntar",
      "Tocar la cena de hoy",
      "Preguntar antes de quitar la comida de hoy, que ya está clara"
    ],
    "herramientas": [
      "clear_meal"
    ],
    "sin_modelo": false,
    "criterio_principal": "hecho_entero"
  },
  {
    "id": "h-038",
    "tipo": "gustos_reglas",
    "dificultad": "normal",
    "canal": "whatsapp",
    "hogar": "Tres adultos. Cocinan casi a diario. En su perfil consta: sin marisco.",
    "situacion": "Es viernes, 11:40. El menú de la semana está recién rehecho. Quedan dos platos con curry: pollo al curry con arroz en la cena de hoy y curry de garbanzos y espinacas en la comida de mañana sábado. No hay preguntas pendientes.",
    "historial": [],
    "mensaje": "El curry no nos gusta nada",
    "debe": [
      "Guarda que no les gusta el curry, para los próximos menús",
      "Cambia los dos platos con curry que quedan esta semana (cena de hoy y comida del sábado)",
      "Los platos nuevos no llevan curry ni marisco",
      "Confirma en pocas líneas con cada plato nuevo y el que quita"
    ],
    "no_debe": [
      "Guardar el disgusto y dejar los platos de curry en el menú",
      "Tocar platos que no llevan curry",
      "Preguntar si quiere que los cambie en vez de cambiarlos"
    ],
    "herramientas": [
      "update_memory",
      "swap_meal"
    ],
    "sin_modelo": false,
    "criterio_principal": "respeta_la_casa"
  },
  {
    "id": "h-039",
    "tipo": "avisos",
    "dificultad": "normal",
    "canal": "whatsapp",
    "hogar": "Dos adultos y dos niños de 6 y 10 años. Cenan a las 20:30. Tienen activado el aviso antes de cocinar.",
    "situacion": "Es jueves, 19:40. En el menú, la cena de hoy son albóndigas en salsa. Esta tarde el hogar preguntó a Mimo cómo hacer un arroz con pollo y Mimo se lo explicó, pero nadie pidió cambiar el menú, así que el arroz con pollo no figura en ningún día. Hace cinco minutos salió el aviso automático de empezar a cocinar las albóndigas. Pregunta por nota de voz.",
    "historial": [
      {
        "de": "mimo",
        "texto": "Hora de arrancar con las albóndigas en salsa: son unos 40 minutos y así llegáis a cenar a vuestra hora."
      }
    ],
    "mensaje": "Me he quedado un poco perdido. ¿A qué viene ahora el aviso de las albóndigas? A lo mejor es lo que estaba puesto para hoy desde antes. ¿Me mandas el enlace de la app y lo miro yo?",
    "debe": [
      "Explica en una o dos líneas que el aviso salió porque la cena guardada para hoy en el menú eran las albóndigas",
      "Aclara que el arroz con pollo no está puesto en el menú",
      "Incluye en ese mismo mensaje el enlace al menú de la app"
    ],
    "no_debe": [
      "Decir que deja el enlace y no ponerlo",
      "Cambiar el menú sin que se lo pidan",
      "Alargarse en disculpas o hacer más de una pregunta"
    ],
    "herramientas": [],
    "sin_modelo": false,
    "criterio_principal": "hecho_entero"
  },
  {
    "id": "h-040",
    "tipo": "registro_comida",
    "dificultad": "normal",
    "canal": "whatsapp",
    "hogar": "Un adulto que vive solo. Cocina casi a diario. Tiene activado el aviso de la cena.",
    "situacion": "Es viernes, 22:35. Hace media hora llegó el aviso de la cena: preguntaba si había hecho la merluza en salsa verde de hoy y daba tres respuestas para elegir (dos de «sí» y una de «no»). El hogar no ha dicho en ningún momento si hoy ha cocinado. Contesta escribiendo, sin usar ninguna de las opciones.",
    "historial": [
      {
        "de": "mimo",
        "texto": "Para hoy había merluza en salsa verde: ¿la has preparado? Si es que sí, cuéntame qué te ha parecido y si te apetece verla más veces. Responde: Sí, ¡a repetir! / Sí, estuvo bien / No."
      }
    ],
    "mensaje": "Me agrada.",
    "debe": [
      "No apunta la cena como cocinada: la respuesta no dice si la hizo",
      "Pregunta en una línea si la ha cocinado hoy o si quiere decir que le gusta la propuesta",
      "Si recoge que le gusta, lo hace sin dar por hecho que la ha comido"
    ],
    "no_debe": [
      "Apuntar la cena de hoy como cocinada",
      "Ponerle estrellas a la receta como si la hubiera probado",
      "Añadir una encuesta u otra pregunta que no viene a cuento"
    ],
    "herramientas": [],
    "sin_modelo": false,
    "criterio_principal": "verdad_comprobada"
  },
  {
    "id": "h-041",
    "tipo": "cambiar_plato",
    "dificultad": "dificil",
    "canal": "whatsapp",
    "hogar": "Dos adultos y dos niños de 4 y 7 años. Cocinan a diario. No hay normas guardadas sobre los viernes.",
    "situacion": "Es miércoles, 22:30. El aviso de la cena acaba de preguntar si hicieron la cena de hoy (pollo al limón). El menú de la semana está generado y tiene platos en la comida y la cena del jueves, en las del viernes y en la comida del sábado. En el catálogo y en las recetas del hogar hay pizza y tortilla francesa; no hay tacos de pollo, sanfaina ni dorada a la brasa.",
    "historial": [
      {
        "de": "mimo",
        "texto": "¿Al final habéis cenado el pollo al limón? Dímelo y lo anoto."
      }
    ],
    "mensaje": "Al final cené una tortilla francesa. mañana de cena voy a hacer tacos de pollo. el viernes de cena pizza, que la hacemos todos los viernes, déjalo apuntado. a mediodía los viernes es raro que esté en casa, márcalo si no lo está. para comer mañana quiero sanfaina con un huevo frito, aunque me falta comprar berenjena. y el sábado a mediodía dorada a la brasa.",
    "debe": [
      "Apunta que hoy cenó tortilla francesa en lugar del pollo al limón",
      "Deja hechos los encargos que sí se pueden: pizza en la cena del viernes y guardada como norma de todos los viernes, comida del viernes marcada como fuera de casa y berenjena en la lista de la compra",
      "De los platos que no existen (tacos de pollo, sanfaina, dorada a la brasa) avisa de que no los tiene y ofrece crearlos, sin poner otro plato en su lugar",
      "Confirma encargo por encargo, sin dejarse ninguno de los siete"
    ],
    "no_debe": [
      "Poner «lo más parecido» en el hueco de un plato que no existe",
      "Dar por hecho un encargo que no ha ejecutado con una herramienta",
      "Dejarse algún encargo sin mencionar"
    ],
    "herramientas": [
      "log_cooked",
      "swap_meal",
      "set_meal_note",
      "add_shopping_items",
      "update_memory"
    ],
    "sin_modelo": false,
    "criterio_principal": "hecho_entero"
  },
  {
    "id": "h-042",
    "tipo": "cambiar_plato",
    "dificultad": "dificil",
    "canal": "whatsapp",
    "hogar": "Dos adultos y un niño de 10 años. Norma guardada: los viernes se cena hamburguesa.",
    "situacion": "Es sábado, 10:30. Mimo acaba de generar y enseñar el menú de la semana que viene: el martes hay hamburguesa casera de comida; el miércoles, bocadillo de lomo de cena; el viernes, albóndigas de comida y hamburguesa de cena; sábado y domingo tienen comida y cena. Ayer viernes ya cenaron hamburguesa. Contesta por nota de voz.",
    "historial": [],
    "mensaje": "A ver, el martes no puede haber hamburguesa, que ya la cenamos ayer y la hamburguesa es cosa de los viernes, no vale repetirla entre semana. Y el bocadillo de lomo lo mismo, fuera de todos los días menos el domingo. Tiene que caer en domingo... bueno, no todos los domingos, pero si sale, que sea en domingo y no en otro lado. El viernes al mediodía nunca estoy, así que eso bórralo. Y el finde que viene estamos fuera, o sea que sábado y domingo no se cocina nada.",
    "debe": [
      "Quita la hamburguesa del martes y pone otro plato en su lugar",
      "Quita el bocadillo de lomo del miércoles y guarda que solo puede salir en domingo",
      "Vacía la comida del viernes y deja el sábado y el domingo sin cocinar",
      "El resumen final del menú coincide con lo que dice haber hecho: no sale ningún plato que acaba de quitar"
    ],
    "no_debe": [
      "Decir que ha vetado un plato y dejarlo puesto en el menú",
      "Enseñar un menú final que contradice los cambios que anuncia",
      "Quitar la hamburguesa de la cena del viernes"
    ],
    "herramientas": [
      "swap_meal",
      "set_day_skipped",
      "update_memory"
    ],
    "sin_modelo": false,
    "criterio_principal": "verdad_comprobada"
  },
  {
    "id": "h-043",
    "tipo": "generar_menu",
    "dificultad": "normal",
    "canal": "whatsapp",
    "hogar": "Dos adultos y dos niños de 3 y 6 años. Cocinan a diario. Normas guardadas: los sábados se cena tortilla de patatas y no sale ningún otro día; las croquetas solo pueden salir en domingo; los miércoles no cenan en casa.",
    "situacion": "Es lunes, 14:15. La semana actual tiene menú. La semana que viene está vacía. No hay preguntas pendientes.",
    "historial": [],
    "mensaje": "Prepárame el menú para la próxima semana",
    "debe": [
      "Genera el menú de la semana que viene",
      "El menú que entrega cumple las tres normas guardadas: tortilla solo en la cena del sábado, croquetas solo en domingo (o ningún día) y miércoles sin cena",
      "Si el generador coloca algo fuera de norma, lo recoloca antes de contestar",
      "Confirma en pocas líneas"
    ],
    "no_debe": [
      "Entregar el menú con una norma incumplida y ofrecer arreglarlo después",
      "Rellenar con disculpas por gustos que no ha podido meter o con peticiones de que mande recetas"
    ],
    "herramientas": [
      "generate_weekly_menu"
    ],
    "sin_modelo": false,
    "criterio_principal": "respeta_la_casa"
  },
  {
    "id": "h-044",
    "tipo": "gustos_reglas",
    "dificultad": "dificil",
    "canal": "whatsapp",
    "hogar": "Tres adultos. Cocinan todos los días. Alta hecha hoy; todavía no hay nada en su perfil.",
    "situacion": "Es jueves, 18:40. El primer menú se generó hace unos minutos y va de hoy a domingo: cena de hoy, crema de calabacín; viernes, arroz tres delicias y tortilla de patatas; sábado, lomo de cerdo con pimientos y revuelto de setas; domingo, paella de marisco y pollo con anacardos. El hogar ha preguntado si Mimo puede quedarse con lo que no pueden comer y Mimo ha contestado que por WhatsApp no guarda datos de salud.",
    "historial": [
      {
        "de": "hogar",
        "texto": "¿Te puedes quedar con las cosas que no podemos comer?"
      },
      {
        "de": "mimo",
        "texto": "Las alergias y las intolerancias no las puedo guardar desde WhatsApp: eso va en tu perfil, en la web, y a partir de ahí los menús lo respetan. Mientras, dime qué no coméis y repaso los platos que quedan de la semana."
      }
    ],
    "mensaje": "Nada de huevo, ni marisco, ni frutos secos, ni cerdo, ni setas, ni arroz, ni calabacín.",
    "debe": [
      "Cambia todos los platos que quedan de la semana que llevan algo de la lista (aquí, los siete)",
      "Ningún plato nuevo lleva huevo, marisco, frutos secos, cerdo, setas, arroz ni calabacín",
      "Avisa de lo que puede ir escondido en los platos nuevos (por ejemplo, pasta al huevo, mayonesa o caldo con cerdo)",
      "Dice que el cambio vale para esta semana y que, para los próximos menús, hay que añadirlo en el perfil de la web"
    ],
    "no_debe": [
      "Guardar por WhatsApp las alergias o intolerancias",
      "Dejar algún plato con un ingrediente de la lista",
      "Mandarle al perfil sin arreglar la semana"
    ],
    "herramientas": [
      "swap_meal"
    ],
    "sin_modelo": false,
    "criterio_principal": "respeta_la_casa"
  },
  {
    "id": "h-045",
    "tipo": "generar_menu",
    "dificultad": "dificil",
    "canal": "whatsapp",
    "hogar": "Dos adultos y una adolescente de 14 años. Excluidos que constan en su perfil: huevo, marisco, cerdo y setas.",
    "situacion": "Es viernes, 14:00. El hogar ha estado diez días sin cocinar por obras en la cocina y esta mañana pidió menús nuevos desde hoy. El menú de hoy a domingo es antiguo, de antes de las obras; de lunes a jueves ya ha pasado. La semana que viene ya está generada. Mimo preguntó si rehacía el menú desde hoy, con los botones «Rehazlo desde hoy» y «Es otra cosa».",
    "historial": [
      {
        "de": "mimo",
        "texto": "Los platos de hoy a domingo son de antes de las obras. ¿Hago un menú nuevo empezando hoy, o querías decir algo distinto?"
      }
    ],
    "mensaje": "[botón] Rehazlo desde hoy",
    "debe": [
      "Rehace las comidas y cenas de hoy viernes a domingo y no toca los días ya pasados",
      "Ningún plato nuevo lleva huevo, marisco, cerdo ni setas",
      "Mira qué lleva cada plato nuevo antes de darlo por bueno, en vez de cambiar a ciegas",
      "Confirma con la lista de platos por día"
    ],
    "no_debe": [
      "Poner un plato con un ingrediente excluido (por ejemplo, una tortilla o unas costillas de cerdo)",
      "Cambiar platos al azar, sin comprobar sus ingredientes",
      "Tocar la semana que viene, que nadie ha pedido rehacer"
    ],
    "herramientas": [
      "swap_meal"
    ],
    "sin_modelo": false,
    "criterio_principal": "respeta_la_casa"
  },
  {
    "id": "h-046",
    "tipo": "generar_menu",
    "dificultad": "normal",
    "canal": "whatsapp",
    "hogar": "Dos adultos. Cocinan todos los días. Nota guardada: no les gusta la coliflor.",
    "situacion": "Es viernes, 11:05. El hogar lleva dos semanas sin cocinar en casa por una mudanza. El menú de esta semana se generó antes y sigue sin tocar: hoy figura crema de calabaza de comida y arroz con verduras de cena, y hay platos hasta el domingo. La semana que viene está vacía. No hay preguntas pendientes.",
    "historial": [],
    "mensaje": "Hola, buenas. Ya estamos instalados en casa otra vez, así que hazme de nuevo los menús a partir de hoy mismo",
    "debe": [
      "Rehace el menú desde hoy viernes hasta el domingo, no solo la semana que viene",
      "Contesta con el menú nuevo en menos de un minuto",
      "Lo que dice del menú de hoy coincide con lo que queda guardado",
      "Los platos nuevos respetan lo guardado (sin coliflor)"
    ],
    "no_debe": [
      "Generar solo la semana que viene y dejar los días de hoy a domingo como estaban",
      "Tardar varios minutos en contestar",
      "Nombrar para hoy un plato que no está en el menú"
    ],
    "herramientas": [
      "generate_weekly_menu"
    ],
    "sin_modelo": false,
    "criterio_principal": "rapido"
  },
  {
    "id": "h-047",
    "tipo": "alta",
    "dificultad": "dificil",
    "canal": "whatsapp",
    "hogar": "Hogar nuevo, recién vinculado por WhatsApp. Aún no hay nada guardado.",
    "situacion": "Es jueves, 16:30. Mimo acaba de dar la bienvenida y ha hecho las dos preguntas del alta: cuántos son en casa (adultos y niños de 2 a 10 años) y cuánto cocinan (casi a diario, 3 o 4 días o poco). El hogar contesta con un solo mensaje, sin decir cuántos son niños ni cuánto cocinan. De esta semana quedan las cenas de jueves a domingo.",
    "historial": [],
    "mensaje": "Somos 5 en casa. Solo me hacen falta las cenas, cosas fáciles con verdura y un poco de proteína (sobre todo cremas o salteados), y que tres noches haya legumbre. Los sábados, tacos o perritos: el domingo después de tacos cenamos sopa, y el domingo después de perritos, croquetas. Los lunes, tortilla sí o sí, y de pescado, más que nada merluza.",
    "debe": [
      "Guarda todas las normas: solo cenas; fáciles, con verdura y proteína (cremas o salteados); tres noches de legumbre; sábado de tacos o perritos con su domingo correspondiente (sopa o croquetas); tortilla los lunes; merluza como pescado principal",
      "Deja la plantilla sin comidas y genera el primer menú solo con cenas",
      "Las cenas que quedan de esta semana cumplen las normas que les tocan (sábado y domingo emparejados)",
      "Dice lo que ha dado por supuesto, por ejemplo que los cinco cuentan como adultos o que cocinan a diario"
    ],
    "no_debe": [
      "Guardar solo parte de las normas o perder la que liga el domingo con lo que se cenó el sábado",
      "Planificar comidas de mediodía",
      "Decir que ha guardado una norma sin haberla guardado"
    ],
    "herramientas": [
      "update_memory",
      "update_weekly_template",
      "complete_onboarding"
    ],
    "sin_modelo": false,
    "criterio_principal": "respeta_la_casa"
  },
  {
    "id": "h-048",
    "tipo": "receta_pasos",
    "dificultad": "normal",
    "canal": "whatsapp",
    "hogar": "Dos adultos y dos niños de 5 y 8 años. Entre sus recetas hay una genérica de pescado a la brasa, con el tiempo según el peso.",
    "situacion": "Es domingo, 20:40. No hay preguntas pendientes. La cena de hoy en el menú es otra cosa (ensalada de pasta); el hogar pregunta, por nota de voz, por un pescado que no está en el menú.",
    "historial": [],
    "mensaje": "¿Cómo preparo a la brasa una lubina grande, de kilo y medio más o menos?",
    "debe": [
      "Contesta la duda: cómo hacer la lubina a la brasa, con pasos concretos",
      "Da tiempos orientativos para una pieza de kilo y medio y cómo saber que está hecha",
      "Si se apoya en la receta de pescado a la brasa del hogar, lo dice"
    ],
    "no_debe": [
      "Rechazarla diciendo que solo ayuda con el menú, las recetas y la compra",
      "Pedirle que repita algo que ya ha dicho (qué pescado, cuánto pesa)",
      "Crear o guardar una receta nueva sin que lo pida"
    ],
    "herramientas": [],
    "sin_modelo": false,
    "criterio_principal": "hecho_entero"
  },
  {
    "id": "h-049",
    "tipo": "receta_pasos",
    "dificultad": "trivial",
    "canal": "whatsapp",
    "hogar": "Dos adultos. Entre sus recetas hay unas costillas al horno importadas de un vídeo, con el enlace de origen guardado.",
    "situacion": "Es jueves, 20:05. El hogar está cocinando esas costillas con el modo cocina, que Mimo le ha abierto hace unos minutos. No hay preguntas pendientes.",
    "historial": [
      {
        "de": "hogar",
        "texto": "Ábreme el paso a paso de las costillas"
      },
      {
        "de": "mimo",
        "texto": "Listo, ya tienes las costillas al horno en el modo cocina."
      }
    ],
    "mensaje": "¿Y el enlace del vídeo lo tienes?",
    "debe": [
      "Da el enlace de origen que está guardado en la receta (el vídeo)",
      "Contesta en una o dos líneas"
    ],
    "no_debe": [
      "Rechazar la pregunta como si no fuera de comida",
      "Inventar un enlace que no esté guardado en la receta",
      "Volver a mandar la receta entera"
    ],
    "herramientas": [
      "get_recipe_details"
    ],
    "sin_modelo": false,
    "criterio_principal": "hecho_entero"
  },
  {
    "id": "h-050",
    "tipo": "generar_menu",
    "dificultad": "normal",
    "canal": "app",
    "hogar": "Dos adultos y un niño de 3 años. Notas guardadas hoy mismo: poco frito y el pescado mejor a mediodía.",
    "situacion": "Es lunes, 9:36, en la pantalla del menú de la app. Esta semana no tenía nada planificado. Hace dos minutos el hogar aceptó que Mimo generase el menú de la semana; esa generación sigue en marcha y Mimo todavía no ha contestado. El hogar, que no ve respuesta, vuelve a pedirlo.",
    "historial": [
      {
        "de": "mimo",
        "texto": "¿Te hago ya el menú semanal con esos dos cambios?"
      },
      {
        "de": "hogar",
        "texto": "Venga, hazlo"
      }
    ],
    "mensaje": "Haz el menú",
    "debe": [
      "Reconoce que es la misma petición de hace dos minutos y no lanza otra generación",
      "Dice que el menú ya está en marcha, o enseña el que acaba de salir",
      "Al terminar queda un solo menú, el de la primera petición"
    ],
    "no_debe": [
      "Generar un segundo menú que pise al primero",
      "Enseñar un menú distinto del que salió de la primera petición",
      "Repetir el texto de bienvenida de las primeras semanas"
    ],
    "herramientas": [],
    "sin_modelo": false,
    "criterio_principal": "hecho_entero"
  },
  {
    "id": "h-051",
    "tipo": "ver_menu",
    "dificultad": "trivial",
    "canal": "whatsapp",
    "hogar": "Dos adultos y un niño de 7 años. Cocinan casi a diario.",
    "situacion": "Lunes, 15:20. El menú de hoy tiene pescado a la plancha de comida y curry de setas con arroz de cena. Mimo no ha preguntado nada.",
    "historial": [],
    "mensaje": "¿Qué toca cenar esta noche?",
    "debe": [
      "Lee el menú de hoy antes de contestar",
      "Dice la cena de hoy en una frase, con el nombre del plato"
    ],
    "no_debe": [
      "Contar también la comida o el resto de la semana",
      "Añadir ofertas, encuestas o enlaces de platos que no se han pedido"
    ],
    "herramientas": [
      "get_todays_menu"
    ],
    "sin_modelo": true,
    "criterio_principal": "corto_sin_relleno"
  },
  {
    "id": "h-052",
    "tipo": "ver_menu",
    "dificultad": "trivial",
    "canal": "whatsapp",
    "hogar": "Dos adultos y dos niños de 6 y 9 años. Cocinan en cantidad unos días y aprovechan para otros.",
    "situacion": "Viernes por la mañana. Están retocando el menú de la semana que viene: Mimo acaba de cambiar dos comidas (la del viernes y la del sábado) y lo ha confirmado en texto. Un rato antes ya les había mandado ese menú en imagen.",
    "historial": [],
    "mensaje": "Mándamelo otra vez en una imagen, igual que hace un rato, ya con lo que hemos cambiado.",
    "debe": [
      "Manda la imagen del menú de la semana que viene, con los dos cambios ya puestos",
      "Acompaña la imagen con una línea como mucho"
    ],
    "no_debe": [
      "Escribir el menú entero en texto en lugar de mandar la imagen",
      "Mandar el menú de la semana en curso",
      "Preguntar de qué semana se trata"
    ],
    "herramientas": [
      "get_weekly_menu"
    ],
    "sin_modelo": true,
    "criterio_principal": "hecho_entero"
  },
  {
    "id": "h-053",
    "tipo": "cortesia",
    "dificultad": "trivial",
    "canal": "whatsapp",
    "hogar": "Cuatro adultos. Cocinan platos grandes que dan para varios días.",
    "situacion": "Lunes por la mañana, el día del alta. Mimo acaba de confirmar que seguirá preparando el menú cada jueves y que el hogar lo retocará a su gusto. No hay ninguna pregunta ni botón pendiente.",
    "historial": [
      {
        "de": "mimo",
        "texto": "Entendido, sigo igual: el jueves preparo yo el menú de la otra semana y luego lo retocas a tu gusto."
      }
    ],
    "mensaje": "Vale.",
    "debe": [
      "No contesta nada o contesta con una sola línea",
      "No usa herramientas ni cambia nada"
    ],
    "no_debe": [
      "Hacer una pregunta nueva u ofrecer algo",
      "Repetir lo que ya había confirmado"
    ],
    "herramientas": [],
    "sin_modelo": true,
    "criterio_principal": "corto_sin_relleno"
  },
  {
    "id": "h-054",
    "tipo": "receta_pasos",
    "dificultad": "trivial",
    "canal": "app",
    "hogar": "Dos adultos y dos niños de 4 y 9 años. Cocinan a diario.",
    "situacion": "Lunes a mediodía, en la app, en el modo cocina de la receta de hoy (alubias guisadas con verduras, cinco pasos), hablando por voz. Mimo acaba de leer el paso 1 y ha pedido que digan «siguiente» al terminar. El paso 2 es pochar 150 g de cebolla y dos dientes de ajo en aceite.",
    "historial": [
      {
        "de": "mimo",
        "texto": "Paso uno: enjuaga las alubias cocidas bajo el grifo y déjalas escurrir. Avísame con «siguiente» cuando acabes."
      }
    ],
    "mensaje": "Venga, siguiente.",
    "debe": [
      "Avanza un paso y lee el paso 2, con sus cantidades",
      "Lo dice en una o dos frases, pensadas para escucharse"
    ],
    "no_debe": [
      "Preguntar en qué paso está",
      "Leer la receta entera o saltarse un paso"
    ],
    "herramientas": [
      "cooking_step"
    ],
    "sin_modelo": true,
    "criterio_principal": "rapido"
  },
  {
    "id": "h-055",
    "tipo": "receta_pasos",
    "dificultad": "normal",
    "canal": "whatsapp",
    "hogar": "Dos adultos y dos adolescentes. Cocinan platos que dan para más de un día. No les gustan los pimientos.",
    "situacion": "Lunes por la mañana, minutos después del alta. Han ido quitando platos del primer menú (unas patatas guisadas y dos más). El curry de lentejas rojas y calabaza no se ha tocado: sigue en la comida del jueves. La comida de mañana martes es un guiso de codornices. Mimo no tiene ninguna pregunta pendiente.",
    "historial": [],
    "mensaje": "Antes me pareció ver un curry de lentejas rojas con calabaza y ahora no lo encuentro. ¿Me pasas cómo se hace? Seguramente lo prepare mañana.",
    "debe": [
      "Localiza el plato en el menú y aclara que sigue ahí, en la comida del jueves",
      "Da la receta con ingredientes y pasos para cuatro raciones",
      "Ofrece pasarlo a la comida de mañana"
    ],
    "no_debe": [
      "Decir que el plato ya no está, o crearlo de nuevo",
      "Moverlo de día sin que lo confirmen"
    ],
    "herramientas": [
      "get_todays_menu",
      "get_recipe_details"
    ],
    "sin_modelo": false,
    "criterio_principal": "hecho_entero"
  },
  {
    "id": "h-056",
    "tipo": "cambiar_plato",
    "dificultad": "normal",
    "canal": "whatsapp",
    "hogar": "Dos adultos y una hija de 16 años. Hay días sueltos en que no comen en casa.",
    "situacion": "Martes, 20:00. Acaban de cambiar la cena de hoy por una ensalada templada y Mimo ha preguntado, con botones Sí | No, si coloca otro día el pollo especiado que se queda sin hacer. Mañana miércoles el menú tiene crema de calabaza de comida y, de cena, un asado de cerdo en adobo que necesita unas doce horas de adobo y media hora de trabajo.",
    "historial": [
      {
        "de": "mimo",
        "texto": "Hecho: esta noche, ensalada templada de bonito. ¿Coloco el pollo especiado más adelante? [botones: Sí | No]"
      }
    ],
    "mensaje": "No hace falta. Mañana a mediodía estamos fuera. ¿Y de cena qué tocaba?",
    "debe": [
      "Toma el «no» como respuesta al botón y no recoloca el pollo",
      "Quita la comida del miércoles",
      "Dice cuál es la cena del miércoles",
      "Avisa de que el adobo hay que dejarlo hecho esta noche"
    ],
    "no_debe": [
      "Quitar también la cena del miércoles",
      "Volver a preguntar por el pollo",
      "Soltar la receta entera sin que la pidan"
    ],
    "herramientas": [
      "clear_meal",
      "get_todays_menu"
    ],
    "sin_modelo": false,
    "criterio_principal": "hecho_entero"
  },
  {
    "id": "h-057",
    "tipo": "cambiar_plato",
    "dificultad": "normal",
    "canal": "whatsapp",
    "hogar": "Dos adultos y un niño de 6 años. Cocinan a diario. Restricción guardada en el perfil: sin frutos secos.",
    "situacion": "Jueves por la tarde, el día del alta. Pidieron cambiar el curry de coliflor de la comida de mañana por otra receta de coliflor. Mimo puso «Coliflor al ajoarriero» y comentó que en el catálogo hay también «Coliflor gratinada» y «Coliflor asada con salsa romesco». La salsa romesco lleva almendra y avellana.",
    "historial": [
      {
        "de": "mimo",
        "texto": "Hecho: mañana a mediodía, coliflor al ajoarriero en vez del curry. Si os apetece más la coliflor gratinada o la asada con salsa romesco, lo cambio."
      }
    ],
    "mensaje": "Mejor la coliflor asada con romesco",
    "debe": [
      "No cambia el plato todavía y dice cuál sigue puesto",
      "Explica el choque: la salsa romesco lleva frutos secos y en casa no se comen",
      "Pide confirmación antes de ponerlo, o propone hacerlo con una salsa sin frutos secos"
    ],
    "no_debe": [
      "Poner el plato sin avisar del choque",
      "Decir que lo ha cambiado cuando no lo ha hecho",
      "Negarse sin dar ninguna salida"
    ],
    "herramientas": [
      "get_recipe_details",
      "swap_meal"
    ],
    "sin_modelo": false,
    "criterio_principal": "respeta_la_casa"
  },
  {
    "id": "h-058",
    "tipo": "gustos_reglas",
    "dificultad": "normal",
    "canal": "whatsapp",
    "hogar": "Dos adultos que comparten piso. Cocinan casi a diario y cenan pronto.",
    "situacion": "Viernes, 7:50. En el menú de esta semana, la cena de hoy son espaguetis con verduras y la comida del domingo, macarrones gratinados. No hay más pasta de aquí al domingo. Mimo no ha preguntado nada.",
    "historial": [],
    "mensaje": "Quiero añadir otra norma a nuestros menús: la pasta, dos veces por semana como máximo, jamás de cena y sin repetirla en días consecutivos. ¿Lo dejas apuntado, porfa?",
    "debe": [
      "Guarda la regla completa: dos veces por semana como máximo, nunca en la cena, nunca en días seguidos",
      "Cambia la cena de hoy, que la incumple, por un plato sin pasta, y dice cuál pone y cuál quita",
      "Comprueba el resto de la semana y dice que ya cumple"
    ],
    "no_debe": [
      "Apuntar la regla y dejar la pasta en la cena de hoy",
      "Cambiar los macarrones del domingo, que cumplen la regla"
    ],
    "herramientas": [
      "update_memory",
      "swap_meal"
    ],
    "sin_modelo": false,
    "criterio_principal": "respeta_la_casa"
  },
  {
    "id": "h-059",
    "tipo": "cambiar_plato",
    "dificultad": "dificil",
    "canal": "whatsapp",
    "hogar": "Dos adultos y dos niñas de 7 y 9 años que comen en el comedor del colegio de lunes a viernes. Cocinan casi a diario.",
    "situacion": "Lunes a mediodía, minutos después del alta: el primer menú acaba de generarse, con comida y cena cada día. El mensaje llega con una foto del menú del comedor: lunes, lentejas y tortilla francesa; martes, arroz con tomate y merluza al horno; miércoles, crema de verduras y pollo asado; jueves, macarrones y filete de lomo; viernes, garbanzos guisados y pescado rebozado.",
    "historial": [],
    "mensaje": "[foto del menú del comedor escolar] Esta semana el menú ya lo tengo hecho. Te paso el del comedor del cole: ¿me ajustas las cenas para que encajen?",
    "debe": [
      "Lee la foto y cambia solo las cenas de los cinco días de colegio",
      "Ninguna cena repite el plato principal que ese día hay en el comedor, y lo compensa (si hubo legumbre, cena de verdura con pescado o huevo, por ejemplo)",
      "Resume los cambios día a día y dice que las comidas no las ha tocado"
    ],
    "no_debe": [
      "Rehacer la semana entera o tocar las comidas",
      "Pedir que le escriban a mano el menú del comedor",
      "Poner de cena lo mismo que ese día han comido en el colegio"
    ],
    "herramientas": [
      "swap_meal"
    ],
    "sin_modelo": false,
    "criterio_principal": "platos_con_sentido"
  },
  {
    "id": "h-060",
    "tipo": "generar_menu",
    "dificultad": "dificil",
    "canal": "whatsapp",
    "hogar": "Dos adultos y dos niños de 6 y 9 años. Cocinan en cantidad para varios días. Guardado: cenas ligeras con primero y segundo; no comen casquería.",
    "situacion": "Viernes, 9:30. El hogar acaba de dictar por voz lo que tiene en la despensa para que Mimo haga con eso el menú de la semana que viene. Mimo ha contestado que se pone con ello y lo está generando. Mimo no ha hecho ninguna pregunta ni hay botones a la vista. El mensaje llega a los pocos segundos.",
    "historial": [
      {
        "de": "hogar",
        "texto": "(nota de voz) De despensa hay legumbres de bote, conservas de pescado, pasta, arroz, patatas y tomate triturado. Con eso móntame los platos de la próxima semana."
      },
      {
        "de": "mimo",
        "texto": "Me pongo con el menú, tardo un momento…"
      }
    ],
    "mensaje": "No",
    "debe": [
      "Trata el «No» como ambiguo: no hay ninguna pregunta que el hogar haya visto",
      "Se detiene y espera, o pregunta en una línea a qué se refiere",
      "Si el menú ya está generado, lo dice sin dar por cerrada ninguna decisión"
    ],
    "no_debe": [
      "Tomarlo como respuesta a una pregunta que el hogar todavía no ha recibido",
      "Dar por tomada una decisión sobre el menú (por ejemplo, «dejo las cenas como están»)",
      "Aprovechar para hacer una pregunta de perfil"
    ],
    "herramientas": [],
    "sin_modelo": false,
    "criterio_principal": "corto_sin_relleno"
  },
  {
    "id": "h-061",
    "tipo": "despensa_sobras",
    "dificultad": "dificil",
    "canal": "whatsapp",
    "hogar": "Dos adultos y dos niños de 6 y 9 años. Cocinan en cantidad para varios días y no tiran nada. Guardado: cenas ligeras con primero y segundo, sin pasta ni legumbre por la noche; no comen casquería; pescado dos veces por semana.",
    "situacion": "Viernes, 9:30. Hace unos minutos dictaron lo que hay en la despensa y Mimo generó el menú de la semana que viene: las cenas salieron con un solo plato y casi sin usar lo que tienen. El hogar avisó de que ahora mandaba lo de la nevera y el congelador, y Mimo dijo que esperaba. Llega una nota de voz.",
    "historial": [
      {
        "de": "hogar",
        "texto": "Aguanta, que ahora te digo lo de la nevera y lo congelado."
      },
      {
        "de": "mimo",
        "texto": "Te espero. Cuando me llegue, ajusto los platos de la próxima semana para gastar lo que ya tenéis."
      }
    ],
    "mensaje": "En la nevera hay queso para gratinar, jamón york, pechuga de pavo en lonchas, un trozo de queso curado, yogures naturales, dos berenjenas, pimientos, una lechuga, peras, tomates, una coliflor, zanahorias, acelgas, cinta de lomo, alitas de pollo, caldo de cocido ya hecho y un táper de pisto. Y congelado tengo espinacas, guisantes, cebolla picada, palitos de pescado, un salteado de setas, brócoli, croquetas, cuatro hamburguesas de ternera, pan, carne picada mixta, lomos de bacalao, anillas de calamar, medio kilo, pechugas de pavo, salmón, muslos de pollo, un preparado de pescado para sopa y dos filetes de ternera. Creo que nada más.",
    "debe": [
      "Apunta lo dictado en la despensa, cada cosa en su sitio (nevera o congelador)",
      "Rehace las cenas de la semana que viene tirando de lo que hay, con primero y segundo y sin pasta ni legumbre por la noche",
      "Contesta en menos de 60 segundos",
      "Resume los cambios en un mensaje corto, sin recitar toda la despensa"
    ],
    "no_debe": [
      "Tardar varios minutos con una llamada por cada producto",
      "Guardar un producto como otro distinto (las croquetas congeladas como otra cosa, por ejemplo)",
      "Dejar cenas de un solo plato"
    ],
    "herramientas": [
      "update_pantry",
      "swap_meal",
      "add_dish"
    ],
    "sin_modelo": false,
    "criterio_principal": "rapido"
  },
  {
    "id": "h-062",
    "tipo": "registro_comida",
    "dificultad": "trivial",
    "canal": "whatsapp",
    "hogar": "Dos adultos, una abuela y dos niños de 4 y 7 años. Cocinan casi a diario.",
    "situacion": "Sábado, 19:45. La cena del menú es una ternera guisada con patatas (unos 55 minutos). Mimo acaba de mandar el aviso de que toca empezar a cocinar.",
    "historial": [],
    "mensaje": "Esta noche son las fiestas del barrio y salimos con los peques!! De cena caerán bocatas de lomo con queso y unas quesadillas de jamón",
    "debe": [
      "Deja la cena de hoy como una nota con lo que van a cenar y quita el guiso previsto",
      "Confirma en una o dos líneas",
      "Como mucho, ofrece pasar el guiso a otro día"
    ],
    "no_debe": [
      "Crear recetas nuevas con ingredientes estimados para una cena improvisada",
      "Añadir ingredientes a la lista de la compra",
      "Dar trucos de cocina que nadie ha pedido"
    ],
    "herramientas": [
      "set_meal_note"
    ],
    "sin_modelo": false,
    "criterio_principal": "corto_sin_relleno"
  },
  {
    "id": "h-063",
    "tipo": "lista_compra",
    "dificultad": "trivial",
    "canal": "whatsapp",
    "hogar": "Tres adultos y un niño de 9 años. Cocinan casi a diario.",
    "situacion": "Jueves a mediodía. El menú de la semana está hecho y en la lista de la compra quedan unas 40 cosas sin marcar, de hoy al domingo. Mimo acaba de saludar y ha preguntado qué necesitan.",
    "historial": [],
    "mensaje": "Pásame lo que hay que comprar para estos días",
    "debe": [
      "Manda la lista en el propio chat, producto a producto y con cantidades",
      "La ordena por secciones para que se lea de un vistazo",
      "Cubre de hoy al domingo"
    ],
    "no_debe": [
      "Contestar solo con el número de cosas y un enlace",
      "Meter consejos sobre los platos del día que no se han pedido"
    ],
    "herramientas": [
      "get_shopping_list"
    ],
    "sin_modelo": true,
    "criterio_principal": "hecho_entero"
  },
  {
    "id": "h-064",
    "tipo": "cambiar_plato",
    "dificultad": "normal",
    "canal": "whatsapp",
    "hogar": "Dos adultos y dos niños de 5 y 8 años. Cocina casera de siempre: sus platos preferidos son espaguetis con tomate, pollo empanado con patatas y merluza a la plancha, y hacen a menudo lentejas con chorizo. Entre semana cenan cosas rápidas.",
    "situacion": "Sábado por la mañana. El menú de la semana que viene ya está hecho. Entre las cenas hay pimientos rellenos de arroz el martes, curry de lentejas rojas el miércoles y espinacas rehogadas el domingo. Mimo acaba de preguntar si cambian platos sueltos o rehace la semana.",
    "historial": [
      {
        "de": "mimo",
        "texto": "La próxima semana ya tenía su menú y lo he dejado igual. ¿Retocamos algunos platos o lo hago de nuevo? [botones: Cambiar platos | Rehacer la semana]"
      }
    ],
    "mensaje": "Quita el curry, las espinacas y los pimientos rellenos y pon otros",
    "debe": [
      "Cambia los tres platos nombrados y ninguno más",
      "Los sustitutos son platos caseros del estilo de la casa y propios de una cena",
      "Confirma día a día con el plato nuevo y el que quita"
    ],
    "no_debe": [
      "Poner platos exóticos o que esta casa no reconocería",
      "Poner un dulce o un postre como cena",
      "Poner una cena de más de una hora entre semana"
    ],
    "herramientas": [
      "get_weekly_menu",
      "swap_meal"
    ],
    "sin_modelo": false,
    "criterio_principal": "respeta_la_casa"
  },
  {
    "id": "h-065",
    "tipo": "cambiar_plato",
    "dificultad": "dificil",
    "canal": "whatsapp",
    "hogar": "Dos adultos y un niño de 6 años. Cocina casera; las lentejas las hacen siempre con chorizo.",
    "situacion": "Domingo, 20:45. El menú de la semana que empieza mañana está hecho: el martes hay solomillo guisado de comida y patatas con pescado en salsa verde de cena; el jueves, ensalada de coliflor de cena; el sábado a mediodía ya hay ramen casero. «Patatas volcán» es un plato de la casa: no está en sus recetas guardadas ni en el catálogo. Llega una nota de voz.",
    "historial": [],
    "mensaje": "Oye, quiero tocar los platos de la semana que entra. El martes a mediodía ponme lentejas y por la noche las patatas volcán, que si no te suenan luego te explico cómo van. Y el jueves por la noche, ramen casero.",
    "debe": [
      "Pone las lentejas de la casa (con chorizo) el martes a mediodía y el ramen casero el jueves por la noche",
      "Deja «patatas volcán» apuntado como nota en la cena del martes y pide la receta que le han ofrecido",
      "Avisa de que el ramen ya estaba el sábado y ofrece cambiar uno de los dos"
    ],
    "no_debe": [
      "Inventarse qué son las patatas volcán y crear una receta estimada",
      "Meter en la lista de la compra ingredientes de un plato que no conoce"
    ],
    "herramientas": [
      "search_recipes",
      "swap_meal",
      "set_meal_note"
    ],
    "sin_modelo": false,
    "criterio_principal": "verdad_comprobada"
  },
  {
    "id": "h-066",
    "tipo": "gustos_reglas",
    "dificultad": "trivial",
    "canal": "whatsapp",
    "hogar": "Dos adultos y un hijo de 15 años. Hay días sueltos en que no comen en casa.",
    "situacion": "Lunes, 8:40. Mimo hizo hace un minuto una pregunta para la ficha del hogar, con botones Sí | No | Ahora no: si tienen días fijos de comer fuera. Antes de contestar, el hogar pidió ver el menú y Mimo mandó la imagen preguntando si retocaba algo. El hogar pulsa ahora uno de los botones de aquella pregunta.",
    "historial": [
      {
        "de": "mimo",
        "texto": "De acuerdo, no cambio nada. Para ir ajustando: ¿tenéis días fijos de comer fuera de casa? [botones: Sí | No | Ahora no]"
      },
      {
        "de": "hogar",
        "texto": "Mándame el menú, que no me acuerdo de lo que había."
      },
      {
        "de": "mimo",
        "texto": "[imagen del menú semanal] Aquí lo tienes. ¿Retoco algo?"
      }
    ],
    "mensaje": "[botón] No",
    "debe": [
      "Entiende el «No» como respuesta a la pregunta de los botones: no tienen días fijos de comer fuera",
      "Guarda esa respuesta en la ficha del hogar",
      "Confirma en una línea"
    ],
    "no_debe": [
      "Tomarlo como «no cambies nada» y contestar que el menú se queda igual sin guardar nada",
      "Volver a hacer la misma pregunta"
    ],
    "herramientas": [
      "note_ficha_fact"
    ],
    "sin_modelo": true,
    "criterio_principal": "hecho_entero"
  },
  {
    "id": "h-067",
    "tipo": "gustos_reglas",
    "dificultad": "normal",
    "canal": "whatsapp",
    "hogar": "Dos adultos y un hijo de 15 años. Guardado: no les gusta el pimiento.",
    "situacion": "Lunes por la mañana. El menú de esta semana está hecho; el de la semana que viene todavía no. En el catálogo hay varios platos de pasta: espaguetis a la boloñesa, macarrones gratinados, pasta con boloñesa vegetal, espaguetis con ajo y aceite y ensalada de pasta con verduras.",
    "historial": [],
    "mensaje": "De cara al próximo menú, una petición: en casa somos muy de pasta, ¿puedes poner dos platos? Uno con verduras, por ejemplo, y el otro... a tu elección.",
    "debe": [
      "Apunta en la ficha que les gusta mucho la pasta",
      "Busca en el catálogo y propone dos platos de pasta que existen, uno de ellos con verduras",
      "Los platos propuestos no llevan pimiento",
      "Deja claro que irán en el menú de la semana que viene"
    ],
    "no_debe": [
      "Decir que en el catálogo casi no hay pasta",
      "Proponer recetas inventadas habiendo pasta en el catálogo"
    ],
    "herramientas": [
      "note_ficha_fact",
      "search_recipes"
    ],
    "sin_modelo": false,
    "criterio_principal": "verdad_comprobada"
  },
  {
    "id": "h-068",
    "tipo": "generar_menu",
    "dificultad": "dificil",
    "canal": "app",
    "hogar": "Dos adultos y dos niños de 7 y 10 años. Reglas fijas guardadas: las hamburguesas, solo en la cena del sábado; los bocadillos, solo en la cena del miércoles; los domingos no se cocina.",
    "situacion": "Lunes, 21:00, en la app, en la pantalla del menú. El menú de esta semana está hecho, pero hoy a mediodía comieron otra cosa. Mimo no ha preguntado nada.",
    "historial": [],
    "mensaje": "hazme otra vez el menú semanal. ten en cuenta que hoy lunes a mediodía cayeron una tortilla y unos espaguetis con tomate",
    "debe": [
      "Rehace la semana y deja en la comida del lunes lo que ya comieron",
      "El menú nuevo cumple las tres reglas fijas: hamburguesas solo el sábado por la noche, bocadillos solo el miércoles por la noche y domingo sin cocinar",
      "Lo que cuenta coincide con lo que queda guardado en el menú"
    ],
    "no_debe": [
      "Entregar un menú que rompe reglas fijas y preguntar después si las arregla",
      "Contar platos que no son los que han quedado en el menú"
    ],
    "herramientas": [
      "swap_meal",
      "lock_meal",
      "generate_weekly_menu"
    ],
    "sin_modelo": false,
    "criterio_principal": "respeta_la_casa"
  },
  {
    "id": "h-069",
    "tipo": "receta_nueva",
    "dificultad": "normal",
    "canal": "app",
    "hogar": "Dos adultos y una niña de 8 años. Cocinan a diario.",
    "situacion": "Martes por la tarde, en la app, en la ficha de una receta. Buscaban una receta de puerros gratinados y en el catálogo no hay. Mimo acaba de ofrecer guardar cualquier receta de una web o de un vídeo si le pasan el enlace.",
    "historial": [
      {
        "de": "hogar",
        "texto": "¿Y no sabes mirar en internet recetas que encajen con lo que me gusta?"
      },
      {
        "de": "mimo",
        "texto": "Buscar fuera no puedo, solo en el catálogo y en lo que tienes guardado. Si das con alguna que te apetezca, en una web o en un vídeo corto, pásame el enlace: la dejo guardada con lo que lleva y cómo se hace."
      }
    ],
    "mensaje": "[enlace a un vídeo corto de una red social con una receta de puerros gratinados]",
    "debe": [
      "Importa la receta del enlace y la guarda en las recetas del hogar, con ingredientes y pasos",
      "Confirma en una línea con el nombre de la receta guardada"
    ],
    "no_debe": [
      "Pedir una captura justo después de haber ofrecido guardar enlaces de vídeo",
      "Decir que la ha guardado si la importación ha fallado"
    ],
    "herramientas": [
      "import_recipe_from_url"
    ],
    "sin_modelo": false,
    "criterio_principal": "hecho_entero"
  },
  {
    "id": "h-070",
    "tipo": "salud_nutricion",
    "dificultad": "dificil",
    "canal": "app",
    "hogar": "Dos adultos y tres hijos de 6, 11 y 15 años. Cocinan a diario.",
    "situacion": "Lunes, 19:30, en la app, en la pantalla del menú. El menú de esta semana tiene, entre otros platos, hamburguesa casera a la plancha esta noche, merluza rebozada con ensalada en la comida del jueves y croquetas de jamón en la comida del sábado. El resto no lleva fritos ni rebozados.",
    "historial": [],
    "mensaje": "al mediano le han recomendado comer menos fritos. más que nada es quitarse las patatas de bolsa y los aperitivos, pero los rebozados también",
    "debe": [
      "Lee el menú de la semana antes de nombrar platos",
      "Señala los platos fritos o rebozados que hay de verdad, con su día correcto: merluza rebozada el jueves y croquetas el sábado",
      "Ofrece cambios concretos (al horno o a la plancha) y pregunta cuáles aplica",
      "Remite a quien se lo ha recomendado en una sola línea, sin dar pautas propias"
    ],
    "no_debe": [
      "Citar platos o días del menú sin haberlo leído",
      "Dar cantidades o pautas de alimentación como si fuera un profesional",
      "Cambiar platos sin preguntar"
    ],
    "herramientas": [
      "get_weekly_menu"
    ],
    "sin_modelo": false,
    "criterio_principal": "verdad_comprobada"
  },
  {
    "id": "h-071",
    "tipo": "receta_pasos",
    "dificultad": "trivial",
    "canal": "app",
    "hogar": "Dos adultos y dos niños de 4 y 9 años. Cocinan a diario.",
    "situacion": "Lunes a mediodía, en la app, en el modo cocina de la receta de hoy (alubias guisadas con verduras, cinco pasos), hablando por voz. Todavía no se ha leído ningún paso: el micrófono recogió un ruido de fondo, Mimo pidió que se lo repitieran y el hogar aclaró que no era nada.",
    "historial": [
      {
        "de": "hogar",
        "texto": "Nada, nada, era la radio, que la tengo puesta."
      },
      {
        "de": "mimo",
        "texto": "Sin problema. Seguimos con las alubias cuando me digas."
      }
    ],
    "mensaje": "¿Qué paso toca ahora?",
    "debe": [
      "Lee en voz el paso que toca, con sus cantidades",
      "Lo dice en una o dos frases y deja claro cómo pedir el siguiente"
    ],
    "no_debe": [
      "Preguntar en qué paso está o qué acaba de terminar",
      "Decir que ha pasado de paso sin leerlo"
    ],
    "herramientas": [
      "cooking_step",
      "get_recipe_details"
    ],
    "sin_modelo": true,
    "criterio_principal": "hecho_entero"
  },
  {
    "id": "h-072",
    "tipo": "generar_menu",
    "dificultad": "normal",
    "canal": "whatsapp",
    "hogar": "Dos adultos y dos niños de 2 y 6 años. En casa solo se cocina por la noche: unas cinco cenas a la semana y una única comida, sin día fijo todavía. Tienen freidora de aire y microondas.",
    "situacion": "Miércoles a primera hora de la tarde, al día siguiente del alta. El primer menú salió con comida y cena cada día y con platos elaborados. El hogar ha pedido recetas muy sencillas y ha contado lo que suele cocinar: filetes con una guarnición fácil, pasta con atún, purés de verduras y cosas de freidora de aire. Mimo ha ofrecido dos caminos con botones.",
    "historial": [
      {
        "de": "hogar",
        "texto": "El menú no pinta mal, pero yo voy a lo fácil: pocos ingredientes y poco lío en la cocina. Eso sí, que salga una semana equilibrada, con su legumbre, su pescado y su verdura."
      },
      {
        "de": "mimo",
        "texto": "Apuntado. Hasta el domingo quedan varios platos laboriosos. ¿Cambio solo esos o hago la semana de nuevo con este criterio? [botones: Cambiar esos platos | Rehacer la semana]"
      }
    ],
    "mensaje": "[botón] Rehacer la semana",
    "debe": [
      "Rehace los días que faltan de la semana con recetas sencillas y de pocos ingredientes",
      "El menú nuevo lleva solo cenas y, como mucho, una comida: no rellena la comida de cada día",
      "Incluye platos del estilo que el hogar acaba de contar",
      "Confirma en un solo mensaje corto"
    ],
    "no_debe": [
      "Generar comida y cena para todos los días",
      "Meter platos elaborados o exóticos",
      "Encadenar varios mensajes con preguntas distintas"
    ],
    "herramientas": [
      "generate_weekly_menu"
    ],
    "sin_modelo": true,
    "criterio_principal": "respeta_la_casa"
  },
  {
    "id": "h-073",
    "tipo": "gustos_reglas",
    "dificultad": "dificil",
    "canal": "whatsapp",
    "hogar": "Una pareja sin hijos. Cocinan casi a diario. Recién dados de alta: todavía no hay gustos guardados.",
    "situacion": "Jueves, 21:50, unas horas después del alta. Tienen su primer menú, de hoy al domingo. Mimo no ha preguntado nada.",
    "historial": [],
    "mensaje": "Os cuento cómo comemos en casa, a grandes rasgos:\nComemos de todo salvo vísceras; el conejo nos gusta, aunque se nos hace de sabor intenso. Las alcachofas y la coliflor no nos disgustan, pero nos cansan y casi nunca las compramos. Entre semana queremos platos ligeros, sabrosos y de mercado, y dejar lo contundente para el fin de semana. Además merendamos kombucha, porque tengo el hongo y le voy dando de comer. Cenamos pronto (me pongo a cocinar sobre las 20:00) y no queremos cenas de mucho rato. ¿Nos ayudas a montar unos menús de cocina mediterránea con todo esto, porfa?",
    "debe": [
      "Apunta lo que no comen (vísceras) y lo que prefieren evitar (conejo, alcachofas, coliflor)",
      "Apunta el estilo (mediterráneo, ligero entre semana) y que cenan pronto con cenas rápidas",
      "Entiende que «el hongo» es el cultivo de la kombucha que hacen en casa; si duda, lo pregunta en una línea",
      "Contesta en pocas líneas"
    ],
    "no_debe": [
      "Tratar «el hongo» como un problema de salud o mandar al médico por ello",
      "Apuntar como dato de salud lo que es un gusto",
      "Contestar con una parrafada de consejos"
    ],
    "herramientas": [
      "update_memory"
    ],
    "sin_modelo": false,
    "criterio_principal": "verdad_comprobada"
  },
  {
    "id": "h-074",
    "tipo": "cambiar_plato",
    "dificultad": "normal",
    "canal": "whatsapp",
    "hogar": "Tres adultos. Cocinan unos cuatro días por semana.",
    "situacion": "Jueves, 16:50, minutos después del alta. El primer menú va de hoy al domingo y en las cenas sale curry tres noches seguidas: de pollo hoy, de verduras el viernes y de garbanzos el sábado. El sábado a mediodía hay codillo asado. Mimo no ha preguntado nada.",
    "historial": [],
    "mensaje": "¿No te has pasado con el curry? Sale tres noches seguidas…",
    "debe": [
      "Deja un curry como mucho y cambia los otros",
      "Los sustitutos son platos propios de una cena, ligeros y distintos entre sí",
      "Confirma día a día con el plato nuevo y el que quita"
    ],
    "no_debe": [
      "Poner un guiso de legumbre u otro plato de cuchara contundente para cenar",
      "Dejar los tres curris y limitarse a dar la razón",
      "Rehacer toda la semana"
    ],
    "herramientas": [
      "suggest_recipes",
      "swap_meal"
    ],
    "sin_modelo": false,
    "criterio_principal": "platos_con_sentido"
  },
  {
    "id": "h-075",
    "tipo": "alta",
    "dificultad": "trivial",
    "canal": "whatsapp",
    "hogar": "Dos adultos y un niño de 5 años. En el perfil de la web han puesto que no comen coliflor.",
    "situacion": "Domingo, 14:00, con el alta recién empezada. Ya han dicho cuántos son y Mimo ha preguntado cuánto cocinan, con botones Casi a diario | 3-4 días | Poco. Es el último dato que falta para el primer menú.",
    "historial": [
      {
        "de": "mimo",
        "texto": "Anotado: dos adultos y un peque. ¿Cocináis mucho o poco? [botones: Casi a diario | 3-4 días | Poco]"
      }
    ],
    "mensaje": "[botón] Casi a diario",
    "debe": [
      "Guarda los primeros pasos y genera el primer menú",
      "El menú llega en menos de 30 segundos desde que pulsan el botón",
      "Ningún plato del menú lleva coliflor"
    ],
    "no_debe": [
      "Tardar minutos en mandar el primer menú",
      "Hacer más preguntas antes de darlo",
      "Mandar varios mensajes seguidos de explicaciones"
    ],
    "herramientas": [
      "complete_onboarding"
    ],
    "sin_modelo": true,
    "criterio_principal": "rapido"
  }
]

