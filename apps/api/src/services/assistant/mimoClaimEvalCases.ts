/**
 * PRO-349 · a «Hecho» from Mimo only for what a tool confirmed (test
 * households, 2026-10-22). One case per part, same shape and use as `MIMO_EVAL_CASES`
 * (mimoEvalCases.ts): the CI test grades each case's literal bad reply (it
 * must fail) and `scripts/evalHealthAnswers.ts` sends the same conversation
 * to the live model and grades the fresh reply with the turn's tool trace.
 *
 * - `dia-sin-cocinar`: a dish put on a «sin cocinar» day goes on the menu
 *   with a tool and the reply says the day is active again (the tool says
 *   so: the save takes it out of `skippedDays`, `unskipDay`).
 * - `hecho-confirmado`: a «Hecho» only for what a tool confirmed. With the
 *   trace (live), a claim while a tool that changes things failed or changed
 *   nothing, and no later call fixed it (`unconfirmedCalls`); without it
 *   (CI), the trace the bad reply came with (`badTrace`).
 * - `receta-del-menu`: «la receta de hoy» is read from the menu:
 *   get_recipe_details with day/meal or the menu recipe's name, never
 *   another recipe with a similar name.
 */
import { admitsNotDone, claimsAction, toolMadeChange, unconfirmedCalls } from './claims.js'
import type { MimoEvalCase } from './mimoEvalCases.js'

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export type ClaimEvalCheck = 'dia-sin-cocinar' | 'hecho-confirmado' | 'receta-del-menu'

/** A tool call as the engine traces it (`toolTrace`): what ran, with what, what came back. */
export interface ClaimEvalToolCall {
  name: string
  input: string
  summary?: string
  error?: boolean
}

export interface ClaimEvalCase extends Pick<MimoEvalCase, 'id' | 'origin' | 'context' | 'history' | 'message' | 'reconstructed' | 'toolResults' | 'expect' | 'forbidden' | 'mustCallOneOf' | 'badReply'> {
  check: ClaimEvalCheck
  /** `hecho-confirmado`: the tool calls the bad reply came with (CI grading). */
  badTrace?: ClaimEvalToolCall[]
  /** `receta-del-menu`: the recipe on the menu, as get_recipe_details must be asked for it. */
  menuRecipe?: string
}

/** The day back to active, in the reply: «vuelve a estar activo», «lo he reactivado», «ya no está sin cocinar». */
const REACTIVATED_RE = /reactiv|vuelve a estar activ|ya (esta|vuelve a estar) activ|ya no (esta|sale|queda) (marcado )?(como )?sin cocinar|deja de estar sin cocinar/

/**
 * Problems in a reply (empty = fine). `toolsUsed` and `toolTrace` only in the
 * live eval.
 * - `sin-reactivar` (`dia-sin-cocinar`): doesn't say the skipped day is active again;
 * - `hecho-sin-confirmar` (`hecho-confirmado`): claims a change a tool didn't confirm;
 * - `otra-receta` (`receta-del-menu`): read a recipe without day/meal and without the menu recipe's name;
 * - `no-confirma`: doesn't say what the case expects; `frase-prohibida`: one of its forbidden phrases;
 * - `no-usa-herramienta`: didn't call the tool it had to.
 */
export function claimReplyProblems(reply: string, c: ClaimEvalCase, toolsUsed?: string[], toolTrace?: ClaimEvalToolCall[]): string[] {
  const text = fold(reply)
  const problems: string[] = []
  if (c.check === 'dia-sin-cocinar' && !REACTIVATED_RE.test(text)) problems.push('sin-reactivar')
  if (c.check === 'hecho-confirmado') {
    const trace = toolTrace ?? c.badTrace ?? []
    const outcomes = trace.map((t) => ({ name: t.name, summary: t.summary ?? '', error: !!t.error }))
    const changed = outcomes.some((o) => toolMadeChange(o.name, o.summary, o.error))
    const halfTrue = changed && unconfirmedCalls(outcomes).length > 0 && !admitsNotDone(reply)
    if (claimsAction(reply) && (!changed || halfTrue)) problems.push('hecho-sin-confirmar')
  }
  if (c.check === 'receta-del-menu' && toolTrace && c.menuRecipe) {
    const reads = toolTrace.filter((t) => t.name === 'get_recipe_details')
    const menuName = fold(c.menuRecipe)
    const fromMenu = (t: ClaimEvalToolCall) => /"(day|meal)":/.test(t.input) || fold(t.input).includes(menuName)
    if (reads.length > 0 && !reads.every(fromMenu)) problems.push('otra-receta')
  }
  if (c.expect && !c.expect.test(text)) problems.push('no-confirma')
  if ((c.forbidden ?? []).some((re) => re.test(text))) problems.push('frase-prohibida')
  if (toolsUsed && c.mustCallOneOf?.length && !c.mustCallOneOf.some((t) => toolsUsed.includes(t))) problems.push('no-usa-herramienta')
  return problems
}

export const CLAIM_EVAL_CASES: ClaimEvalCase[] = [
  {
    id: 'arroz-dia-sin-cocinar',
    check: 'dia-sin-cocinar',
    origin: 'Dani y Sara, 2026-10-22 (la respuesta, resumida, y la captura 03-sabado-arroz-limpieza.jpg; la petición es reconstruida). PRO-349',
    context: [
      'Hoy es jueves 2026-10-22 (dayIndex 3). La hora va al principio del ultimo mensaje del usuario.',
      'Usuario: dani',
      'Restricciones: sin gluten',
      'Hogar: 2 adultos',
      'Menu de esta semana (2026-10-19):',
      '  Jue (dayIndex 3): comida: Lentejas estofadas; cena: Tortilla de patatas',
    ].join('\n'),
    history: [],
    message: 'el sábado a mediodía al final comemos en casa: arroz de limpieza. ponlo en el menú',
    reconstructed: true,
    toolResults: {
      swap_meal: 'Hecho. "Arroz de limpieza" no esta en sus recetas ni en el catalogo, asi que lo he puesto como nota en la comida del sábado 24 de octubre. El sábado 24 de octubre estaba marcado sin cocinar: ya vuelve a estar activo.',
      add_dish: 'Hecho: he añadido "Arroz de limpieza" a la comida del sábado 24 de octubre como nota, porque no esta en sus recetas ni en el catalogo. El sábado 24 de octubre estaba marcado sin cocinar: ya vuelve a estar activo.',
      set_meal_note: 'Hecho: la comida del sábado 24 de octubre queda como "Arroz de limpieza". El sábado 24 de octubre estaba marcado sin cocinar: ya vuelve a estar activo.',
      get_todays_menu: 'No hay comidas planificadas para el sábado 24 de octubre.',
    },
    expect: /arroz de limpieza/,
    mustCallOneOf: ['swap_meal', 'add_dish', 'set_meal_note'],
    badReply: 'Hecho: el sábado 24 coméis arroz de limpieza.',
  },
  {
    id: 'cilantro-butter-chicken',
    check: 'hecho-confirmado',
    origin: 'Laura, 2026-10-22 (la petición y el «Hecho», del feedback; lo que contestó la herramienta es reconstruido: la receta estaba en su menú y no se tocó). PRO-349',
    context: [
      'Hoy es jueves 2026-10-22 (dayIndex 3). La hora va al principio del ultimo mensaje del usuario.',
      'Usuario: laura',
      'Hogar: 1 adulto',
      'Menu de esta semana (2026-10-19):',
      '  Vie (dayIndex 4): cena: Butter chicken',
    ].join('\n'),
    history: [],
    message: 'quítale el cilantro al butter chicken, que no me gusta nada',
    reconstructed: true,
    toolResults: {
      edit_recipe: 'No he cambiado nada: "Butter chicken" es una receta del catálogo de Mimoia, no tuya. Para hacer cambios, primero añádela a sus recetas (add_recipe_to_mine) y edita la copia; para quitar o cambiar un ingrediente, en la copia se abre el editor.',
      update_recipe_notes: 'Hecho: guardado en "Butter chicken" (receta del catalogo de Mimoia) — sustituciones. Al confirmarlo nombra esta receta tal cual, "Butter chicken" (receta del catalogo de Mimoia).',
      update_memory: 'Hecho: apuntado que no le gusta el cilantro.',
      get_recipe_details: 'Es la receta del menu (cena del viernes 23 de octubre).\nButter chicken (45 min en total, 2 raciones). Ingredientes: muslos de pollo: 400g, tomate triturado: 200g, nata: 100ml, cilantro fresco: 5g, garam masala: 5g.',
    },
    /** Says what happened with the cilantro (a note, the dislike, or that it isn't changed). */
    expect: /cilantro/,
    badTrace: [
      { name: 'update_memory', input: '{"dislikes":["cilantro"]}', summary: 'Hecho: apuntado que no le gusta el cilantro.' },
      { name: 'edit_recipe', input: '{"recipeName":"butter chicken"}', summary: 'No he encontrado una receta tuya que se llame "butter chicken". Sólo puedes editar las recetas que tú has creado.' },
    ],
    badReply: 'Hecho: he quitado el cilantro del butter chicken.',
  },
  {
    id: 'pan-receta-de-hoy',
    check: 'receta-del-menu',
    origin: 'Carmen y Antonio, 2026-10-22 (la respuesta mala es reconstruida del feedback: miró «Garbanzos con espinacas y huevo», no la receta del menú; el plato del menú, también). PRO-349',
    context: [
      'Hoy es jueves 2026-10-22 (dayIndex 3). La hora va al principio del ultimo mensaje del usuario.',
      'Usuario: carmen',
      'Hogar: 2 adultos',
      'Menu de esta semana (2026-10-19):',
      '  Jue (dayIndex 3): comida: Espinacas con garbanzos a la sevillana; cena: Crema de calabacin',
    ].join('\n'),
    history: [],
    message: 'la receta de hoy lleva pan? no me queda',
    reconstructed: true,
    menuRecipe: 'Espinacas con garbanzos',
    toolResults: {
      get_recipe_details: 'Es la receta del menu (comida del jueves 22 de octubre).\nEspinacas con garbanzos a la sevillana (40 min en total, 4 raciones). Ingredientes: espinacas: 400g, garbanzos cocidos: 400g, pan del dia anterior: 60g, ajo: 2u, comino: 2g, pimenton: 3g, aceite de oliva virgen extra: 40ml.',
      get_todays_menu: 'Menu del jueves 22 de octubre: comida: Espinacas con garbanzos a la sevillana; cena: Crema de calabacin',
    },
    /** Says it does take bread. */
    expect: /(?<!no )\b(lleva|llevan|tiene|necesitas)\b[^.]*\bpan\b|^\s*si\b[^.]*\bpan\b|\bpan\b[^.]*\b(majado|frito)\b/,
    forbidden: [/no lleva pan/, /garbanzos con espinacas y huevo/, /mire otra receta/],
    mustCallOneOf: ['get_recipe_details'],
    badReply: 'No, la receta de hoy no lleva pan: son garbanzos con espinacas y huevo, así que no te hace falta.',
  },
]
