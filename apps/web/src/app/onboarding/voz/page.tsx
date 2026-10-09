"use client"

/**
 * /onboarding/voz — guided fact-extraction over voice.
 *
 * Mimo's one brain (D-023): the Claude assistant in 'onboarding' mode walks
 * the user through every memory key, calling `update_memory` after each
 * answer. Each turn is recorded → `POST /stt` → `POST /assistant/:id/chat`
 * (mode 'onboarding') → read aloud (`POST /tts`) → listen again. When the
 * assistant says the closing line "Listo, ya te conozco" we go to /menu.
 *
 * Falls back to the manual `/profile/memoria` editor if voice isn't
 * configured / breaks.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useQueryClient } from "@tanstack/react-query"
import { ChevronLeft, Mic, MicOff, Loader2, Check } from "lucide-react"
import { useAuth } from "@/lib/auth"
import { api } from "@/lib/api"
import { useRecorder, recorderSupported } from "@/hooks/useRecorder"
import { useVoice } from "@/hooks/useVoice"
import { useUserMemory } from "@/hooks/useUserMemory"
import { AI_DISCLOSURE, type MemoryKey } from "@ona/shared"

type Phase = "idle" | "thinking" | "speaking" | "listening" | "transcribing" | "done" | "error"
type Turn = { role: "user" | "assistant"; content: string }

const PROGRESS_KEYS: { key: MemoryKey; label: string }[] = [
  { key: "physical.age", label: "Edad" },
  { key: "household.adults", label: "Hogar" },
  { key: "restrictions", label: "Restricciones" },
  { key: "dislikes", label: "Cosas que no te gustan" },
  { key: "equipment", label: "Equipo de cocina" },
  { key: "time_available", label: "Tiempo disponible" },
  { key: "weekly_budget_eur", label: "Presupuesto semanal" },
  { key: "cuisine_bias", label: "Cocinas preferidas" },
  { key: "cooking_skill", label: "Nivel de cocinero" },
  { key: "meal_times", label: "Horarios" },
  { key: "nutrition_principles", label: "Tus creencias nutricionales (opcional)" },
]

const DONE_PHRASE = "ya te conozco"

export default function VoiceOnboardingPage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const userId = user?.id ?? ""
  const { data: memory } = useUserMemory()
  const recorder = useRecorder({ noSpeechMs: 15_000 })
  const voice = useVoice({ lang: "es-ES" })
  const [phase, setPhase] = useState<Phase>("idle")
  const [error, setError] = useState<string | null>(null)
  const [lastAssistant, setLastAssistant] = useState<string | null>(null)
  const historyRef = useRef<Turn[]>([])
  const stoppedRef = useRef(false)

  /** One exchange: the user's words (or the kickoff) → Mimo → spoken reply → listen again. */
  const turn = useCallback(
    async (text: string) => {
      setPhase("thinking")
      try {
        const res = await api.post<{ message: string }>(`/assistant/${userId}/chat`, {
          message: text,
          history: historyRef.current.slice(-30),
          mode: "onboarding",
        })
        const reply = res.message || ""
        historyRef.current = [...historyRef.current, { role: "user", content: text }, { role: "assistant", content: reply }]
        setLastAssistant(reply)
        queryClient.invalidateQueries() // the checklist reads the memory Mimo just saved
        if (stoppedRef.current) return
        setPhase("speaking")
        await voice.speak(reply)
        if (reply.toLowerCase().includes(DONE_PHRASE)) {
          setPhase("done")
          setTimeout(() => router.push("/menu"), 1500)
          return
        }
        if (stoppedRef.current) return
        setPhase("listening")
        const blob = await recorder.start()
        if (stoppedRef.current) return
        if (!blob) {
          if (recorder.lastError()) setError(recorder.lastError())
          setPhase(recorder.lastError() ? "error" : "idle")
          return
        }
        setPhase("transcribing")
        const form = new FormData()
        form.append("audio", blob, blob.type.includes("mp4") ? "voz.m4a" : "voz.webm")
        const { text: said } = await api.upload<{ text: string }>("/stt", form)
        await turn(said?.trim() || "(no se ha entendido; repite la última pregunta)")
      } catch (err: any) {
        setError(err?.message || "Algo ha fallado.")
        setPhase("error")
      }
    },
    [userId, voice, recorder, router, queryClient],
  )

  const start = () => {
    stoppedRef.current = false
    setError(null)
    void turn(historyRef.current.length ? "Sigamos donde lo dejamos." : "Hola, empecemos.")
  }
  const stop = () => {
    stoppedRef.current = true
    recorder.cancel()
    voice.stopSpeaking()
    setPhase("idle")
  }
  useEffect(() => () => {
    stoppedRef.current = true
  }, [])

  if (!userId) {
    return (
      <div className="min-h-screen bg-[#FAF6EE] p-6">
        <p className="text-[#1A1612]">Necesitas iniciar sesión para hacer el onboarding por voz.</p>
      </div>
    )
  }

  const completedCount = PROGRESS_KEYS.filter((p) => memory?.[p.key]).length

  return (
    <div className="min-h-screen bg-[#FAF6EE]">
      <div className="mx-auto max-w-[430px] px-5 pb-20 pt-8">
        <Link
          href="/profile"
          className="inline-flex items-center gap-1 text-[12px] uppercase tracking-[0.15em] text-[#7A7066] hover:text-[#1A1612]"
        >
          <ChevronLeft size={14} />
          Volver al perfil
        </Link>

        <div className="mt-6">
          <div className="text-eyebrow text-[#C65D38]">Onboarding por voz</div>
          <h1 className="mt-2 font-display text-[2.2rem] leading-[1.02] tracking-tight text-[#1A1612]">
            Cuéntale a <span className="font-italic italic text-[#C65D38]">Mimo</span> cómo eres
          </h1>
          <p className="mt-2 max-w-md text-[13px] leading-relaxed text-[#7A7066]">
            Una conversación de un par de minutos. Te pregunta lo justo para
            personalizar tus menús, tu lista de la compra y tus recomendaciones.
            Todo queda en tu memoria — la puedes editar luego en{" "}
            <Link href="/profile/memoria" className="underline">
              /profile/memoria
            </Link>
            .
          </p>
        </div>

        {/* Voice control */}
        <div className="mt-10 flex flex-col items-center">
          {phase === "idle" || phase === "error" ? (
            <button
              type="button"
              onClick={start}
              disabled={!recorderSupported()}
              className="flex h-24 w-24 items-center justify-center rounded-full bg-[#2D6A4F] text-[#FAF6EE] transition-transform active:scale-95 disabled:opacity-40"
              aria-label="Empezar onboarding por voz"
            >
              <Mic size={36} />
            </button>
          ) : phase === "thinking" || phase === "transcribing" ? (
            <button type="button" onClick={stop} className="flex h-24 w-24 items-center justify-center rounded-full bg-[#F2EDE0] text-[#7A7066]" aria-label="Parar">
              <Loader2 size={36} className="animate-spin" />
            </button>
          ) : phase === "done" ? (
            <div className="flex h-24 w-24 items-center justify-center rounded-full bg-[#2D6A4F] text-[#FAF6EE]">
              <Check size={36} />
            </div>
          ) : (
            <button
              type="button"
              onClick={stop}
              className="flex h-24 w-24 items-center justify-center rounded-full bg-[#C65D38] text-[#FAF6EE] transition-transform active:scale-95"
              aria-label="Parar el onboarding"
            >
              <MicOff size={36} />
            </button>
          )}

          <p className="mt-4 text-center text-[12px] uppercase tracking-[0.12em] text-[#7A7066]">
            {phase === "idle" && (historyRef.current.length ? "Pulsa para seguir" : "Pulsa para empezar")}
            {phase === "thinking" && "Pensando…"}
            {phase === "speaking" && "Mimo habla"}
            {phase === "listening" && "Te escucho"}
            {phase === "transcribing" && "Un momento…"}
            {phase === "done" && "Onboarding completo"}
            {phase === "error" && "Algo ha fallado"}
          </p>
          {!recorderSupported() && (
            <p className="mt-2 max-w-xs text-center text-[11px] italic text-[#C65D38]">Este navegador no puede grabar audio.</p>
          )}
          {error ? <p className="mt-2 max-w-xs text-center text-[11px] italic text-[#C65D38]">{error}</p> : null}

          {/* AI Act art. 50: the user knows they are talking to an AI before and during the conversation */}
          <p data-testid="ai-disclosure" className="mt-4 max-w-xs text-center text-[11px] leading-snug text-[#7A7066]">
            {AI_DISCLOSURE}
          </p>

          {lastAssistant ? (
            <p className="mt-6 max-w-xs text-center text-[14px] font-italic italic leading-relaxed text-[#1A1612]">
              «{lastAssistant}»
            </p>
          ) : null}
        </div>

        {/* Progress checklist */}
        <div className="mt-10">
          <div className="text-eyebrow text-[#7A7066]">
            Progreso · {completedCount} / {PROGRESS_KEYS.length}
          </div>
          <ul className="mt-3 space-y-2">
            {PROGRESS_KEYS.map((p) => {
              const captured = !!memory?.[p.key]
              return (
                <li
                  key={p.key}
                  className={`flex items-center justify-between rounded-xl border px-4 py-2 text-[13px] ${
                    captured
                      ? "border-[#2D6A4F] bg-[#2D6A4F]/5 text-[#1A1612]"
                      : "border-[#DDD6C5] bg-[#FFFEFA] text-[#7A7066]"
                  }`}
                >
                  <span>{p.label}</span>
                  {captured ? <Check size={14} className="text-[#2D6A4F]" /> : null}
                </li>
              )
            })}
          </ul>
        </div>

        {phase === "done" ? (
          <p className="mt-8 text-center text-[12px] italic text-[#7A7066]">
            Llevándote al menú…
          </p>
        ) : (
          <p className="mt-8 text-center text-[10px] uppercase tracking-[0.12em] text-[#7A7066]">
            Prefieres escribir: <Link href="/profile/memoria" className="underline">edita tu memoria a mano</Link>
          </p>
        )}
      </div>
    </div>
  )
}
