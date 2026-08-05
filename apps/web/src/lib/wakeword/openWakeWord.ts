/**
 * openWakeWord browser runtime.
 *
 * Replicates the streaming inference pipeline of dscripka/openWakeWord
 * (Apache-2.0) on top of onnxruntime-web:
 *
 *   1. Audio is captured at 16 kHz mono via an AudioWorklet that buffers
 *      80 ms (1280 sample) chunks and forwards them to the main thread.
 *   2. The melspectrogram ONNX model converts a rolling audio window
 *      (~775 ms) into mel features (32-bin frames, 10 ms hop). Each chunk
 *      yields 8 new mel frames.
 *   3. The embedding ONNX model consumes the last 76 mel frames and emits
 *      a 96-dim feature vector once per chunk.
 *   4. The wake-word ONNX model consumes the last 16 embeddings and emits
 *      a single score in [0, 1].
 *   5. If the smoothed score crosses a threshold for several consecutive
 *      frames, `onDetected` fires (with a refractory cooldown).
 *
 * Three ONNX files are loaded from `/wakewords/openwakeword/`:
 *   - `melspectrogram.onnx`   (shared, generic mel front-end)
 *   - `embedding_model.onnx`  (shared, generic embedder)
 *   - `hola_ona.onnx`         (wake-word classifier, trained separately)
 *
 * Train your own wake-word model via `docs/voice-mode-openwakeword-training.md`.
 */

import type { InferenceSession, Tensor } from 'onnxruntime-web'

const SAMPLE_RATE = 16_000
const CHUNK_SAMPLES = 1280
const MEL_BINS = 32
const MEL_FRAMES_PER_CHUNK = 8
const MEL_WINDOW_FRAMES = 76
const EMBEDDING_DIM = 96
const EMBEDDING_WINDOW = 16
const AUDIO_WINDOW_SAMPLES = 12_560 // empirically yields exactly 76 mel frames
const SCORE_THRESHOLD = 0.5
const SUSTAIN_FRAMES = 3
const COOLDOWN_MS = 1500

interface Args {
  melspecPath: string
  embeddingPath: string
  modelPath: string
  onDetected: () => void
}

export async function startOpenWakeWordSession(args: Args): Promise<() => Promise<void>> {
  const ort = await import('onnxruntime-web')
  ort.env.wasm.numThreads = 1
  ort.env.wasm.proxy = false

  const [melSession, embSession, wwSession] = await Promise.all([
    ort.InferenceSession.create(args.melspecPath, { executionProviders: ['wasm'] }),
    ort.InferenceSession.create(args.embeddingPath, { executionProviders: ['wasm'] }),
    ort.InferenceSession.create(args.modelPath, { executionProviders: ['wasm'] }),
  ])

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  })

  // Some browsers ignore `sampleRate` and use the device rate. We
  // request 16 kHz; if the actual rate differs the worklet can still
  // forward frames, but melspec accuracy will suffer. The audio path
  // is also exposed via `audioContext.sampleRate` so the operator can
  // diagnose this via the [voice] console logs.
  const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE })
  if (audioContext.sampleRate !== SAMPLE_RATE) {
    console.warn(
      `[voice] AudioContext sampleRate is ${audioContext.sampleRate}, openWakeWord expects ${SAMPLE_RATE}. Detection accuracy will degrade.`,
    )
  }
  await audioContext.audioWorklet.addModule('/wakeword-capture-worklet.js')

  const source = audioContext.createMediaStreamSource(stream)
  const worklet = new AudioWorkletNode(audioContext, 'wakeword-capture')

  const buffers: Buffers = {
    audio: new Float32Array(AUDIO_WINDOW_SAMPLES),
    audioWritten: 0,
    mel: new Float32Array(MEL_WINDOW_FRAMES * MEL_BINS),
    melFrames: 0,
    embeddings: new Float32Array(EMBEDDING_WINDOW * EMBEDDING_DIM),
    embeddingCount: 0,
    sustain: 0,
    lastTriggerAt: 0,
  }

  let processing = false
  let pendingChunks: Float32Array[] = []
  let cancelled = false

  worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
    pendingChunks.push(event.data)
    if (!processing) {
      processing = true
      void runQueue()
    }
  }

  async function runQueue() {
    try {
      while (pendingChunks.length > 0 && !cancelled) {
        const chunk = pendingChunks.shift()!
        await processChunk({
          ort,
          melSession,
          embSession,
          wwSession,
          chunk,
          buffers,
          onDetected: args.onDetected,
        })
      }
    } catch (err) {
      console.error('[voice] openWakeWord inference error', err)
    } finally {
      processing = false
    }
  }

  source.connect(worklet)
  // Worklet is a leaf — don't connect to destination (avoids feedback).

  return async () => {
    cancelled = true
    pendingChunks = []
    try { source.disconnect() } catch {}
    try { worklet.disconnect() } catch {}
    try { worklet.port.close() } catch {}
    try { stream.getTracks().forEach((t) => t.stop()) } catch {}
    try { await audioContext.close() } catch {}
    try { await melSession.release() } catch {}
    try { await embSession.release() } catch {}
    try { await wwSession.release() } catch {}
  }
}

/* ── streaming inference ───────────────────────────────────────── */

interface Buffers {
  audio: Float32Array
  audioWritten: number
  mel: Float32Array
  melFrames: number
  embeddings: Float32Array
  embeddingCount: number
  sustain: number
  lastTriggerAt: number
}

async function processChunk(ctx: {
  ort: typeof import('onnxruntime-web')
  melSession: InferenceSession
  embSession: InferenceSession
  wwSession: InferenceSession
  chunk: Float32Array
  buffers: Buffers
  onDetected: () => void
}): Promise<void> {
  const { ort, melSession, embSession, wwSession, chunk, buffers, onDetected } = ctx

  appendAudio(buffers, chunk)
  if (buffers.audioWritten < AUDIO_WINDOW_SAMPLES) return

  const melInput = new ort.Tensor('float32', buffers.audio.slice(0), [1, AUDIO_WINDOW_SAMPLES])
  const melResult = await runFirstOutput(melSession, melInput)
  const newMel = extractMelTail(melResult, MEL_FRAMES_PER_CHUNK, MEL_BINS)
  if (!newMel) return
  pushMel(buffers, newMel)
  if (buffers.melFrames < MEL_WINDOW_FRAMES) return

  const embInput = new ort.Tensor(
    'float32',
    buffers.mel.slice(0),
    [1, MEL_WINDOW_FRAMES, MEL_BINS, 1],
  )
  const embResult = await runFirstOutput(embSession, embInput)
  const newEmbedding = extractEmbedding(embResult, EMBEDDING_DIM)
  if (!newEmbedding) return
  pushEmbedding(buffers, newEmbedding)
  if (buffers.embeddingCount < EMBEDDING_WINDOW) return

  const wwInput = new ort.Tensor(
    'float32',
    buffers.embeddings.slice(0),
    [1, EMBEDDING_WINDOW, EMBEDDING_DIM],
  )
  const wwResult = await runFirstOutput(wwSession, wwInput)
  const data = wwResult.data as Float32Array
  const score = data[data.length - 1] ?? 0

  if (score >= SCORE_THRESHOLD) {
    buffers.sustain += 1
    if (
      buffers.sustain >= SUSTAIN_FRAMES &&
      Date.now() - buffers.lastTriggerAt > COOLDOWN_MS
    ) {
      buffers.lastTriggerAt = Date.now()
      buffers.sustain = 0
      onDetected()
    }
  } else {
    buffers.sustain = 0
  }
}

async function runFirstOutput(session: InferenceSession, input: Tensor): Promise<Tensor> {
  const feeds: Record<string, Tensor> = {}
  feeds[session.inputNames[0]] = input
  const out = await session.run(feeds)
  return out[session.outputNames[0]] as Tensor
}

function appendAudio(buffers: Buffers, chunk: Float32Array): void {
  const totalLen = buffers.audio.length
  if (chunk.length >= totalLen) {
    buffers.audio.set(chunk.subarray(chunk.length - totalLen))
    buffers.audioWritten = totalLen
    return
  }
  const shift = chunk.length
  if (buffers.audioWritten + shift > totalLen) {
    buffers.audio.copyWithin(0, shift)
    buffers.audioWritten = totalLen - shift
  }
  buffers.audio.set(chunk, buffers.audioWritten)
  buffers.audioWritten += shift
}

function extractMelTail(tensor: Tensor, frames: number, bins: number): Float32Array | null {
  const data = tensor.data as Float32Array
  if (data.length < frames * bins) return null
  const out = new Float32Array(frames * bins)
  const start = data.length - frames * bins
  for (let i = 0; i < out.length; i++) {
    out[i] = data[start + i] / 10 + 2
  }
  return out
}

function pushMel(buffers: Buffers, frames: Float32Array): void {
  const totalSlots = MEL_WINDOW_FRAMES * MEL_BINS
  const incoming = frames.length
  if (incoming >= totalSlots) {
    buffers.mel.set(frames.subarray(incoming - totalSlots))
    buffers.melFrames = MEL_WINDOW_FRAMES
    return
  }
  buffers.mel.copyWithin(0, incoming)
  buffers.mel.set(frames, totalSlots - incoming)
  buffers.melFrames = Math.min(MEL_WINDOW_FRAMES, buffers.melFrames + incoming / MEL_BINS)
}

function extractEmbedding(tensor: Tensor, dim: number): Float32Array | null {
  const data = tensor.data as Float32Array
  if (data.length < dim) return null
  return data.slice(data.length - dim)
}

function pushEmbedding(buffers: Buffers, vec: Float32Array): void {
  const totalSlots = EMBEDDING_WINDOW * EMBEDDING_DIM
  buffers.embeddings.copyWithin(0, EMBEDDING_DIM)
  buffers.embeddings.set(vec, totalSlots - EMBEDDING_DIM)
  if (buffers.embeddingCount < EMBEDDING_WINDOW) buffers.embeddingCount += 1
}
