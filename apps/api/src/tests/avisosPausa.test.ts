/**
 * PRO-1303 (specs/notifications.md, specs/whatsapp.md): one pause for every
 * aviso, no cooking/dinner avisos to a household that isn't cooking from the
 * menu, and the thaw alert right. History 28-oct → 23-nov: the households
 * that never answer got 70 % of the avisos (3 answers of 59); the pause came
 * per kind, after 5 of that kind.
 */
import { describe, expect, it } from 'vitest'
import {
  AVISO_OUTBOUND_KINDS,
  DORMANT_SKIPPED_KINDS,
  FATIGUE_STREAK,
  PAUSE_ASK_KIND,
  avisoPauseState,
  avisosPaused,
  fatigueAnswerOf,
  fatigueQuestion,
  ignoredStreak,
  isDormant,
  type ActivityRow,
} from '../services/whatsapp/fatigue.js'
import { habitMatches, ingredientPrepCopy } from '../services/notificationScheduler.js'
import { FREEZE_HABIT_ALWAYS, THAW_CONDITIONAL_TEXT, freezeAnswerFromHabits, habitTurnsOn, thawIsConditional } from '@ona/shared'

const NOW = new Date('2026-11-24T12:00:00Z')
const HOUR = 60 * 60 * 1000
const at = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * HOUR)
const sent = (hoursAgo: number, kind: string): ActivityRow => ({ direction: 'out', kind, status: 'sent', createdAt: at(hoursAgo) })
const wrote = (hoursAgo: number): ActivityRow => ({ direction: 'in', kind: 'text', status: 'processed', createdAt: at(hoursAgo) })

describe('una sola pausa para todos los avisos', () => {
  // Three avisos of three different kinds, none answered.
  const silent = [sent(72, 'cooking_reminder'), sent(48, 'dinner_checkin'), sent(20, 'alert')]

  it('three unanswered avisos of different kinds → one question, and then every aviso waits', () => {
    expect(FATIGUE_STREAK).toBe(3)
    expect(ignoredStreak(silent, null, NOW)).toBe(3)
    expect(avisoPauseState(silent, null, NOW)).toBe('ask')
    // The question went: from then on nothing goes, of any kind, and no second question.
    const asked = [...silent, sent(0.1, PAUSE_ASK_KIND)]
    expect(avisosPaused(asked)).toBe(true)
    expect(avisoPauseState(asked, null, NOW)).toBe('paused')
    expect(avisoPauseState([...asked, sent(0.05, 'shopping_reminder')], null, NOW)).toBe('paused')
  })

  it('every aviso counts the same: prep alerts (`alert`), the morning menu, the Sunday nudge…', () => {
    for (const k of ['cooking_reminder', 'dinner_checkin', 'shopping_reminder', 'weekly_nudge', 'daily_brief', 'freezer_review', 'alert']) {
      expect(AVISO_OUTBOUND_KINDS.has(k)).toBe(true)
    }
    // Replies and other messages are not avisos.
    expect(ignoredStreak([sent(72, 'reply'), sent(48, 'survey'), sent(20, 'cooking_reminder')], null, NOW)).toBe(1)
  })

  it('a message, a button or opening the app resets the count; two avisos are not enough', () => {
    expect(avisoPauseState([...silent, wrote(30)], null, NOW)).toBe('send')
    expect(ignoredStreak([...silent, wrote(30)], null, NOW)).toBe(1)
    expect(avisoPauseState(silent, at(10), NOW)).toBe('send')
    expect(avisoPauseState(silent.slice(1), null, NOW)).toBe('send')
  })

  it('an aviso of the last 12 h is not judged yet; a failed one does not count', () => {
    expect(avisoPauseState([sent(72, 'cooking_reminder'), sent(48, 'dinner_checkin'), sent(2, 'alert')], null, NOW)).toBe('send')
    const failed: ActivityRow = { ...sent(20, 'alert'), status: 'failed' }
    expect(avisoPauseState([sent(72, 'cooking_reminder'), sent(48, 'dinner_checkin'), failed], null, NOW)).toBe('send')
  })

  it('the pause lasts until the person answers or writes on WhatsApp; then the count starts again', () => {
    const answered = [...silent, sent(10, PAUSE_ASK_KIND), wrote(1)]
    expect(avisosPaused(answered)).toBe(false)
    expect(avisoPauseState(answered, null, NOW)).toBe('send')
    // Opening the app alone doesn't lift it (they haven't answered).
    expect(avisoPauseState([...silent, sent(10, PAUSE_ASK_KIND)], at(1), NOW)).toBe('paused')
  })

  it('the question and its buttons, read back without the model', () => {
    const q = fatigueQuestion('es')
    expect(q).toEqual({
      type: 'buttons',
      text: 'He dejado en pausa mis avisos: los últimos se quedaron sin respuesta. ¿Te sigo avisando?',
      buttons: [
        { id: 'avisos:si:todos', title: 'Sí' },
        { id: 'avisos:no:todos', title: 'No' },
      ],
    })
    expect(fatigueQuestion('en').type === 'buttons' && fatigueQuestion('en').text).toContain('Shall I keep sending them?')
    expect(fatigueAnswerOf('avisos:no:todos')).toEqual({ kind: 'todos', keep: false })
    expect(fatigueAnswerOf('avisos:si:todos')).toEqual({ kind: 'todos', keep: true })
    // Before PRO-1303 the question was per kind: its buttons still work.
    expect(fatigueAnswerOf('avisos:no:shopping_reminder')).toEqual({ kind: 'shopping_reminder', keep: false })
    expect(fatigueAnswerOf('avisos:si:alert')).toBeNull()
  })
})

describe('hogar que no cocina del menú: sin «hora de cocinar» ni «¿qué tal la cena?»', () => {
  const DAY = 24 * HOUR

  it('no menu opened this week and nobody wrote in 14 days → dormant', () => {
    expect(isDormant({ openedWeekMenu: false, lastWroteAt: null }, NOW)).toBe(true)
    expect(isDormant({ openedWeekMenu: false, lastWroteAt: new Date(NOW.getTime() - 15 * DAY) }, NOW)).toBe(true)
  })

  it('opening the menu or writing in the last 14 days is enough', () => {
    expect(isDormant({ openedWeekMenu: true, lastWroteAt: null }, NOW)).toBe(false)
    expect(isDormant({ openedWeekMenu: false, lastWroteAt: new Date(NOW.getTime() - 13 * DAY) }, NOW)).toBe(false)
  })

  it('only those two kinds are dropped (the shopping or the Sunday nudge are not about tonight)', () => {
    expect([...DORMANT_SKIPPED_KINDS].sort()).toEqual(['cooking_reminder', 'dinner_checkin'])
  })
})

describe('el aviso de descongelar', () => {
  it('case 1: a habit in the negative doesn\'t turn it on («No congelan nada, compran fresco»)', () => {
    const habits = ['No congelan nada, compran el pescado fresco']
    expect(habitMatches('thaw_24h', habits)).toBe(false)
    expect(habitMatches('thaw_48h', ['Nunca congela la carne'])).toBe(false)
    expect(habitMatches('thaw_24h', ['Compra fresco y no lo congela'])).toBe(false)
    expect(habitMatches('soak_overnight', ['Sin remojo: usa legumbre de bote'])).toBe(false)
    expect(freezeAnswerFromHabits(habits)).toBeNull()
    expect(thawIsConditional(['A veces congelo la carne', 'No congela el pescado'])).toBe(true)
    // What does freeze still turns it on.
    expect(habitMatches('thaw_24h', [FREEZE_HABIT_ALWAYS])).toBe(true)
    expect(habitMatches('thaw_24h', ['Congelo la carne, no el pescado'])).toBe(true)
    expect(habitMatches('thaw_24h', ['Siempre congelo el pescado'])).toBe(true)
    expect(habitTurnsOn('No compra fresco, congela todo', /congel/)).toBe(true)
  })

  it('case 2: it says the right meal and day («para la cena del día 4» for a Thursday lunch)', () => {
    const copy = ingredientPrepCopy({ ingredientName: 'Merluza', method: 'thaw_24h', conditional: false, meal: 'lunch', dayIndex: 3, recipeName: 'Merluza en salsa verde' })
    expect(copy).toEqual({
      title: 'Acuérdate: Merluza',
      body: 'Sácalo hoy del congelador y déjalo en la nevera. Para la comida del jueves: Merluza en salsa verde.',
    })
    expect(copy.body).not.toContain('cena')
    const sometimes = ingredientPrepCopy({ ingredientName: 'Pollo', method: 'thaw_24h', conditional: true, meal: 'dinner', dayIndex: 0, recipeName: null })
    expect(sometimes.body).toBe(`${THAW_CONDITIONAL_TEXT} Para la cena del lunes.`)
    const noted = ingredientPrepCopy({ ingredientName: 'Garbanzos', method: 'soak_overnight', notes: 'Ponlos en remojo con agua fría.', conditional: false, meal: 'lunch', dayIndex: 5, recipeName: 'Cocido' })
    expect(noted.body).toBe('Ponlos en remojo con agua fría. Para la comida del sábado: Cocido.')
  })
})
