'use client'

import { useState, useRef, useEffect } from 'react'
import { Send, MessageCircle } from 'lucide-react'
import { useAskAdvisor } from '@/hooks/useAdvisor'

interface Message {
  id: string
  role: 'user' | 'advisor'
  text: string
}

interface AdvisorChatProps {
  userId: string
}

const EXAMPLE_PROMPTS = [
  'Como lo estoy haciendo?',
  'Que nutrientes me faltan?',
  'Que cambio tendria mas impacto?',
]

export default function AdvisorChat({ userId }: AdvisorChatProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const askAdvisor = useAskAdvisor()
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function handleSend(text?: string) {
    const question = (text ?? input).trim()
    if (!question) return

    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: question,
    }

    setMessages((prev) => [...prev, userMsg])
    setInput('')

    try {
      const response = await askAdvisor.mutateAsync({
        userId,
        question,
      })

      const advisorMsg: Message = {
        id: `a-${Date.now()}`,
        role: 'advisor',
        text: response.answer,
      }

      setMessages((prev) => [...prev, advisorMsg])
    } catch {
      const errorMsg: Message = {
        id: `e-${Date.now()}`,
        role: 'advisor',
        text: 'Lo siento, no pude procesar tu pregunta. Intenta de nuevo.',
      }
      setMessages((prev) => [...prev, errorMsg])
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex flex-col rounded-xl border border-gray-200">
      {/* Chat header */}
      <div className="flex items-center gap-2 border-b border-gray-100 px-5 py-3">
        <MessageCircle className="h-5 w-5 text-gray-500" />
        <h3 className="text-sm font-semibold text-gray-700">
          Preguntale a tu asesor
        </h3>
      </div>

      {/* Messages area */}
      <div className="flex-1 space-y-4 overflow-y-auto p-5" style={{ minHeight: 240, maxHeight: 480 }}>
        {messages.length === 0 && (
          <div className="space-y-3">
            <p className="text-center text-sm text-gray-400">
              Hazme una pregunta sobre tu nutricion
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {EXAMPLE_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => handleSend(prompt)}
                  className="rounded-full border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 hover:border-gray-300"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-black text-white'
                  : 'bg-gray-100 text-gray-800'
              }`}
            >
              {msg.text}
            </div>
          </div>
        ))}

        {askAdvisor.isPending && (
          <div className="flex justify-start">
            <div className="flex items-center gap-1.5 rounded-2xl bg-gray-100 px-4 py-3">
              <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: '0ms' }} />
              <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: '150ms' }} />
              <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-gray-100 p-3">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Escribe tu pregunta..."
            className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none placeholder:text-gray-400 focus:border-gray-400"
            disabled={askAdvisor.isPending}
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || askAdvisor.isPending}
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-black text-white transition-opacity hover:bg-gray-800 disabled:opacity-30"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
