/**
 * PRO-1297 · Mimo acts instead of asking, reads before it says, and adds no
 * tail-ends (exam of Mimo's whole history, 6-oct to 23-nov, findings M, I, F
 * and J). Same shape and use as `MIMO_EVAL_CASES` (mimoEvalCases.ts): the CI
 * test grades each case's literal bad reply (it must fail) and
 * `scripts/evalHealthAnswers.ts` sends the same conversation to the live
 * model and grades the fresh reply with the turn's tools (pass^3, D-168).
 * Every case is invented from the exam's situations (`examen-casos.json`),
 * with no household's data.
 *
 * - `actua` (a): what is clear and reversible gets done, not asked; after a
 *   «sí» to a proposal, all of it; a meal already gone is changed too.
 * - `guarda-norma` (b): a taste or a house rule is saved AND this week's
 *   dishes that break it are changed, without asking.
 * - `lee-antes` (c): nothing about the catalogue or the menu that wasn't
 *   read; a «similar» dish is never presented as the one asked for.
 * - `sin-coletilla` (d): after «gracias», «no» or a goodbye, one kind line
 *   and nothing else; elsewhere one tail-end at most and no unasked links.
 * - `duda-cocina` (e): a cooking doubt, a question about their own recipe
 *   or a thank-you is never «fuera de tema».
 */
import { claimsAction, READ_ONLY_TOOLS } from './claims.js'
import type { MimoEvalCase } from './mimoEvalCases.js'
import { WHATSAPP_OFF_TOPIC_REPLY } from './systemPrompt.js'

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export type ConductEvalCheck = 'actua' | 'guarda-norma' | 'lee-antes' | 'sin-coletilla' | 'duda-cocina'

export interface ConductEvalCase extends Pick<MimoEvalCase, 'id' | 'origin' | 'context' | 'history' | 'message' | 'reconstructed' | 'toolResults' | 'expect' | 'forbidden' | 'mustCallOneOf' | 'badReply'> {
  check: ConductEvalCheck
  /** Live eval only: each group needs at least one of its tools called. */
  mustCallAll?: string[][]
  /** Live eval only: how many times a tool must run at least («sí» to two changes: two swaps). */
  minCalls?: Record<string, number>
  /** The message closes or turns down (`gracias`, `no`, a goodbye, a joke): one kind line, nothing more. */
  closing?: boolean
  /** The household asked for a link (a link in the reply is then fine). */
  linkAsked?: boolean
}

/** A permission question: «¿Quieres que los cambie?», «¿Lo apunto?», «¿te parece bien?» (folded). */
const ASKS_PERMISSION_RE = /\b(quieres|quereis|prefieres|preferis|te parece|os parece|te viene bien|confirmas|confirmame|lo (cambio|hago|apunto|quito|pongo|guardo|anoto)|los (cambio|quito|pongo)|las (cambio|quito|pongo)|cambio (el|la|los|las|ese|esa|esos|esas)|procedo)\b[^?]*\?/
/** A tail-end: an offer, a survey, an invite, «¿algo más?» (one sentence, folded). */
const OFFER_RE = /\b(si quieres|si te apetece|si os apetece|si lo prefieres|puedo (tambien|ayudarte|prepararte|pasarte|mandarte)|tambien (te )?puedo|te (paso|mando|preparo) (la|el|tambien)|algo mas|necesitas algo|invita\w*|recomienda\w*|encuesta|una pregunta rapida|cuentame|valora\w*)\b/
const URL_RE = /https?:\/\/|www\.|\b[a-z0-9-]+\.(com|es)\/\S+/
/** WhatsApp's fixed off-topic sentence (`WHATSAPP_OFF_TOPIC_REPLY`), or a refusal in its spirit (folded). */
const OFF_TOPIC_RE = /solo (te )?puedo ayudar(te)? con|fuera de tema|no puedo ayudarte con eso/
/** One kind line: what a closing reply may take, at most. */
export const CLOSING_MAX = 200

const sentencesOf = (text: string) => text.split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean)

/**
 * Problems in a reply (empty = fine). `toolsUsed` only in the live eval.
 * - `pregunta-en-vez-de-actuar` (`actua`, `guarda-norma`): asks permission
 *   and says nothing done (live: and no tool that changes things ran);
 * - `a-medias` (live): a tool ran fewer times than the case needs, or one
 *   group of `mustCallAll` didn't run (`no-guarda` when it is the one that saves);
 * - `coletilla` / `enlace` / `larga` (closing): a question, an offer, a link,
 *   or more than one line; `coletillas` (elsewhere): two tail-ends or more;
 *   `enlace` also for a link nobody asked for;
 * - `fuera-de-tema`: the off-topic sentence or a refusal like it;
 * - `no-confirma` / `frase-prohibida` / `no-usa-herramienta`: as in the rest
 *   of the battery.
 */
export function conductReplyProblems(reply: string, c: ConductEvalCase, toolsUsed?: string[]): string[] {
  const text = fold(reply)
  const problems: string[] = []
  const changed = (toolsUsed ?? []).some((t) => !READ_ONLY_TOOLS.has(t) && t !== 'more_tools')
  if ((c.check === 'actua' || c.check === 'guarda-norma') && ASKS_PERMISSION_RE.test(text) && !claimsAction(reply) && !changed) {
    problems.push('pregunta-en-vez-de-actuar')
  }
  if (toolsUsed) {
    const count = (name: string) => toolsUsed.filter((t) => t === name).length
    const short = Object.entries(c.minCalls ?? {}).some(([name, n]) => count(name) < n)
    const missing = (c.mustCallAll ?? []).filter((group) => !group.some((t) => toolsUsed.includes(t)))
    if (missing.some((g) => g.includes('update_memory') || g.includes('note_ficha_fact'))) problems.push('no-guarda')
    if (short || missing.some((g) => !g.includes('update_memory') && !g.includes('note_ficha_fact'))) problems.push('a-medias')
  }
  if (OFF_TOPIC_RE.test(text)) problems.push('fuera-de-tema')
  const offers = sentencesOf(text).filter((s) => OFFER_RE.test(s)).length
  if (c.closing) {
    if (text.includes('?') || offers > 0) problems.push('coletilla')
    if (reply.trim().length > CLOSING_MAX) problems.push('larga')
  } else if (offers > 1) problems.push('coletillas')
  if (!c.linkAsked && URL_RE.test(text)) problems.push('enlace')
  if (c.expect && !c.expect.test(text)) problems.push('no-confirma')
  if ((c.forbidden ?? []).some((re) => re.test(text))) problems.push('frase-prohibida')
  if (toolsUsed && c.mustCallOneOf?.length && !c.mustCallOneOf.some((t) => toolsUsed.includes(t))) problems.push('no-usa-herramienta')
  return problems
}

const menuContext = (today: string, lines: string[], extra: string[] = []) =>
  [`Hoy es ${today}. La hora va al principio del ultimo mensaje del usuario.`, 'Hogar: 2 adultos y 2 niños', ...extra, 'Menu de esta semana (2026-11-23):', ...lines].join('\n')

const SWAP_DONE = (what: string) => `Hecho: ${what}`

export const CONDUCT_EVAL_CASES: ConductEvalCase[] = [
  // (a) Actúa en vez de preguntar.
  {
    id: 'sepia-coliflor-sin-preguntar',
    check: 'actua',
    origin: 'Examen del histórico de Mimo (h-010, reescrito): el día del alta, «yo sacaría la sepia y la coliflor» y Mimo preguntó por cuáles cambiarlos. PRO-1297',
    context: menuContext('miércoles 2026-11-25 (dayIndex 2)', [
      '  Mie (dayIndex 2): comida: Coliflor gratinada; cena: Sepia con guisantes',
      '  Jue (dayIndex 3): comida: Lentejas estofadas; cena: Tortilla de patatas',
    ]),
    history: [],
    message: 'Yo sacaría la sepia y la coliflor',
    reconstructed: true,
    toolResults: {
      swap_meal: SWAP_DONE('miércoles 25, cambiado por "Merluza al horno con patatas".'),
    },
    mustCallOneOf: ['swap_meal'],
    minCalls: { swap_meal: 2 },
    badReply: '¿Quieres que cambie la coliflor gratinada y la sepia con guisantes por otros platos? [[opciones: Sí | No]]',
  },
  {
    id: 'si-a-dos-cambios',
    check: 'actua',
    origin: 'Examen del histórico de Mimo (letra M: hace a medias tras un «sí», 17 turnos; reescrito). PRO-1297',
    context: menuContext('lunes 2026-11-23 (dayIndex 0)', [
      '  Mar (dayIndex 1): comida: Arroz con verduras; cena: Merluza rebozada',
      '  Jue (dayIndex 3): comida: Lentejas estofadas; cena: Croquetas de jamón',
    ]),
    history: [
      { role: 'user', content: 'esta semana no quiero muchos fritos' },
      { role: 'assistant', content: 'Esta semana hay dos cenas fritas: el martes, Merluza rebozada, y el jueves, Croquetas de jamón. ¿Las cambio por platos al horno o a la plancha? [[opciones: Sí | No]]' },
    ],
    message: 'Sí',
    reconstructed: true,
    toolResults: {
      swap_meal: SWAP_DONE('cambiado por "Pollo al horno con verduras".'),
    },
    /** Both dinners in the reply, not one. */
    expect: /(?=[\s\S]*merluza)(?=[\s\S]*croqueta)/,
    mustCallOneOf: ['swap_meal'],
    minCalls: { swap_meal: 2 },
    badReply: 'Hecho:\n- Martes 24, cena: Merluza al horno con verduras (en lugar de la rebozada)',
  },
  {
    id: 'ayer-cenamos-otra-cosa',
    check: 'actua',
    origin: 'Examen del histórico de Mimo (h-041, reescrito): «al final cené una tortilla francesa» sobre una comida ya pasada, y Mimo preguntó si la cambiaba. PRO-1297',
    context: menuContext('jueves 2026-11-26 (dayIndex 3)', [
      '  Mie (dayIndex 2): comida: Garbanzos con espinacas; cena: Pollo al limón',
      '  Jue (dayIndex 3): comida: Lentejas estofadas; cena: Crema de calabacín',
    ]),
    history: [],
    message: 'Ayer al final no hicimos el pollo al limón, cenamos tortilla francesa',
    reconstructed: true,
    toolResults: {
      set_meal_note: 'Hecho: la cena del miércoles 25 de noviembre queda como "Tortilla francesa".',
      swap_meal: SWAP_DONE('miércoles 25, cena: "Tortilla francesa" (en lugar de "Pollo al limón").'),
      log_cooked: 'Hecho: apuntado que el miércoles 25 de noviembre cenasteis "Tortilla francesa".',
    },
    expect: /tortilla/,
    mustCallOneOf: ['set_meal_note', 'swap_meal', 'log_cooked'],
    badReply: 'La cena de ayer ya ha pasado. ¿Quieres que cambie el pollo al limón por la tortilla francesa en el menú, o lo dejo como estaba? [[opciones: Cámbialo | Déjalo]]',
  },
  // (b) Un gusto o una norma se guarda y la semana se revisa.
  {
    id: 'curry-guarda-y-cambia',
    check: 'guarda-norma',
    origin: 'Examen del histórico de Mimo (h-038, reescrito): «el curry no nos gusta nada» y quedaban dos platos con curry en la semana. PRO-1297',
    context: menuContext('viernes 2026-11-27 (dayIndex 4)', [
      '  Vie (dayIndex 4): comida: Ensalada de lentejas; cena: Pollo al curry con arroz',
      '  Sab (dayIndex 5): comida: Curry de garbanzos y espinacas; cena: Tortilla de patatas',
      '  Dom (dayIndex 6): comida: Paella de verduras; cena: Crema de calabaza',
    ], ['Restricciones: sin marisco']),
    history: [],
    message: 'El curry no nos gusta nada',
    reconstructed: true,
    toolResults: {
      update_memory: 'Apuntado. (dislikes)',
      swap_meal: SWAP_DONE('cambiado por "Merluza a la plancha con patatas".'),
    },
    /** Says what happened with both curry dishes. */
    expect: /(?=[\s\S]*pollo)(?=[\s\S]*garbanzos)/,
    mustCallAll: [['update_memory', 'note_ficha_fact'], ['swap_meal']],
    minCalls: { swap_meal: 2 },
    badReply: 'Apuntado: nada de curry en los próximos menús.',
  },
  {
    id: 'pasta-nunca-de-cena',
    check: 'guarda-norma',
    origin: 'Examen del histórico de Mimo (h-058, reescrito): una norma nueva de pasta y la cena de ese día la incumplía. PRO-1297',
    context: menuContext('viernes 2026-11-27 (dayIndex 4)', [
      '  Vie (dayIndex 4): comida: Pollo asado; cena: Espaguetis con verduras',
      '  Sab (dayIndex 5): comida: Lentejas estofadas; cena: Tortilla de patatas',
      '  Dom (dayIndex 6): comida: Macarrones gratinados; cena: Crema de calabacín',
    ]),
    history: [],
    message: 'Otra norma para nuestros menús: la pasta, como máximo dos veces por semana y nunca de cena',
    reconstructed: true,
    toolResults: {
      note_ficha_fact: 'Apuntado en la ficha (nuevo): «Pasta, como mucho dos veces a la semana y nunca en la cena». Lo dijo esta persona, así que manda sobre lo que Mimoia deduzca. El menú y «Cambiar» lo respetan desde el próximo menú que se genere.',
      swap_meal: SWAP_DONE('viernes 27, cena: "Revuelto de calabacín" (en lugar de "Espaguetis con verduras").'),
    },
    /** Says what happened with tonight's spaghetti. */
    expect: /espaguetis/,
    mustCallAll: [['update_memory', 'note_ficha_fact', 'set_week_type_slot'], ['swap_meal']],
    badReply: 'Apuntado: la pasta, como mucho dos veces por semana y nunca en la cena. Lo tendré en cuenta en los próximos menús.',
  },
  // (c) Lee antes de afirmar.
  {
    id: 'pasta-en-el-catalogo',
    check: 'lee-antes',
    origin: 'Examen del histórico de Mimo (h-067, reescrito; el 23-nov dijo que casi no había pasta en el catálogo, y la había). PRO-1297',
    context: menuContext('lunes 2026-11-23 (dayIndex 0)', ['  Lun (dayIndex 0): comida: Garbanzos con espinacas; cena: Tortilla de patatas']),
    history: [],
    message: 'En casa somos muy de pasta: para el próximo menú, ¿me pones dos platos de pasta? Uno con verduras y el otro a tu elección',
    reconstructed: true,
    toolResults: {
      search_recipes: 'Recetas encontradas (5): Espaguetis a la boloñesa; Macarrones gratinados; Pasta con boloñesa vegetal; Espaguetis con ajo y aceite; Ensalada de pasta con verduras.',
      suggest_recipes: 'Sugerencias: Ensalada de pasta con verduras; Espaguetis a la boloñesa; Macarrones gratinados.',
      update_memory: 'Apuntado. (likes)',
      note_ficha_fact: 'Apuntado en la ficha (nuevo): «Les gusta mucho la pasta».',
    },
    /** Names at least one pasta of the catalogue. */
    expect: /espaguetis|macarrones|boloñesa|bolonesa|ensalada de pasta/,
    forbidden: [/casi no (hay|tenemos|tengo)/, /apenas (hay|tenemos|tengo)/, /no (hay|tenemos|tengo) (muchas|mucha|muchos)/, /pocas recetas de pasta/],
    mustCallOneOf: ['search_recipes', 'suggest_recipes'],
    badReply: 'En el catálogo casi no hay pasta, así que te propongo dos ideas mías: tallarines con calabacín y pasta con atún. ¿Te las pongo en el próximo menú?',
  },
  {
    id: 'lasana-no-es-canelones',
    check: 'lee-antes',
    origin: 'Examen del histórico de Mimo (letra I y h-041: «lo más parecido» presentado como lo pedido; reescrito). PRO-1297',
    context: menuContext('lunes 2026-11-23 (dayIndex 0)', ['  Jue (dayIndex 3): comida: Lentejas estofadas; cena: Merluza en salsa verde']),
    history: [],
    message: 'El jueves de cena pon lasaña de verduras',
    reconstructed: true,
    toolResults: {
      swap_meal: 'Hecho: cena del jueves 26 de noviembre: "Canelones de espinacas" (en lugar de "Merluza en salsa verde"). No hay ninguna receta que se llame "Lasaña de verduras"; he puesto la más parecida.',
      add_dish: 'Hecho: cena del jueves 26 de noviembre: "Canelones de espinacas". No hay ninguna receta que se llame "Lasaña de verduras"; he puesto la más parecida.',
    },
    /** Says it is not the lasagne asked for. */
    expect: /no (es|son) (la|el|lo) mism|no (habia|hay|tenia|tenemos|tengo|esta|encontre|he encontrado|existe)\b|parecid|en (su )?lugar de (la )?lasana|en vez de (la )?lasana/,
    forbidden: [/cena:\s*lasana de verduras/],
    mustCallOneOf: ['swap_meal', 'add_dish'],
    badReply: 'Hecho:\n- Jueves 26, cena: Lasaña de verduras',
  },
  // (d) Sin coletillas.
  {
    id: 'gracias-tras-cambio',
    check: 'sin-coletilla',
    origin: 'Examen del histórico de Mimo (letra F: ofertas y encuestas pegadas tras un «gracias»; reescrito). PRO-1297',
    context: menuContext('lunes 2026-11-23 (dayIndex 0)', ['  Lun (dayIndex 0): comida: Garbanzos con espinacas; cena: Tortilla de patatas']),
    history: [
      { role: 'user', content: 'cambia la cena de hoy por tortilla de patatas' },
      { role: 'assistant', content: '⟦hecho: swap_meal → Hecho: lunes 23, cena: "Tortilla de patatas" (en lugar de "Lubina al horno").⟧Hecho:\n- Lunes 23, cena: Tortilla de patatas (en lugar de la lubina)' },
    ],
    message: 'genial, gracias!',
    reconstructed: true,
    closing: true,
    badReply: '¡De nada! Si quieres, también te preparo la lista de la compra de esta semana. Por cierto, ¿conoces a alguien que siempre está con el «¿qué cenamos?»? Invítale con tu enlace: https://mimoia.com/r/abc',
  },
  {
    id: 'no-a-la-receta',
    check: 'sin-coletilla',
    origin: 'Examen del histórico de Mimo (letra F y h-060: tras un «no», otra pregunta o una encuesta; reescrito). PRO-1297',
    context: menuContext('martes 2026-11-24 (dayIndex 1)', ['  Mar (dayIndex 1): comida: Arroz con verduras; cena: Crema de calabaza']),
    history: [
      { role: 'user', content: 'esta noche pon crema de calabaza' },
      { role: 'assistant', content: '⟦hecho: swap_meal → Hecho: martes 24, cena: "Crema de calabaza".⟧Hecho:\n- Martes 24, cena: Crema de calabaza\n¿Te paso la receta? [[opciones: Sí | No]]' },
    ],
    message: 'No',
    reconstructed: true,
    closing: true,
    badReply: 'Vale. Una pregunta rápida para Mimoia: ¿os sobró algo de la última cena? Cuéntame y lo apunto.',
  },
  {
    id: 'cena-de-hoy-sin-relleno',
    check: 'sin-coletilla',
    origin: 'Examen del histórico de Mimo (h-051 y letra F: dos ofertas y un enlace pegados a «¿qué cenamos?»; reescrito). PRO-1297',
    context: menuContext('lunes 2026-11-23 (dayIndex 0), son las 15:20 en Madrid', ['  Lun (dayIndex 0): comida: Pescado a la plancha; cena: Crema de calabacín']),
    history: [],
    message: '¿Qué cenamos hoy?',
    reconstructed: true,
    expect: /crema de calabacin/,
    badReply: 'Hoy cenáis crema de calabacín. Si quieres, te paso la receta. También puedo prepararte la lista de la compra. Tienes el menú aquí: https://mimoia.com/menu',
  },
  // (e) Una duda de cocina nunca es «fuera de tema».
  {
    id: 'video-de-la-receta',
    check: 'duda-cocina',
    origin: 'Examen del histórico de Mimo (h-049, reescrito): «¿y el enlace del vídeo lo tienes?» en pleno modo cocina, contestado como fuera de tema. PRO-1297',
    context: menuContext('jueves 2026-11-26 (dayIndex 3), son las 20:05 en Madrid', ['  Jue (dayIndex 3): comida: Lentejas estofadas; cena: Costillas al horno']),
    history: [
      { role: 'user', content: 'Ábreme el paso a paso de las costillas' },
      { role: 'assistant', content: '⟦hecho: start_cooking_mode → Modo cocina listo: Costillas al horno.⟧Listo, ya tienes las costillas al horno en el modo cocina.' },
    ],
    message: '¿Y el enlace del vídeo lo tienes?',
    reconstructed: true,
    linkAsked: true,
    toolResults: {
      get_recipe_details: 'Es la receta del menu (cena del jueves 26 de noviembre).\nCostillas al horno (90 min en total, 4 raciones). Ingredientes: costillas de cerdo: 1kg, ajo: 3u, pimentón: 5g, aceite de oliva virgen extra: 30ml. Enlace original: https://www.youtube.com/watch?v=costillas123',
    },
    expect: /youtube\.com\/watch\?v=costillas123/,
    mustCallOneOf: ['get_recipe_details'],
    badReply: WHATSAPP_OFF_TOPIC_REPLY,
  },
  {
    id: 'bizcocho-de-casa',
    check: 'duda-cocina',
    origin: 'Examen del histórico de Mimo (letra J: dudas sobre una receta suya, fuera de la app, rechazadas como fuera de tema; reescrito). PRO-1297',
    context: menuContext('sábado 2026-11-28 (dayIndex 5), son las 9:00 en Madrid', ['  Sab (dayIndex 5): comida: Paella de verduras; cena: Tortilla de patatas']),
    history: [],
    message: 'Tengo una receta mía de bizcocho de yogur que no está en la app. Lleva un vaso de aceite de girasol: ¿lo puedo hacer con aceite de oliva?',
    reconstructed: true,
    expect: /aceite de oliva|\baove\b/,
    badReply: WHATSAPP_OFF_TOPIC_REPLY,
  },
  {
    id: 'te-debo-una-cana',
    check: 'duda-cocina',
    origin: 'Examen del histórico de Mimo (19-nov: un agradecimiento en broma contestado con un rechazo seco; reescrito). PRO-1297',
    context: menuContext('jueves 2026-11-19 (dayIndex 3), son las 21:30 en Madrid', ['  Jue (dayIndex 3): comida: Lentejas estofadas; cena: Tortilla de patatas']),
    history: [
      { role: 'user', content: 'cómo hago que la tortilla quede jugosa?' },
      { role: 'assistant', content: 'Cuaja la tortilla a fuego medio y dale la vuelta cuando los bordes estén hechos pero el centro aún tiemble; otro minuto por el otro lado y fuera.' },
    ],
    message: 'jajaja eres un crack, te debo una caña',
    reconstructed: true,
    closing: true,
    badReply: WHATSAPP_OFF_TOPIC_REPLY,
  },
]
