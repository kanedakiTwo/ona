/**
 * PRO-1336: a voice note says what was understood before changing anything;
 * empty asks to repeat, doubtful asks instead of acting. Pure functions.
 */
import { describe, expect, it } from 'vitest'
import {
  heardWords,
  turnChangedSomething,
  VOICE_NOTE_NOTE,
  voiceDoubtfulReply,
  voiceEmptyReply,
  voiceNoteClarity,
  withUnderstoodLine,
  withVoiceNoteNote,
} from '../services/assistant/voiceNote.js'

const SWAP = { name: 'swap_meal', summary: 'Jueves 15, cena: Tortilla de patatas (antes: Merluza al horno)' }

describe('voiceNoteClarity', () => {
  it('claro: una petición con sentido', () => {
    expect(voiceNoteClarity('Quita el pescado del jueves')).toBe('clear')
    expect(voiceNoteClarity('añade leche a la lista')).toBe('clear')
  })

  it('vacío: sin letras o un fantasma del reconocimiento de voz', () => {
    expect(voiceNoteClarity('')).toBe('empty')
    expect(voiceNoteClarity('   ')).toBe('empty')
    expect(voiceNoteClarity('...')).toBe('empty')
    expect(voiceNoteClarity(null)).toBe('empty')
    expect(voiceNoteClarity('Subtítulos realizados por la comunidad de Amara.org')).toBe('empty')
  })

  it('dudoso: solo muletillas, o una palabra suelta que no contesta a nada', () => {
    expect(voiceNoteClarity('Eh… mmm, bueno')).toBe('doubtful')
    expect(voiceNoteClarity('Pescado.')).toBe('doubtful')
    expect(voiceNoteClarity('eh, jueves')).toBe('doubtful')
  })

  it('una palabra que contesta a la pregunta de Mimo, o que es un mensaje entero, es clara', () => {
    expect(voiceNoteClarity('Pescado.', true)).toBe('clear')
    expect(voiceNoteClarity('Sí')).toBe('clear')
    expect(voiceNoteClarity('Gracias.')).toBe('clear')
    expect(voiceNoteClarity('Siguiente')).toBe('clear')
    expect(voiceNoteClarity('4')).toBe('clear')
  })
})

describe('respuestas sin modelo', () => {
  it('el vacío pide repetirlo; el dudoso dice lo que oyó y pregunta', () => {
    expect(voiceEmptyReply()).toBe('No te he oído bien. ¿Me lo repites o me lo escribes?')
    expect(voiceDoubtfulReply('Pescado.')).toBe('He oído «Pescado», pero no sé bien qué quieres que haga. ¿Me lo repites o me lo escribes?')
    expect(voiceDoubtfulReply('fish', 'en')).toMatch(/^I heard “fish”/)
  })

  it('lo oído va en una línea y acotado', () => {
    expect(heardWords('  ¿quita\n el pescado del jueves?  ')).toBe('quita el pescado del jueves')
    expect(heardWords('a'.repeat(300))).toHaveLength(120)
  })
})

describe('withUnderstoodLine', () => {
  it('ningún cambio sin la línea de lo entendido: si Mimo no la puso, la pone el código con lo oído', () => {
    expect(withUnderstoodLine('Hecho:\n- Jueves 15, cena: Tortilla de patatas', 'quita el pescado del jueves', [SWAP])).toBe(
      'Entendido: «quita el pescado del jueves».\nHecho:\n- Jueves 15, cena: Tortilla de patatas',
    )
  })

  it('si Mimo ya empieza por «Entendido», no la repite', () => {
    const m = 'Entendido: quitar el pescado del jueves.\nHecho:\n- Jueves 15, cena: Tortilla de patatas'
    expect(withUnderstoodLine(m, 'quita el pescado del jueves', [SWAP])).toBe(m)
    expect(withUnderstoodLine(`*Entendido*: x\nHecho`, 'x', [SWAP])).toBe('*Entendido*: x\nHecho')
  })

  it('sin cambios (solo leer, un error o «no he cambiado nada») la respuesta queda igual', () => {
    const m = 'Hoy toca crema de calabaza.'
    expect(withUnderstoodLine(m, 'qué hay hoy', [])).toBe(m)
    expect(withUnderstoodLine(m, 'qué hay hoy', undefined)).toBe(m)
    expect(withUnderstoodLine(m, 'qué hay hoy', [{ name: 'get_todays_menu', summary: 'Menu de hoy: …' }])).toBe(m)
    expect(withUnderstoodLine(m, 'x', [{ name: 'swap_meal', summary: 'boom', error: true }])).toBe(m)
    expect(withUnderstoodLine(m, 'x', [{ name: 'swap_meal', summary: 'No he cambiado nada: ese día no tiene cena' }])).toBe(m)
    expect(withUnderstoodLine(m, 'x', [{ name: 'generate_weekly_menu', summary: 'Ya había menú', unchanged: true }])).toBe(m)
  })

  it('en inglés, «Understood»', () => {
    expect(withUnderstoodLine('Done.', 'remove the fish on thursday', [SWAP], 'en')).toBe('Understood: “remove the fish on thursday”.\nDone.')
  })

  it('turnChangedSomething cuenta los cambios de la lista y la ficha, no las lecturas', () => {
    expect(turnChangedSomething([{ name: 'add_shopping_items', summary: 'Añadido: leche' }])).toBe(true)
    expect(turnChangedSomething([{ name: 'get_shopping_list', summary: 'Lista: …' }])).toBe(false)
  })
})

describe('la nota para Mimo', () => {
  it('va delante de las palabras y pide «Entendido:» antes de cambiar, o preguntar si no está claro', () => {
    expect(withVoiceNoteNote('quita el pescado')).toBe(`${VOICE_NOTE_NOTE}\n\nquita el pescado`)
    expect(VOICE_NOTE_NOTE).toMatch(/Entendido: /)
    expect(VOICE_NOTE_NOTE).toMatch(/no cambies nada/)
  })
})
