/**
 * PRO-1315 (D-164): the one place the API makes an Anthropic client for its
 * one-off calls (fridge photo, restrictions, taste, menu fit, ficha
 * correction, WhatsApp guided texts…).
 *
 * In staging with «Mimo remoto» (`MIMO_REMOTO=1`, PRO-1102; never in
 * production) no client is made: the request goes, as is, to the office's
 * queue (`mimo_turnos_remotos`) and the office answers it with the
 * subscription. No `usage` comes back, so nothing goes to `cost_events`.
 * No answer in time → the call throws, as when Anthropic fails, and each
 * caller keeps its usual fallback (its own timeout, when shorter, wins).
 *
 * The jobs without a user (catalogue labels and photos, the daily review,
 * the ficha's nightly and weekly passes) don't run at all with the mode on:
 * `aiJobsWithoutUserAllowed()`.
 */
import Anthropic from '@anthropic-ai/sdk'
import { env } from '../config/env.js'
import { db } from '../db/connection.js'
import { dbTurnStore, remoteMessagesClient } from './assistant/mimoRemoto.js'

/** With «Mimo remoto», how long a one-off call waits for the office before its fallback. */
export const REMOTE_ONE_OFF_WAIT_MS = 90_000

/**
 * An Anthropic client, or the office's queue with the same `messages.create`
 * when `MIMO_REMOTO=1`. Only `messages.create` works on the queue (no
 * batches, no streaming).
 */
export function anthropicClient(): Anthropic {
  if (env.MIMO_REMOTO) return remoteMessagesClient(dbTurnStore(db), { timeoutMs: REMOTE_ONE_OFF_WAIT_MS }) as unknown as Anthropic
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
}

/** False in staging with «Mimo remoto»: the AI jobs without a user don't run. */
export function aiJobsWithoutUserAllowed(): boolean {
  return !env.MIMO_REMOTO
}
