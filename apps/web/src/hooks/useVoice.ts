'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { api } from '@/lib/api'

/** Voices the API can read with (ElevenLabs); empty = browser voice only. */
export interface ServerVoice {
  key: string
  name: string
}
interface ServerVoices {
  enabled: boolean
  voices: ServerVoice[]
  defaultVoice: string | null
}

const VOICE_STORAGE_KEY = 'mimo-tts-voice'

function readStoredVoice(): string | null {
  try {
    return localStorage.getItem(VOICE_STORAGE_KEY)
  } catch {
    return null
  }
}

interface UseVoiceOptions {
  lang?: string
  onTranscript?: (text: string) => void
  autoSpeak?: boolean
}

interface UseVoiceReturn {
  // STT
  isListening: boolean
  startListening: () => void
  stopListening: () => void
  transcript: string
  sttSupported: boolean
  // TTS
  isSpeaking: boolean
  /** `voiceKey` overrides the selected voice (to preview one right after picking it). */
  speak: (text: string, voiceKey?: string) => void
  stopSpeaking: () => void
  ttsSupported: boolean
  /** 'elevenlabs' when the API reads replies aloud; 'browser' = the built-in voice. */
  ttsEngine: 'elevenlabs' | 'browser'
  voices: ServerVoice[]
  selectedVoice: string | null
  setVoice: (key: string) => void
}

/**
 * Hook for voice input (speech-to-text) and voice output (text-to-speech).
 * Input uses the Web Speech API. Output uses the API's ElevenLabs voice
 * (`POST /tts`) when it is configured, else — or if it fails — the browser's
 * built-in voice, which sounds robotic (specs/advisor.md → Voice).
 */
export function useVoice(options: UseVoiceOptions = {}): UseVoiceReturn {
  const { lang = 'es-ES', onTranscript } = options

  const [isListening, setIsListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [isSpeaking, setIsSpeaking] = useState(false)

  const recognitionRef = useRef<any>(null)
  const synthRef = useRef<SpeechSynthesis | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const speakSeq = useRef(0)
  const [server, setServer] = useState<ServerVoices>({ enabled: false, voices: [], defaultVoice: null })
  const [selectedVoice, setSelectedVoice] = useState<string | null>(null)

  // Server voices (ElevenLabs), once per mount. Any error → browser voice.
  useEffect(() => {
    let alive = true
    let token: string | null = null
    try {
      token = localStorage.getItem('ona_token')
    } catch {}
    if (!token) return
    api
      .get<ServerVoices>('/tts/voices')
      .then((v) => {
        if (!alive || !v?.enabled || !v.voices?.length) return
        setServer(v)
        const stored = readStoredVoice()
        setSelectedVoice(v.voices.some((x) => x.key === stored) ? stored : v.defaultVoice ?? v.voices[0].key)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const setVoice = useCallback((key: string) => {
    setSelectedVoice(key)
    try {
      localStorage.setItem(VOICE_STORAGE_KEY, key)
    } catch {}
  }, [])

  // Check browser support
  const sttSupported = typeof window !== 'undefined' && (
    'SpeechRecognition' in window || 'webkitSpeechRecognition' in window
  )
  const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window

  // Initialize TTS
  useEffect(() => {
    if (ttsSupported) {
      synthRef.current = window.speechSynthesis
    }
  }, [ttsSupported])

  // ── Speech-to-Text ─────────────────────────

  const startListening = useCallback(() => {
    if (!sttSupported || isListening) return

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    const recognition = new SpeechRecognition()

    recognition.lang = lang
    recognition.continuous = false
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    recognition.onstart = () => {
      setIsListening(true)
      setTranscript('')
    }

    recognition.onresult = (event: any) => {
      let finalTranscript = ''
      let interimTranscript = ''

      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) {
          finalTranscript += result[0].transcript
        } else {
          interimTranscript += result[0].transcript
        }
      }

      const text = finalTranscript || interimTranscript
      setTranscript(text)

      if (finalTranscript && onTranscript) {
        onTranscript(finalTranscript)
      }
    }

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error)
      setIsListening(false)
    }

    recognition.onend = () => {
      setIsListening(false)
    }

    recognitionRef.current = recognition
    recognition.start()
  }, [sttSupported, isListening, lang, onTranscript])

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop()
    }
  }, [])

  // ── Text-to-Speech ─────────────────────────

  const speakWithBrowser = useCallback((text: string) => {
    if (!ttsSupported || !synthRef.current) return

    // Cancel any ongoing speech
    synthRef.current.cancel()

    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = lang
    utterance.rate = 1.0
    utterance.pitch = 1.0

    // Try to find a Spanish voice
    const voices = synthRef.current.getVoices()
    const spanishVoice = voices.find(v => v.lang.startsWith('es'))
    if (spanishVoice) {
      utterance.voice = spanishVoice
    }

    utterance.onstart = () => setIsSpeaking(true)
    utterance.onend = () => setIsSpeaking(false)
    utterance.onerror = () => setIsSpeaking(false)

    synthRef.current.speak(utterance)
  }, [ttsSupported, lang])

  const stopAudio = useCallback(() => {
    const a = audioRef.current
    if (a) {
      a.pause()
      if (a.src.startsWith('blob:')) URL.revokeObjectURL(a.src)
      audioRef.current = null
    }
  }, [])

  const speak = useCallback(
    (text: string, voiceKey?: string) => {
      if (!server.enabled) return speakWithBrowser(text)
      const seq = ++speakSeq.current
      stopAudio()
      synthRef.current?.cancel()
      setIsSpeaking(true)
      api
        .audio('/tts', { text, voice: voiceKey ?? selectedVoice ?? undefined })
        .then((blob) => {
          if (seq !== speakSeq.current) return // a newer reply took over
          if (!blob) {
            setIsSpeaking(false)
            return
          }
          const audio = new Audio(URL.createObjectURL(blob))
          audioRef.current = audio
          audio.onended = () => {
            if (audioRef.current === audio) stopAudio()
            setIsSpeaking(false)
          }
          audio.onerror = () => setIsSpeaking(false)
          return audio.play()
        })
        .catch(() => {
          if (seq !== speakSeq.current) return
          setIsSpeaking(false)
          speakWithBrowser(text)
        })
    },
    [server.enabled, selectedVoice, speakWithBrowser, stopAudio],
  )

  const stopSpeaking = useCallback(() => {
    speakSeq.current++
    stopAudio()
    if (synthRef.current) synthRef.current.cancel()
    setIsSpeaking(false)
  }, [stopAudio])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) recognitionRef.current.abort()
      if (synthRef.current) synthRef.current.cancel()
      if (audioRef.current) audioRef.current.pause()
    }
  }, [])

  return {
    isListening,
    startListening,
    stopListening,
    transcript,
    sttSupported,
    isSpeaking,
    speak,
    stopSpeaking,
    ttsEngine: server.enabled ? 'elevenlabs' : 'browser',
    voices: server.voices,
    selectedVoice,
    setVoice,
    ttsSupported: ttsSupported || server.enabled,
  }
}
