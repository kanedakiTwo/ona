/**
 * PRO-05: OpenAI switches off `gpt-realtime` on 2027-01-20 and `whisper-1`
 * on 2027-02-26. The voice session's models must come from env so the move
 * to `gpt-realtime-2.1-mini` / `gpt-transcribe` is configuration only (staging
 * first, production after Miguel listens to it).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

async function loadBody() {
  vi.resetModules()
  const { realtimeSessionBody } = await import('../routes/realtime.js')
  return realtimeSessionBody('instr', [])
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('realtime session models', () => {
  it('reads the realtime and transcription models from env', async () => {
    vi.stubEnv('OPENAI_REALTIME_MODEL', 'gpt-realtime-2.1-mini')
    vi.stubEnv('OPENAI_REALTIME_TRANSCRIBE_MODEL', 'gpt-transcribe')
    const body = await loadBody()
    expect(body.session.model).toBe('gpt-realtime-2.1-mini')
    expect(body.session.audio.input.transcription.model).toBe('gpt-transcribe')
  })

  it('keeps today\'s models when the variables are unset (production until Miguel says go)', async () => {
    vi.stubEnv('OPENAI_REALTIME_MODEL', '')
    vi.stubEnv('OPENAI_REALTIME_TRANSCRIBE_MODEL', '')
    const body = await loadBody()
    expect(body.session.model).toBe('gpt-realtime')
    expect(body.session.audio.input.transcription.model).toBe('whisper-1')
  })

  it('prices the successor models in the cost ledger', async () => {
    const { priceFor } = await import('../config/pricing.js')
    expect(priceFor('openai', 'gpt-realtime-2.1-mini')).toBeTruthy()
    expect(priceFor('openai', 'gpt-transcribe')).toBeTruthy()
  })
})
