'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Records what the user says for Mimo (D-023): starts on demand, stops by
 * itself after a short silence once speech has started, and gives up if
 * nobody speaks. The blob goes to `POST /stt`.
 */

export interface RecorderOptions {
  /** Silence after speech that ends the turn. */
  silenceMs?: number
  /** Nobody spoke within this time → null. */
  noSpeechMs?: number
  /** Hard cap on one turn. */
  maxMs?: number
}

/** RMS above this counts as voice (0–1 scale, after the browser's noise suppression). */
const SPEECH_RMS = 0.025

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) {
    if (MediaRecorder.isTypeSupported?.(t)) return t
  }
  return undefined
}

export function recorderSupported(): boolean {
  return typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
}

export function useRecorder(opts: RecorderOptions = {}) {
  const { silenceMs = 1300, noSpeechMs = 8000, maxMs = 30_000 } = opts
  const [recording, setRecording] = useState(false)
  /** 0–1, for the listening animation. */
  const [level, setLevel] = useState(0)
  const stopRef = useRef<((keep: boolean) => void) | null>(null)

  const start = useCallback((): Promise<Blob | null> => {
    if (stopRef.current) stopRef.current(false)
    return new Promise<Blob | null>((resolve) => {
      let finished = false
      let stream: MediaStream | null = null
      let ctx: AudioContext | null = null
      let timer: ReturnType<typeof setInterval> | null = null
      let recorder: MediaRecorder | null = null
      const chunks: BlobPart[] = []
      let heardSpeech = false

      const finish = (keep: boolean) => {
        if (finished) return
        finished = true
        stopRef.current = null
        if (timer) clearInterval(timer)
        setRecording(false)
        setLevel(0)
        const done = () => {
          stream?.getTracks().forEach((t) => t.stop())
          ctx?.close().catch(() => {})
          resolve(keep && heardSpeech && chunks.length ? new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' }) : null)
        }
        if (recorder && recorder.state !== 'inactive') {
          recorder.onstop = done
          recorder.stop()
        } else done()
      }
      stopRef.current = finish

      navigator.mediaDevices
        .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
        .then((s) => {
          if (finished) {
            s.getTracks().forEach((t) => t.stop())
            return
          }
          stream = s
          const mimeType = pickMimeType()
          recorder = new MediaRecorder(s, mimeType ? { mimeType } : undefined)
          recorder.ondataavailable = (e) => {
            if (e.data.size) chunks.push(e.data)
          }
          recorder.start(250)
          setRecording(true)

          ctx = new AudioContext()
          const analyser = ctx.createAnalyser()
          analyser.fftSize = 1024
          ctx.createMediaStreamSource(s).connect(analyser)
          const buf = new Float32Array(analyser.fftSize)
          const startedAt = Date.now()
          let lastVoiceAt = 0
          timer = setInterval(() => {
            analyser.getFloatTimeDomainData(buf)
            let sum = 0
            for (const v of buf) sum += v * v
            const rms = Math.sqrt(sum / buf.length)
            setLevel(Math.min(1, rms * 12))
            const now = Date.now()
            if (rms > SPEECH_RMS) {
              heardSpeech = true
              lastVoiceAt = now
            }
            if (heardSpeech && now - lastVoiceAt > silenceMs) finish(true)
            else if (!heardSpeech && now - startedAt > noSpeechMs) finish(false)
            else if (now - startedAt > maxMs) finish(true)
          }, 100)
        })
        .catch(() => finish(false))
    })
  }, [silenceMs, noSpeechMs, maxMs])

  /** Stop now and keep what was said. */
  const stop = useCallback(() => stopRef.current?.(true), [])
  /** Stop now and throw it away. */
  const cancel = useCallback(() => stopRef.current?.(false), [])

  useEffect(() => () => stopRef.current?.(false), [])

  return { recording, level, start, stop, cancel }
}
