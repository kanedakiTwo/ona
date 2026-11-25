/**
 * PRO-1297 · Mimo acts instead of asking, reads before it says and adds no
 * tail-ends (exam of Mimo's whole history, findings M, I, F and J). The rule
 * (`ACT_RULE`) goes in every mode and replaces the lines it overlapped; the
 * battery (`CONDUCT_EVAL_CASES`) has at least two cases per part, and each
 * bad reply must fail while a good one passes.
 */
import { describe, expect, it } from 'vitest'
import { ACT_RULE, buildSystemPrompt, WHATSAPP_OFF_TOPIC_REPLY } from '../services/assistant/systemPrompt.js'
import { CONDUCT_EVAL_CASES, conductReplyProblems, type ConductEvalCheck } from '../services/assistant/mimoConductEvalCases.js'

const byId = (id: string) => {
  const c = CONDUCT_EVAL_CASES.find((x) => x.id === id)
  if (!c) throw new Error(`no case ${id}`)
  return c
}

describe('the rule in the prompt', () => {
  it('goes once in every mode', () => {
    for (const mode of ['text', 'whatsapp', 'voice'] as const) {
      const p = buildSystemPrompt('', mode)
      expect(p.split(ACT_RULE).length - 1).toBe(1)
    }
  })

  it('says each part: act, save and review the week, read first, no tail-ends', () => {
    expect(ACT_RULE).toMatch(/Actua, no preguntes: pregunta solo si hay dos lecturas con cambios distintos o vas a borrar algo/)
    expect(ACT_RULE).toMatch(/Tras un "si" a lo que propusiste, haz TODO lo propuesto/)
    expect(ACT_RULE).toMatch(/tambien en comidas ya pasadas, se hace sin preguntar/)
    expect(ACT_RULE).toMatch(/se guarda siempre .* y se aplica\. Al guardarlo, revisa tu el resto de la semana/)
    expect(ACT_RULE).toMatch(/Alergias, intolerancias y salud siguen su regla/)
    expect(ACT_RULE).toMatch(/No afirmes nada de su cuenta .* ni del catalogo sin leerlo en este turno o en los Datos/)
    expect(ACT_RULE).toMatch(/Un plato "parecido" al pedido no es un acierto: di que no es el mismo/)
    expect(ACT_RULE).toMatch(/Tras un "gracias", un "no" o una despedida, una linea amable y nada mas: ni ofertas, ni encuestas, ni preguntas, ni enlaces/)
    expect(ACT_RULE).toMatch(/como mucho una coletilla .* y ningun enlace que no te pidan/)
  })

  it('keeps a cooking doubt and a thank-you out of WhatsApp’s off-topic sentence', () => {
    const wa = buildSystemPrompt('', 'whatsapp')
    expect(wa).toMatch(/una duda de cocina o sobre una receta suya \(aunque no este en Mimoia\) nunca es fuera de tema/)
    expect(wa).toContain(`responde exactamente: "${WHATSAPP_OFF_TOPIC_REPLY}" y nada mas; nunca a un agradecimiento, un saludo o una broma: eso, con una linea amable.`)
  })

  it('drops the lines it replaced, so nothing says the same twice', () => {
    for (const mode of ['text', 'whatsapp'] as const) {
      const p = buildSystemPrompt('', mode)
      expect(p).not.toMatch(/No pidas permiso para cambios normales/)
      expect(p).not.toMatch(/Haz TODO lo que pida el mensaje/)
      expect(p).not.toMatch(/Si el usuario solo agradece o cierra/)
      expect(p).not.toMatch(/Solo pregunta si es imprescindible/)
      expect(p).not.toMatch(/Si el usuario pide varias cosas en un mensaje, hazlas todas/)
      expect(p).not.toMatch(/comprueba antes que existe/)
      expect(p).not.toMatch(/sugiere generar mas menus/)
    }
  })
})

describe('the battery (CONDUCT_EVAL_CASES)', () => {
  it('has at least 12 cases, two or more per part, with unique ids', () => {
    expect(CONDUCT_EVAL_CASES.length).toBeGreaterThanOrEqual(12)
    const per = new Map<ConductEvalCheck, number>()
    for (const c of CONDUCT_EVAL_CASES) per.set(c.check, (per.get(c.check) ?? 0) + 1)
    for (const check of ['actua', 'guarda-norma', 'lee-antes', 'sin-coletilla', 'duda-cocina'] as const) {
      expect(per.get(check) ?? 0, check).toBeGreaterThanOrEqual(2)
    }
    expect(new Set(CONDUCT_EVAL_CASES.map((c) => c.id)).size).toBe(CONDUCT_EVAL_CASES.length)
  })

  it('fails every bad reply', () => {
    for (const c of CONDUCT_EVAL_CASES) expect(conductReplyProblems(c.badReply, c), c.id).not.toEqual([])
  })

  it.each([
    ['sepia-coliflor-sin-preguntar', ['pregunta-en-vez-de-actuar']],
    ['si-a-dos-cambios', ['no-confirma']],
    ['ayer-cenamos-otra-cosa', ['pregunta-en-vez-de-actuar']],
    ['curry-guarda-y-cambia', ['no-confirma']],
    ['pasta-nunca-de-cena', ['no-confirma']],
    ['pasta-en-el-catalogo', ['no-confirma', 'frase-prohibida']],
    ['lasana-no-es-canelones', ['no-confirma', 'frase-prohibida']],
    ['gracias-tras-cambio', ['coletilla', 'enlace']],
    ['no-a-la-receta', ['coletilla']],
    ['cena-de-hoy-sin-relleno', ['coletillas', 'enlace']],
    ['video-de-la-receta', ['fuera-de-tema', 'no-confirma']],
    ['bizcocho-de-casa', ['fuera-de-tema', 'no-confirma']],
    ['te-debo-una-cana', ['fuera-de-tema', 'coletilla']],
  ])('%s: the bad reply fails with %j', (id, problems) => {
    const c = byId(id)
    expect(conductReplyProblems(c.badReply, c)).toEqual(problems)
  })

  it.each([
    ['sepia-coliflor-sin-preguntar', 'Hecho:\n- Miércoles 25, comida: Merluza al horno con patatas (en lugar de la coliflor)\n- Miércoles 25, cena: Pollo asado (en lugar de la sepia)', ['swap_meal', 'swap_meal', 'update_memory']],
    ['si-a-dos-cambios', 'Hecho:\n- Martes 24, cena: Merluza al horno (en lugar de la rebozada)\n- Jueves 26, cena: Pollo al horno con verduras (en lugar de las croquetas)', ['swap_meal', 'swap_meal']],
    ['ayer-cenamos-otra-cosa', 'Hecho:\n- Miércoles 25, cena: Tortilla francesa (en lugar del pollo al limón)', ['set_meal_note']],
    ['curry-guarda-y-cambia', 'Hecho:\n- Apuntado: no os gusta el curry\n- Viernes 27, cena: Merluza a la plancha con patatas (en lugar del pollo al curry)\n- Sábado 28, comida: Garbanzos con bacalao (en lugar del curry de garbanzos)', ['update_memory', 'swap_meal', 'swap_meal']],
    ['pasta-nunca-de-cena', 'Hecho:\n- Apuntado: la pasta, nunca de cena\n- Viernes 27, cena: Revuelto de calabacín (en lugar de los espaguetis)\nLos macarrones del domingo son de comida: se quedan.', ['note_ficha_fact', 'swap_meal']],
    ['pasta-en-el-catalogo', 'Apuntado que sois de pasta. Para el próximo menú: Ensalada de pasta con verduras y Espaguetis a la boloñesa.', ['search_recipes', 'note_ficha_fact']],
    ['lasana-no-es-canelones', 'Hecho:\n- Jueves 26, cena: Canelones de espinacas (no había lasaña de verduras; he puesto esto en su lugar)', ['swap_meal']],
    ['gracias-tras-cambio', '¡A vosotros! Que aproveche la tortilla.', []],
    ['no-a-la-receta', 'Vale, que aproveche.', []],
    ['cena-de-hoy-sin-relleno', 'Hoy cenáis crema de calabacín. ¿Te paso la receta?', ['get_todays_menu']],
    ['video-de-la-receta', 'Sí: https://www.youtube.com/watch?v=costillas123', ['get_recipe_details']],
    ['bizcocho-de-casa', 'Sí: usa la misma cantidad de aceite de oliva suave (o virgen extra, si no te importa que se note un poco). Queda igual de jugoso.', []],
    ['te-debo-una-cana', '¡Jaja, apuntada queda! Que salga jugosa.', []],
  ])('%s: a good reply passes', (id, reply, tools) => {
    const c = byId(id)
    expect(conductReplyProblems(reply, c)).toEqual([])
    expect(conductReplyProblems(reply, c, tools)).toEqual([])
  })

  it('catches half done after a «sí» and a rule not saved (live)', () => {
    const si = byId('si-a-dos-cambios')
    const both = 'Hecho:\n- Martes 24, cena: Merluza al horno\n- Jueves 26, cena: Pollo al horno (en lugar de las croquetas)'
    expect(conductReplyProblems(both, si, ['swap_meal'])).toEqual(['a-medias'])
    const curry = byId('curry-guarda-y-cambia')
    const changed = 'Hecho:\n- Viernes 27, cena: Merluza (en lugar del pollo al curry)\n- Sábado 28, comida: Garbanzos con bacalao'
    expect(conductReplyProblems(changed, curry, ['swap_meal', 'swap_meal'])).toEqual(['no-guarda'])
    expect(conductReplyProblems('Apuntado: nada de curry. Hoy hay pollo y el sábado garbanzos.', curry, ['update_memory'])).toEqual(['a-medias'])
  })

  it('lets a question go when something was done, or when the case has two readings', () => {
    const c = byId('ayer-cenamos-otra-cosa')
    expect(conductReplyProblems('Hecho:\n- Miércoles 25, cena: Tortilla francesa\n¿Quieres pasar el pollo al limón a otro día?', c, ['set_meal_note'])).toEqual([])
  })
})
