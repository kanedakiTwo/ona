"use client"

/**
 * /onboarding/voz — guided fact-extraction over voice.
 *
 * Opens a Realtime session in 'onboarding' mode. The advisor walks the
 * user through every memory key in a natural conversation, calling
 * `update_memory` after each answer. When the assistant emits the closing
 * line "Listo, ya te conozco" we auto-redirect to /menu.
 *
 * Falls back to the manual `/profile/memoria` editor if voice isn't
 * configured / breaks.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ChevronLeft, Mic, MicOff, Loader2, Check } from "lucide-react"
import { useAuth } from "@/lib/auth"
import { useRealtimeSession } from "@/hooks/useRealtimeSession"
import { useUserMemory } from "@/hooks/useUserMemory"
import type { MemoryKey } from "@ona/shared"

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
  const { user } = useAuth()
  const userId = user?.id ?? ""
  const { data: memory } = useUserMemory()
  const [started, setStarted] = useState(false)
  const [doneAt, setDoneAt] = useState<number | null>(null)
  const session = useRealtimeSession({ userId, mode: "onboarding" })

  // Listen for the closing line in the assistant's transcripts.
  useEffect(() => {
    if (doneAt) return
    for (const turn of session.transcripts) {
      if (
        turn.role === "assistant" &&
        turn.content.toLowerCase().includes(DONE_PHRASE)
      ) {
        setDoneAt(Date.now())
        break
      }
    }
  }, [session.transcripts, doneAt])

  // Auto-redirect 2s after the closing line so the user can hear the goodbye
  // and the memory cache invalidates in time.
  useEffect(() => {
    if (!doneAt) return
    const t = setTimeout(() => router.push("/menu"), 2_000)
    return () => clearTimeout(t)
  }, [doneAt, router])

  const lastAssistant = useMemo(() => {
    for (let i = session.transcripts.length - 1; i >= 0; i--) {
      if (session.transcripts[i].role === "assistant") return session.transcripts[i].content
    }
    return null
  }, [session.transcripts])

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
            Cuéntale a <span className="font-italic italic text-[#C65D38]">ONA</span> cómo eres
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
          {session.status === "idle" || session.status === "closed" ? (
            <button
              type="button"
              onClick={() => {
                setStarted(true)
                session.connect()
              }}
              className="flex h-24 w-24 items-center justify-center rounded-full bg-[#2D6A4F] text-[#FAF6EE] transition-transform active:scale-95"
              aria-label="Empezar onboarding por voz"
            >
              <Mic size={36} />
            </button>
          ) : session.status === "connecting" ? (
            <div className="flex h-24 w-24 items-center justify-center rounded-full bg-[#F2EDE0] text-[#7A7066]">
              <Loader2 size={36} className="animate-spin" />
            </div>
          ) : session.status === "connected" ? (
            <button
              type="button"
              onClick={session.disconnect}
              className="flex h-24 w-24 items-center justify-center rounded-full bg-[#C65D38] text-[#FAF6EE] transition-transform active:scale-95"
              aria-label="Terminar onboarding"
            >
              <MicOff size={36} />
            </button>
          ) : (
            <div className="flex h-24 w-24 items-center justify-center rounded-full bg-[#F2EDE0] text-[#C65D38]">
              <MicOff size={36} />
            </div>
          )}

          <p className="mt-4 text-center text-[12px] uppercase tracking-[0.12em] text-[#7A7066]">
            {session.status === "idle" && "Pulsa para empezar"}
            {session.status === "connecting" && "Conectando…"}
            {session.status === "connected" && (doneAt ? "Onboarding completo" : "Te escucho")}
            {session.status === "error" && "Error en la sesión"}
            {session.status === "closed" && (doneAt ? "Onboarding completo" : "Sesión cerrada")}
          </p>

          {session.error ? (
            <p className="mt-2 max-w-xs text-center text-[11px] italic text-[#C65D38]">
              {session.error}
            </p>
          ) : null}

          {lastAssistant && started ? (
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

        {doneAt ? (
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
