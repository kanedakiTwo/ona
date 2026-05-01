'use client'

import { useEffect, useRef, useState } from 'react'

interface UseWakeWordOptions {
  enabled: boolean
  onDetected: () => void
  keywordPath?: string
  accessKey?: string
}

interface UseWakeWordReturn {
  isListening: boolean
  isSupported: boolean
  error: string | null
}

const DEFAULT_KEYWORD_PATH = '/wakewords/hola-ona_es_wasm_v3_0_0.ppn'
const SPANISH_MODEL_PATH = '/wakewords/porcupine_params_es.pv'

/**
 * Wake-word detector using Picovoice Porcupine WASM.
 * Wraps the engine so the rest of the app stays agnostic to the provider —
 * swapping to openWakeWord (open source) only touches this file.
 */
export function useWakeWord(options: UseWakeWordOptions): UseWakeWordReturn {
  const { enabled, onDetected, keywordPath = DEFAULT_KEYWORD_PATH } = options
  const accessKey = options.accessKey ?? process.env.NEXT_PUBLIC_PICOVOICE_ACCESS_KEY ?? ''

  const [isListening, setIsListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const onDetectedRef = useRef(onDetected)
  onDetectedRef.current = onDetected

  const isSupported = typeof window !== 'undefined' && 'AudioContext' in window && 'WebAssembly' in window

  useEffect(() => {
    if (!enabled || !isSupported) {
      setIsListening(false)
      return
    }

    if (!accessKey) {
      setError('Falta NEXT_PUBLIC_PICOVOICE_ACCESS_KEY')
      return
    }

    let cancelled = false
    let porcupine: any = null
    let processor: any = null

    async function start() {
      try {
        const { PorcupineWorker } = await import('@picovoice/porcupine-web')
        const { WebVoiceProcessor } = await import('@picovoice/web-voice-processor')

        porcupine = await PorcupineWorker.create(
          accessKey,
          [{ publicPath: keywordPath, label: 'hola-ona' }],
          (detection: { label: string }) => {
            if (!cancelled && detection?.label === 'hola-ona') {
              onDetectedRef.current()
            }
          },
          { publicPath: SPANISH_MODEL_PATH },
        )

        if (cancelled) {
          porcupine.terminate?.()
          return
        }

        processor = WebVoiceProcessor
        await processor.subscribe(porcupine)

        if (!cancelled) {
          setIsListening(true)
          setError(null)
        }
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
      ;(async () => {
        try {
          if (processor && porcupine) await processor.unsubscribe(porcupine)
        } catch {}
        try {
          porcupine?.terminate?.()
        } catch {}
      })()
    }
  }, [enabled, isSupported, accessKey, keywordPath])

  return { isListening, isSupported, error }
}
