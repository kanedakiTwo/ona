'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Mic, Send, Square, Volume2, VolumeX, X, Headphones, RotateCcw } from 'lucide-react'
import { AI_DISCLOSURE } from '@ona/shared'
import { useMimo, type MimoStatus } from './MimoProvider'
import { isCookPath, isRecipeDetailPath } from './MimoButton'
import { MimoAvatar } from '@/components/brand/Mimoia'

/** Suggestions for an empty conversation, by page. */
export function suggestionsFor(pathname: string | null): string[] {
  if (isCookPath(pathname)) return ['Siguiente paso', 'Pon un temporizador de 10 minutos', '¿Por qué paso voy?']
  if (isRecipeDetailPath(pathname)) return ['¿Puedo hacerla sin horno?', 'Adáptala para 4 personas', 'Ponla en el menú del jueves']
  if (/^\/menu/.test(pathname ?? '')) return ['¿Qué toca cocinar hoy?', 'Cambia la cena del jueves', 'Hazme el menú de la semana']
  if (/^\/(shopping|compra)/.test(pathname ?? '')) return ['Añade leche a la lista', 'Hazme la compra', '¿Qué me falta para el lunes?']
  return ['¿Qué toca cocinar hoy?', 'Quiero crear una receta nueva', 'No tengo mantequilla, ¿qué uso?']
}

const STATUS_TEXT: Record<MimoStatus, string> = {
  idle: 'Escribe o habla',
  listening: 'Te escucho…',
  transcribing: 'Un momento…',
  thinking: 'Pensando…',
  speaking: 'Hablando… (toca para parar)',
}

export default function MimoPanel() {
  const mimo = useMimo()
  const pathname = usePathname()
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const busy = mimo.status === 'thinking' || mimo.status === 'transcribing'

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [mimo.messages, mimo.status])

  // Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && mimo.close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mimo])

  const submit = (text?: string) => {
    const t = (text ?? input).trim()
    if (!t || busy) return
    setInput('')
    void mimo.send(t)
  }

  const listening = mimo.status === 'listening'

  return (
    <>
      {/* Backdrop: phones and tablets only — on desktop the page stays usable beside the panel */}
      <div className="fixed inset-0 z-[130] bg-[#1A1612]/30 lg:hidden" onClick={mimo.close} aria-hidden />
      <section
        role="dialog"
        aria-label="Mimo"
        data-testid="mimo-panel"
        className="fixed inset-x-0 bottom-0 z-[140] flex h-[88dvh] flex-col rounded-t-[28px] border-t border-[#DDD6C5] bg-[#FAF6EE] shadow-[0_-12px_40px_-8px_rgba(26,22,18,0.25)] lg:inset-x-auto lg:right-0 lg:top-0 lg:h-auto lg:w-[400px] lg:rounded-none lg:border-l lg:border-t-0 lg:shadow-[-12px_0_40px_-12px_rgba(26,22,18,0.25)]"
      >
        {/* Header */}
        <header className="flex-none border-b border-[#DDD6C5] px-5 pb-3 pt-3 lg:pt-5">
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-[#DDD6C5] lg:hidden" aria-hidden />
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <MimoAvatar size={40} />
              <div>
                <h2 className="font-display text-[1.5rem] leading-none text-[#1A1612]">Mimo</h2>
                <p className="mt-1 text-[11px] uppercase tracking-[0.12em] text-[#7A7066]" data-testid="mimo-status">
                  {mimo.handsFree && mimo.status === 'idle' ? 'Manos libres' : STATUS_TEXT[mimo.status]}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <IconButton
                label={mimo.speakReplies ? 'No leer las respuestas en voz alta' : 'Leer las respuestas en voz alta'}
                onClick={() => mimo.setSpeakReplies(!mimo.speakReplies)}
                active={mimo.speakReplies}
              >
                {mimo.speakReplies ? <Volume2 size={17} /> : <VolumeX size={17} />}
              </IconButton>
              {mimo.messages.length > 0 && (
                <IconButton label="Empezar de nuevo" onClick={mimo.clear}>
                  <RotateCcw size={16} />
                </IconButton>
              )}
              <IconButton label="Cerrar" onClick={mimo.close}>
                <X size={18} />
              </IconButton>
            </div>
          </div>
          {mimo.voices.length > 1 && (
            <label className="mt-3 flex items-center gap-2 text-[11px] uppercase tracking-[0.12em] text-[#7A7066]">
              Voz
              <select
                value={mimo.selectedVoice ?? ''}
                onChange={(e) => mimo.previewVoice(e.target.value)}
                className="rounded-full border border-[#DDD6C5] bg-[#F2EDE0] px-3 py-1 text-[12px] normal-case tracking-normal text-[#1A1612] focus:border-[#1A1612] focus:outline-none"
                aria-label="Voz de Mimo"
                data-testid="tts-voice-select"
              >
                {mimo.voices.map((v) => (
                  <option key={v.key} value={v.key}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </header>

        {/* Conversation */}
        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4" data-testid="mimo-messages">
          {mimo.messages.length === 0 && !busy && !listening && (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
              <p className="max-w-[260px] text-[14px] leading-snug text-[#4A4239]">
                Soy Mimo. Pregúntame lo que quieras de tu menú, tus recetas o la compra, escribiendo o con la voz.
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {suggestionsFor(pathname).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => submit(s)}
                    className="rounded-full border border-[#DDD6C5] px-3 py-1.5 text-[12px] text-[#4A4239] hover:border-[#1A1612] active:bg-[#F2EDE0]"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {mimo.messages.map((m) => (
            <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] whitespace-pre-line rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed ${
                  m.role === 'user' ? 'rounded-br-md bg-[#1A1612] text-[#FFFEFA]' : 'rounded-bl-md bg-[#F2EDE0] text-[#1A1612]'
                }`}
              >
                {m.content}
              </div>
            </div>
          ))}

          {(busy || listening) && (
            <div className={`flex ${listening ? 'justify-end' : 'justify-start'}`}>
              <div className="flex items-center gap-2 rounded-2xl bg-[#F2EDE0] px-4 py-3" data-testid={listening ? 'mimo-listening' : 'mimo-thinking'}>
                {listening ? <LevelBars level={mimo.micLevel} /> : <Dots />}
              </div>
            </div>
          )}
          {mimo.error && <p className="text-center text-[12px] text-[#A3302A]">{mimo.error}</p>}
          <div ref={bottomRef} />
        </div>

        {/* Composer */}
        <div className="flex-none border-t border-[#DDD6C5] bg-[#FFFEFA] px-4 pb-[max(var(--safe-bottom),12px)] pt-3">
          {mimo.canListen && (
            <div className="mb-2 flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  const next = !mimo.handsFree
                  mimo.setHandsFree(next)
                  if (next && mimo.status === 'idle') mimo.toggleListening()
                }}
                aria-pressed={mimo.handsFree}
                data-testid="mimo-handsfree"
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] transition-colors ${
                  mimo.handsFree ? 'bg-[#2D6A4F] text-[#FAF6EE]' : 'border border-[#DDD6C5] text-[#4A4239]'
                }`}
              >
                <Headphones size={13} />
                Manos libres {mimo.handsFree ? 'activado' : ''}
              </button>
              {mimo.status === 'speaking' && (
                <button type="button" onClick={mimo.stopSpeaking} className="text-[12px] text-[#7A7066] underline underline-offset-4">
                  Parar
                </button>
              )}
            </div>
          )}
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={listening ? 'Te escucho…' : 'Escribe a Mimo…'}
              aria-label="Mensaje para Mimo"
              data-testid="mimo-input"
              disabled={listening}
              className="min-w-0 flex-1 rounded-full border border-[#DDD6C5] bg-[#F2EDE0] px-4 py-2.5 text-[14px] text-[#1A1612] placeholder:text-[#7A7066] focus:border-[#1A1612] focus:outline-none"
            />
            {mimo.canListen && (
              <button
                type="button"
                onClick={mimo.toggleListening}
                aria-label={listening ? 'Terminar y enviar' : 'Hablar'}
                data-testid="mimo-mic"
                disabled={busy}
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-30 ${
                  listening ? 'bg-[#C65D38] text-[#FAF6EE]' : 'border border-[#DDD6C5] bg-[#FFFEFA] text-[#1A1612]'
                }`}
              >
                {listening ? <Square size={16} /> : <Mic size={18} />}
              </button>
            )}
            <button
              type="submit"
              aria-label="Enviar"
              disabled={!input.trim() || busy}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#1A1612] text-[#FFFEFA] disabled:opacity-30"
            >
              <Send size={16} />
            </button>
          </form>
          {/* AI Act art. 50: visible before and during every interaction */}
          <p data-testid="ai-disclosure" className="mt-2 text-center text-[11px] leading-snug text-[#7A7066]">
            {AI_DISCLOSURE}
          </p>
        </div>
      </section>
    </>
  )
}

function IconButton({ label, onClick, active, children }: { label: string; onClick: () => void; active?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
        active ? 'bg-[#1A1612] text-[#FAF6EE]' : 'border border-[#DDD6C5] text-[#1A1612] hover:border-[#1A1612]'
      }`}
    >
      {children}
    </button>
  )
}

function Dots() {
  return (
    <span className="flex items-center gap-1.5" aria-label="Mimo está pensando">
      {[0, 150, 300].map((d) => (
        <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#7A7066]" style={{ animationDelay: `${d}ms` }} />
      ))}
    </span>
  )
}

function LevelBars({ level }: { level: number }) {
  const h = (k: number) => `${6 + Math.round(Math.min(1, level * k) * 16)}px`
  return (
    <span className="flex h-6 items-center gap-1" aria-label="Escuchando">
      {[0.6, 1, 1.4, 1, 0.6].map((k, i) => (
        <span key={i} className="w-1 rounded-full bg-[#C65D38] transition-[height] duration-100" style={{ height: h(k) }} />
      ))}
    </span>
  )
}
