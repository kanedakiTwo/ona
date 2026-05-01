'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Send, Mic, MicOff, Volume2, VolumeX } from 'lucide-react'
import { api } from '@/lib/api'
import { useVoice } from '@/hooks/useVoice'
import { consumeVoiceTurns, subscribeVoiceTurns } from '@/lib/voiceMessages'
import { useVoiceMode } from '@/components/voice/VoiceProvider'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  skillUsed?: string
  uiHint?: string
  data?: any
}

interface AdvisorChatProps {
  userId: string
}

const EXAMPLE_PROMPTS = [
  'Que toca cocinar hoy?',
  'Quiero crear una receta nueva',
  'No tengo mantequilla, que uso?',
  'Como van mis objetivos?',
]

export default function AdvisorChat({ userId }: AdvisorChatProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [autoSpeak, setAutoSpeak] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Voice hook
  const voice = useVoice({
    lang: 'es-ES',
    onTranscript: useCallback((text: string) => {
      // When speech recognition finishes, auto-send the message
      if (text.trim()) {
        handleSendVoice(text.trim())
      }
    }, []),
  })

  // Hands-free voice mode (wake word + Realtime overlay)
  const voiceMode = useVoiceMode()

  // Drain any voice-mode turns into the chat history on mount and on new arrivals
  useEffect(() => {
    function drain() {
      const turns = consumeVoiceTurns()
      if (turns.length === 0) return
      setMessages(prev => [
        ...prev,
        ...turns.map((t, i) => ({
          id: `v-${Date.now()}-${i}`,
          role: t.role,
          content: t.content,
        })),
      ])
    }
    drain()
    const unsubscribe = subscribeVoiceTurns(drain)
    return unsubscribe
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function getHistory() {
    return messages.slice(-20).map(m => ({ role: m.role, content: m.content }))
  }

  // Send from voice (needs to be a ref to avoid stale closure)
  const handleSendRef = useRef<(text: string) => void>(() => {})

  async function handleSend(promptText?: string) {
    const question = (promptText ?? input).trim()
    if (!question || loading) return

    // Stop any ongoing TTS when user sends a new message
    voice.stopSpeaking()

    setMessages(prev => [...prev, {
      id: `u-${Date.now()}`,
      role: 'user',
      content: question,
    }])
    setInput('')
    setLoading(true)

    try {
      const history = [...getHistory(), { role: 'user' as const, content: question }]

      const response: any = await api.post(`/assistant/${userId}/chat`, {
        message: question,
        history: history.slice(0, -1),
      })

      const assistantMessage = response.message || 'No pude procesar tu pregunta.'

      setMessages(prev => [...prev, {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: assistantMessage,
        skillUsed: response.skillUsed,
        uiHint: response.uiHint,
        data: response.data,
      }])

      // Auto-speak the response if enabled
      if (autoSpeak && voice.ttsSupported) {
        voice.speak(assistantMessage)
      }
    } catch (err: any) {
      const errorMsg = `Error: ${err?.message || 'No pude conectar con el asistente.'}`
      setMessages(prev => [...prev, {
        id: `e-${Date.now()}`,
        role: 'assistant',
        content: errorMsg,
      }])
    } finally {
      setLoading(false)
    }
  }

  // Keep ref updated for voice callback
  handleSendRef.current = handleSend

  function handleSendVoice(text: string) {
    handleSendRef.current(text)
  }

  // Toggle mic
  function handleMicToggle() {
    if (voice.isListening) {
      voice.stopListening()
    } else {
      voice.stopSpeaking() // Stop TTS if playing
      voice.startListening()
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Messages area */}
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && !loading && !voice.isListening && (
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#F2EDE0]">
              <span className="text-3xl">🥗</span>
            </div>
            <p className="text-center text-[13px] text-[#7A7066]">
              Soy tu asistente de ONA. Escribe o habla.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {EXAMPLE_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => handleSend(prompt)}
                  className="rounded-full border border-[#DDD6C5] px-3 py-1.5 text-[12px] text-[#4A4239] active:bg-[#F2EDE0]"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'assistant' && (
              <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#F2EDE0]">
                <span className="text-sm">🥦</span>
              </div>
            )}
            <div className={`max-w-[75%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-line ${
              msg.role === 'user'
                ? 'rounded-br-md bg-[#1A1612] text-[#FFFEFA]'
                : 'rounded-bl-md bg-[#F2EDE0] text-[#1A1612]'
            }`}>
              {msg.content}
              {/* Tap to replay TTS on assistant messages */}
              {msg.role === 'assistant' && voice.ttsSupported && (
                <button
                  onClick={() => voice.speak(msg.content)}
                  className="ml-2 inline-flex items-center text-[#C65D38] hover:text-[#1A1612]"
                  aria-label="Escuchar"
                >
                  <Volume2 size={12} />
                </button>
              )}
            </div>
          </div>
        ))}

        {/* Listening indicator */}
        {voice.isListening && (
          <div className="flex justify-end">
            <div className="flex items-center gap-2 rounded-2xl rounded-br-md bg-[#1A1612] px-4 py-3 text-[#FFFEFA]">
              <div className="flex items-center gap-1">
                <span className="h-2 w-2 animate-pulse rounded-full bg-[#C65D38]" />
                <span className="h-3 w-1 animate-pulse rounded-full bg-[#FFFEFA]/80" style={{ animationDelay: '0ms' }} />
                <span className="h-4 w-1 animate-pulse rounded-full bg-[#FFFEFA]/80" style={{ animationDelay: '100ms' }} />
                <span className="h-2 w-1 animate-pulse rounded-full bg-[#FFFEFA]/80" style={{ animationDelay: '200ms' }} />
                <span className="h-5 w-1 animate-pulse rounded-full bg-[#FFFEFA]/80" style={{ animationDelay: '50ms' }} />
                <span className="h-3 w-1 animate-pulse rounded-full bg-[#FFFEFA]/80" style={{ animationDelay: '150ms' }} />
              </div>
              <span className="text-[12px]">
                {voice.transcript || 'Escuchando...'}
              </span>
            </div>
          </div>
        )}

        {/* Loading indicator */}
        {loading && (
          <div className="flex gap-2">
            <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#F2EDE0]">
              <span className="text-sm">🥦</span>
            </div>
            <div className="flex items-center gap-1.5 rounded-2xl bg-[#F2EDE0] px-4 py-3">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#7A7066]" style={{ animationDelay: '0ms' }} />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#7A7066]" style={{ animationDelay: '150ms' }} />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#7A7066]" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}

        {/* Speaking indicator */}
        {voice.isSpeaking && (
          <div className="flex justify-center">
            <button
              onClick={voice.stopSpeaking}
              className="flex items-center gap-2 rounded-full bg-[#F2EDE0] border border-[#DDD6C5] px-4 py-1.5 text-[12px] text-[#1A1612]"
            >
              <div className="flex items-center gap-0.5">
                <span className="h-2 w-0.5 animate-pulse rounded-full bg-[#C65D38]" />
                <span className="h-3 w-0.5 animate-pulse rounded-full bg-[#C65D38]" style={{ animationDelay: '100ms' }} />
                <span className="h-4 w-0.5 animate-pulse rounded-full bg-[#C65D38]" style={{ animationDelay: '50ms' }} />
                <span className="h-2 w-0.5 animate-pulse rounded-full bg-[#C65D38]" style={{ animationDelay: '150ms' }} />
              </div>
              Hablando... (toca para parar)
            </button>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-[#DDD6C5] bg-[#FFFEFA] px-4 py-3">
        <div className="flex items-center gap-2">
          {/* Auto-speak toggle */}
          {voice.ttsSupported && (
            <button
              onClick={() => { setAutoSpeak(!autoSpeak); if (voice.isSpeaking) voice.stopSpeaking() }}
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors ${
                autoSpeak
                  ? 'bg-[#1A1612] text-[#FFFEFA]'
                  : 'bg-[#FFFEFA] border border-[#DDD6C5] text-[#1A1612]'
              }`}
              aria-label={autoSpeak ? 'Silenciar respuestas' : 'Activar respuestas por voz'}
            >
              {autoSpeak ? <Volume2 size={18} /> : <VolumeX size={18} />}
            </button>
          )}

          {/* Text input */}
          <input
            type="text"
            value={voice.isListening ? (voice.transcript || '') : input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
            placeholder={voice.isListening ? 'Escuchando...' : 'Escribe o pulsa el micro...'}
            className="flex-1 rounded-full border border-[#DDD6C5] bg-[#F2EDE0] px-4 py-2.5 text-[13px] text-[#1A1612] placeholder:text-[#7A7066] focus:border-[#1A1612] focus:outline-none"
            disabled={loading || voice.isListening}
          />

          {/* Mic button — hidden when hands-free voice mode is active */}
          {voice.sttSupported && !voiceMode.enabled && (
            <button
              onClick={handleMicToggle}
              disabled={loading}
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all disabled:opacity-30 ${
                voice.isListening
                  ? 'bg-[#1A1612] text-[#FFFEFA] animate-pulse'
                  : 'bg-[#FFFEFA] border border-[#DDD6C5] text-[#1A1612]'
              }`}
              aria-label={voice.isListening ? 'Parar de escuchar' : 'Hablar'}
            >
              {voice.isListening ? <MicOff size={18} /> : <Mic size={18} />}
            </button>
          )}

          {/* Send button */}
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || loading || voice.isListening}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#1A1612] text-[#FFFEFA] disabled:opacity-30"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}
