/**
 * PRO-285: Mimo asks each beta user with WhatsApp, once, what they did with
 * the leftovers of their last dinner — at the end of a WhatsApp reply (inside
 * the 24 h window), never together with another offer, off from 2026-11-08 —
 * and the answer goes to `user_feedback` tagged `sobras`, which
 * `/admin/feedback` counts.
 */
import express, { type RequestHandler } from 'express'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterAll, describe, expect, it, vi } from 'vitest'
vi.mock('../db/connection.js', () => ({ db: { execute: vi.fn(async () => ({ rows: [] })) } }))

import {
  LEFTOVERS_QUESTION,
  isLeftoversAnswer,
  maybeLeftoversQuestion,
  recordLeftoversAnswer,
  shouldAskLeftovers,
  type LeftoversQuestionStore,
} from '../services/leftoversQuestion.js'
import { appendReplyOffers, type ReplyOfferSteps } from '../services/assistant/engine.js'
import { createFeedbackRouter, type FeedbackRepo, type FeedbackRow } from '../routes/feedback.js'
import type { ChatMessage } from '../services/assistant/types.js'

// Thursday 2026-10-22 12:00 in Madrid (UTC+2).
const NOW = new Date('2026-10-22T10:00:00Z')
const HOUR = 3_600_000

/** One user's row in memory: users.leftovers_question_at, the WhatsApp link, the tagged opinions. */
function memoryStore(over: { linked?: boolean; lastInboundAt?: Date | null } = {}) {
  const state = {
    askedAt: null as Date | null,
    linked: over.linked ?? true,
    lastInboundAt: over.lastInboundAt === undefined ? new Date(NOW.getTime() - 60_000) : over.lastInboundAt,
    answers: [] as Array<{ userId: string; text: string; tag: string; channel: string }>,
  }
  const store: LeftoversQuestionStore = {
    async load() {
      return { askedAt: state.askedAt, linked: state.linked, lastInboundAt: state.lastInboundAt }
    },
    async claim(_u, now) {
      if (state.askedAt) return false
      state.askedAt = now
      return true
    },
    async saveAnswer(userId, text) {
      if (state.answers.length) return false
      state.answers.push({ userId, text, tag: 'sobras', channel: 'whatsapp' })
      return true
    },
  }
  return { state, store }
}

describe('the question text', () => {
  it('is Miguel’s, word for word', () => {
    expect(LEFTOVERS_QUESTION).toBe(
      'Una pregunta rápida para Mimoia: ¿os sobró algo de la última cena que hicisteis en casa? Y si sobró, ¿qué hicisteis con ello: táper para el día siguiente, al congelador, se lo comió alguien o acabó tirándose? Contesta como te salga: nos ayuda a decidir si te pregunto por las sobras.',
    )
  })
})

describe('shouldAskLeftovers', () => {
  const base = { askedAt: null, linked: true, lastInboundAt: new Date(NOW.getTime() - 60_000), now: NOW }

  it('asks a linked user inside the 24 h window, once', () => {
    expect(shouldAskLeftovers(base)).toBe(true)
    expect(shouldAskLeftovers({ ...base, askedAt: new Date('2026-10-21T10:00:00Z') })).toBe(false)
  })

  it('only inside the 24 h window (with its safety margin), and only with WhatsApp linked', () => {
    expect(shouldAskLeftovers({ ...base, lastInboundAt: new Date(NOW.getTime() - 23 * HOUR) })).toBe(true)
    expect(shouldAskLeftovers({ ...base, lastInboundAt: new Date(NOW.getTime() - 24 * HOUR) })).toBe(false)
    expect(shouldAskLeftovers({ ...base, lastInboundAt: null })).toBe(false)
    expect(shouldAskLeftovers({ ...base, linked: false })).toBe(false)
  })

  it('is off from 2026-11-08 (Madrid)', () => {
    // 2026-11-08 00:00 in Madrid is 2026-11-07 23:00 UTC.
    const at = (iso: string) => ({ ...base, now: new Date(iso), lastInboundAt: new Date(new Date(iso).getTime() - 60_000) })
    expect(shouldAskLeftovers(at('2026-11-07T22:59:00Z'))).toBe(true)
    expect(shouldAskLeftovers(at('2026-11-07T23:00:00Z'))).toBe(false)
    expect(shouldAskLeftovers(at('2026-11-20T10:00:00Z'))).toBe(false)
  })
})

describe('maybeLeftoversQuestion', () => {
  it('due after a WhatsApp reply, once per user (19-nov: as a message of its own)', async () => {
    const { store, state } = memoryStore()
    const first = await maybeLeftoversQuestion('u1', { mode: 'whatsapp', otherOffer: false, store, now: NOW })
    expect(first).toBe(LEFTOVERS_QUESTION)
    expect(state.askedAt).toEqual(NOW)
    const second = await maybeLeftoversQuestion('u1', { mode: 'whatsapp', otherOffer: false, store, now: new Date(NOW.getTime() + HOUR) })
    expect(second).toBeNull()
  })

  it('never in the web chat, during the first steps, with another offer or outside the window', async () => {
    for (const opts of [
      { mode: 'text', otherOffer: false },
      { mode: 'whatsapp', otherOffer: false, onboarding: true },
      { mode: 'whatsapp', otherOffer: true },
    ]) {
      const { store, state } = memoryStore()
      expect(await maybeLeftoversQuestion('u1', { ...opts, store, now: NOW })).toBeNull()
      expect(state.askedAt).toBeNull()
    }
    const late = memoryStore({ lastInboundAt: new Date(NOW.getTime() - 25 * HOUR) })
    expect(await maybeLeftoversQuestion('u1', { mode: 'whatsapp', otherOffer: false, store: late.store, now: NOW })).toBeNull()
    expect(late.state.askedAt).toBeNull()
  })

  it('a failing store asks nothing', async () => {
    const store = { load: async () => { throw new Error('db down') } } as unknown as LeftoversQuestionStore
    expect(await maybeLeftoversQuestion('u1', { mode: 'whatsapp', otherOffer: false, store, now: NOW })).toBeNull()
  })
})

describe('appendReplyOffers: one offer per reply', () => {
  const steps = (store: LeftoversQuestionStore, over: Partial<ReplyOfferSteps> = {}): ReplyOfferSteps => ({
    family: async (_u, reply) => reply,
    invite: async (_u, reply) => reply,
    leftovers: (u, opts) => maybeLeftoversQuestion(u, { ...opts, store, now: NOW }),
    seanEllis: async () => null,
    ...over,
  })

  it('with no other offer due, the leftovers question goes apart from the reply (WhatsApp) and counts as the turn’s offer', async () => {
    const { store } = memoryStore()
    const r = await appendReplyOffers('u1', 'Hecho.', { mode: 'whatsapp', invite: true }, steps(store))
    // 19-nov: never stuck to the reply — it goes as a message of its own.
    expect(r).toEqual({ message: 'Hecho.', offerAdded: true, survey: LEFTOVERS_QUESTION })
  })

  it('never together with the family offer or the invite to another household; it waits for a later reply', async () => {
    const { store, state } = memoryStore()
    const family = await appendReplyOffers('u1', 'Hecho.', { mode: 'whatsapp', invite: true }, steps(store, { family: async (_u, r) => `${r}\n\nFAMILIA` }))
    expect(family).toEqual({ message: 'Hecho.\n\nFAMILIA', offerAdded: true, survey: null })
    const invite = await appendReplyOffers('u1', 'Hecho.', { mode: 'whatsapp', invite: true }, steps(store, { invite: async (_u, r) => `${r}\n\nINVITA` }))
    expect(invite).toEqual({ message: 'Hecho.\n\nINVITA', offerAdded: true, survey: null })
    expect(state.askedAt).toBeNull()
    const later = await appendReplyOffers('u1', 'Hecho.', { mode: 'whatsapp', invite: true }, steps(store))
    expect(later).toEqual({ message: 'Hecho.', offerAdded: true, survey: LEFTOVERS_QUESTION })
  })

  it('at most one survey a week per household (19-nov)', async () => {
    const { store, state } = memoryStore()
    const r = await appendReplyOffers('u1', 'Hecho.', { mode: 'whatsapp', invite: true }, steps(store, { surveyedThisWeek: async () => true }))
    expect(r).toEqual({ message: 'Hecho.', offerAdded: false, survey: null })
    expect(state.askedAt).toBeNull()
  })

  it('in the web chat nothing is added', async () => {
    const { store } = memoryStore()
    expect(await appendReplyOffers('u1', 'Hecho.', { mode: 'text', invite: true }, steps(store))).toEqual({ message: 'Hecho.', offerAdded: false, survey: null })
  })
})
