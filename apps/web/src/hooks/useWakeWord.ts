'use client'

import { useEffect, useRef, useState } from 'react'

export type WakeWordEngine = 'porcupine' | 'openwakeword' | 'none'

interface UseWakeWordOptions {
  enabled: boolean
  onDetected: () => void
  engine?: WakeWordEngine
  keywordPath?: string
  accessKey?: string
}

interface UseWakeWordReturn {
  isListening: boolean
  isSupported: boolean
  error: string | null
  engine: WakeWordEngine
}

const PORCUPINE_KEYWORD = '/wakewords/hola-ona_es_wasm_v4_0_0.ppn'
const PORCUPINE_PARAMS = '/wakewords/porcupine_params_es.pv'

const OPENWAKEWORD_MELSPEC = '/wakewords/openwakeword/melspectrogram.onnx'
const OPENWAKEWORD_EMBEDDING = '/wakewords/openwakeword/embedding_model.onnx'
const OPENWAKEWORD_MODEL = '/wakewords/openwakeword/hola_ona.onnx'

function pickEngine(explicit: WakeWordEngine | undefined): WakeWordEngine {
  if (explicit) return explicit
  const envEngine = (process.env.NEXT_PUBLIC_WAKE_WORD_ENGINE as WakeWordEngine | undefined) ?? undefined
  if (envEngine === 'porcupine' || envEngine === 'openwakeword' || envEngine === 'none') {
    return envEngine
  }
  if (process.env.NEXT_PUBLIC_PICOVOICE_ACCESS_KEY) return 'porcupine'
  return 'openwakeword'
}

/**
 * Wake-word detector. Two backends are supported; the active one is chosen
 * via the `engine` prop or the `NEXT_PUBLIC_WAKE_WORD_ENGINE` env var.
 *
 * - `porcupine`: Picovoice Porcupine WASM (free tier expired; paid plan needed).
 * - `openwakeword`: open-source ONNX models, custom-trained "Hola Ona".
 * - `none`: detection disabled; manual entry (FAB) only.
 */
export function useWakeWord(options: UseWakeWordOptions): UseWakeWordReturn {
  const engine = pickEngine(options.engine)
  const { enabled, onDetected } = options
  const onDetectedRef = useRef(onDetected)
  onDetectedRef.current = onDetected

  const [isListening, setIsListening] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isSupported =
    typeof window !== 'undefined' && 'AudioContext' in window && 'WebAssembly' in window

  useEffect(() => {
    if (!enabled || !isSupported || engine === 'none') {
      setIsListening(false)
      setError(null)
      return
    }

    let cancelled = false
    let stop: (() => Promise<void> | void) | null = null

    async function start() {
      try {
        if (engine === 'porcupine') {
          stop = await startPorcupine({
            accessKey: options.accessKey ?? process.env.NEXT_PUBLIC_PICOVOICE_ACCESS_KEY ?? '',
            keywordPath: options.keywordPath ?? PORCUPINE_KEYWORD,
            paramsPath: PORCUPINE_PARAMS,
            onDetected: () => onDetectedRef.current(),
          })
        } else {
          stop = await startOpenWakeWord({
            melspecPath: OPENWAKEWORD_MELSPEC,
            embeddingPath: OPENWAKEWORD_EMBEDDING,
            modelPath: options.keywordPath ?? OPENWAKEWORD_MODEL,
            onDetected: () => onDetectedRef.current(),
          })
        }
        if (cancelled) {
          await stop?.()
          stop = null
          return
        }
        setIsListening(true)
        setError(null)
      } catch (err: any) {
        if (cancelled) return
        const msg = err?.message || 'No se pudo iniciar la deteccion de voz.'
        setError(msg)
        setIsListening(false)
      }
    }

    start()

    return () => {
      cancelled = true
      setIsListening(false)
      const local = stop
      stop = null
      if (local) Promise.resolve(local()).catch(() => {})
    }
  }, [enabled, isSupported, engine, options.accessKey, options.keywordPath])

  return { isListening, isSupported, error, engine }
}

/* ── Porcupine ─────────────────────────────────────────────────── */

async function startPorcupine(args: {
  accessKey: string
  keywordPath: string
  paramsPath: string
  onDetected: () => void
}): Promise<() => Promise<void>> {
  if (!args.accessKey) {
    throw new Error('Falta NEXT_PUBLIC_PICOVOICE_ACCESS_KEY')
  }
  const { PorcupineWorker } = await import('@picovoice/porcupine-web')
  const { WebVoiceProcessor } = await import('@picovoice/web-voice-processor')

  const porcupine = await PorcupineWorker.create(
    args.accessKey,
    [{ publicPath: args.keywordPath, label: 'hola-ona' }],
    (detection: { label: string }) => {
      if (detection?.label === 'hola-ona') args.onDetected()
    },
    { publicPath: args.paramsPath },
  )
  await WebVoiceProcessor.subscribe(porcupine)

  return async () => {
    try {
      await WebVoiceProcessor.unsubscribe(porcupine)
    } catch {}
    try {
      porcupine.terminate?.()
    } catch {}
  }
}

/* ── openWakeWord ──────────────────────────────────────────────── */

async function startOpenWakeWord(args: {
  melspecPath: string
  embeddingPath: string
  modelPath: string
  onDetected: () => void
}): Promise<() => Promise<void>> {
  const { startOpenWakeWordSession } = await import('@/lib/wakeword/openWakeWord')
  return startOpenWakeWordSession(args)
}
