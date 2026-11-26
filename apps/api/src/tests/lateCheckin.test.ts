/** PRO-250 — a reply after midnight to the evening's «¿hiciste la cena?» is about that day. */
import { describe, expect, it } from 'vitest'
import { lateDinnerCheckinNote } from '../services/whatsapp/lateCheckin.js'
import type { HistoryRow } from '../services/whatsapp/history.js'

// Friday 16 Oct 2026, 23:10 Madrid (CEST, UTC+2) = 21:10Z.
const checkin: HistoryRow = { direction: 'out', kind: 'dinner_checkin', body: '¿Hiciste hoy la cena (*Hummus casero*)? Así lo apunto.', status: 'sent', createdAt: new Date('2026-10-16T21:10:00Z') }

describe('lateDinnerCheckinNote', () => {
  it('00:30 on Saturday: the reply is about Friday 16 dinner', () => {
    const note = lateDinnerCheckinNote([checkin], new Date('2026-10-16T22:30:00Z'))
    expect(note).toContain('contesta al aviso de la cena del viernes 16 de octubre (enviado ese dia a las 23:10)')
    expect(note).toContain('day "2026-10-16"')
  })

  it('19-nov: until 13:00 the next morning a reply still counts for that dinner (conditional note)', () => {
    // Saturday 12:30 Madrid: a «sí, la hice» at noon was recorded on Saturday's dinner.
    const noon = lateDinnerCheckinNote([checkin], new Date('2026-10-17T10:30:00Z'))
    expect(noon).toContain('day "2026-10-16"')
    expect(noon).toContain('viernes 16 de octubre')
    expect(noon).toContain('Si habla de otra cosa, ignora esta nota')
    expect(lateDinnerCheckinNote([checkin], new Date('2026-10-17T04:30:00Z'))).toContain('day "2026-10-16"') // 06:30
    expect(lateDinnerCheckinNote([checkin], new Date('2026-10-17T11:00:00Z'))).toBeNull() // 13:00
  })

  it('not from 13:00, not on the same evening, not when already answered', () => {
    expect(lateDinnerCheckinNote([checkin], new Date('2026-10-16T21:40:00Z'))).toBeNull() // 23:40 Friday: "hoy" is right
    const answered: HistoryRow = { direction: 'in', kind: 'text', body: 'sí', status: 'processed', createdAt: new Date('2026-10-16T21:30:00Z') }
    expect(lateDinnerCheckinNote([checkin, answered], new Date('2026-10-16T22:30:00Z'))).toBeNull()
  })

  it('no check-in from yesterday, no note', () => {
    expect(lateDinnerCheckinNote([], new Date('2026-10-16T22:30:00Z'))).toBeNull()
    const old = { ...checkin, createdAt: new Date('2026-10-15T21:10:00Z') }
    expect(lateDinnerCheckinNote([old], new Date('2026-10-16T22:30:00Z'))).toBeNull()
  })
})
