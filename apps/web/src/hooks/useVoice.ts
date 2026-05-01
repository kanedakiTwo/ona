'use client'

import { useState, useRef, useCallback, useEffect } from 'react'

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
  speak: (text: string) => void
  stopSpeaking: () => void
  ttsSupported: boolean
}

/**
 * Hook for voice input (speech-to-text) and voice output (text-to-speech).
 * Uses native Web Speech API — no external dependencies.
 */
export function useVoice(options: UseVoiceOptions = {}): UseVoiceReturn {
  const { lang = 'es-ES', onTranscript } = options

  const [isListening, setIsListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [isSpeaking, setIsSpeaking] = useState(false)

  const recognitionRef = useRef<any>(null)
  const synthRef = useRef<SpeechSynthesis | null>(null)

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

  const speak = useCallback((text: string) => {
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

  const stopSpeaking = useCallback(() => {
    if (synthRef.current) {
      synthRef.current.cancel()
      setIsSpeaking(false)
    }
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) recognitionRef.current.abort()
      if (synthRef.current) synthRef.current.cancel()
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
    ttsSupported,
  }
}
