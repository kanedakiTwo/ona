"use client"

import { Suspense, useState, type FormEvent } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { motion } from "motion/react"
import { ArrowRight, ArrowLeft } from "lucide-react"

const HERO_IMG = "https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=1200&q=85&auto=format&fit=crop"

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

export default function ResetPage() {
  // useSearchParams must be inside a Suspense boundary so the outer route
  // pre-renders without bailing out at build time.
  return (
    <Suspense fallback={null}>
      <ResetPageInner />
    </Suspense>
  )
}

function ResetPageInner() {
  const searchParams = useSearchParams()
  const token = searchParams.get("token") ?? ""

  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    if (!token) {
      setError("El enlace no es válido o ha caducado.")
      return
    }
    if (password.length < 6) {
      setError("La contraseña debe tener al menos 6 caracteres.")
      return
    }
    if (password !== confirm) {
      setError("Las contraseñas no coinciden.")
      return
    }

    setIsSubmitting(true)
    try {
      const response = await fetch(`${API_BASE}/auth/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (data?.code === "TOKEN_INVALID") {
          setError("El enlace no es válido o ha caducado.")
        } else {
          setError(data?.error ?? "No hemos podido actualizar tu contraseña.")
        }
        return
      }
      setSuccess(true)
    } catch {
      setError("No hemos podido contactar con el servidor. Inténtalo de nuevo.")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="grid min-h-screen grid-cols-1 bg-[#FAF6EE] md:grid-cols-2">
      {/* Left — Editorial cover photo */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1.2, ease: [0.19, 1, 0.22, 1] }}
        className="relative hidden md:block"
      >
        <div className="absolute inset-0">
          <img src={HERO_IMG} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-b from-[#1A1612]/30 via-transparent to-[#1A1612]/60" />
        </div>

        <div className="pointer-events-none absolute inset-0 z-10 p-10 text-[#FAF6EE]">
          <div className="flex h-full flex-col justify-between">
            <div className="text-eyebrow text-[#FAF6EE]/80">
              <Link href="/" className="link-reveal">← Volver a inicio</Link>
            </div>
            <div>
              <div className="font-italic italic text-sm text-[#FAF6EE]/70">
                Issue №01 · Spring 2026
              </div>
              <h2 className="mt-3 font-display text-[clamp(2.5rem,5vw,4rem)] leading-[0.95] text-[#FAF6EE]">
                Vuelve a
                <br />
                <span className="font-italic italic">tu cocina</span>.
              </h2>
            </div>
            <div className="text-[10px] uppercase tracking-[0.25em] text-[#FAF6EE]/60">
              Cook with intention
            </div>
          </div>
        </div>
      </motion.div>

      {/* Right — Form */}
      <div className="relative flex min-h-screen flex-col justify-between bg-[#FAF6EE] grain-subtle">
        <Link
          href="/"
          className="flex items-center gap-2 px-6 pt-6 text-[11px] uppercase tracking-[0.18em] text-[#7A7066] hover:text-[#1A1612] md:hidden"
        >
          <ArrowLeft size={12} />
          Volver
        </Link>

        <div className="relative h-48 overflow-hidden md:hidden">
          <img src={HERO_IMG} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[#FAF6EE]" />
          <div className="absolute bottom-2 left-6 font-display text-2xl text-[#1A1612]">ONA</div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, delay: 0.2, ease: [0.19, 1, 0.22, 1] }}
          className="flex flex-1 items-center justify-center px-8 py-10 md:px-16"
        >
          <div className="w-full max-w-sm">
            <div className="text-eyebrow mb-4">Recuperar acceso</div>
            <h1 className="font-display text-[clamp(2.5rem,5vw,3.5rem)] leading-[0.95] text-[#1A1612]">
              Nueva
              <br />
              <span className="font-italic italic text-[#C65D38]">contraseña</span>.
            </h1>
            <p className="mt-4 max-w-xs text-sm text-[#4A4239]">
              Elige una contraseña nueva y guarda los cambios. El enlace caduca a las 24 horas.
            </p>

            {success ? (
              <div className="mt-10 space-y-6">
                <div className="rounded-xl border border-[#1A1612]/15 bg-[#F4EEDF] px-4 py-4 text-[13px] text-[#1A1612]">
                  Contraseña actualizada. Ya puedes entrar con tu cuenta.
                </div>
                <Link
                  href="/login"
                  className="group flex w-full items-center justify-center gap-2 rounded-full bg-[#1A1612] py-4 text-[13px] font-medium text-[#FAF6EE] transition-all hover:gap-3"
                >
                  Ir a iniciar sesión
                  <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="mt-10 space-y-7">
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-xl border border-[#C65D38]/30 bg-[#FDEEE8] px-4 py-3 text-[12px] text-[#B5451B]"
                  >
                    {error}
                  </motion.div>
                )}

                <EditorialField
                  label="Contraseña nueva"
                  type="password"
                  value={password}
                  onChange={setPassword}
                  autoFocus
                />

                <EditorialField
                  label="Repite la contraseña"
                  type="password"
                  value={confirm}
                  onChange={setConfirm}
                />

                <button
                  type="submit"
                  disabled={isSubmitting || !password || !confirm}
                  className="group flex w-full items-center justify-center gap-2 rounded-full bg-[#1A1612] py-4 text-[13px] font-medium text-[#FAF6EE] transition-all hover:gap-3 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isSubmitting ? "Guardando..." : "Guardar contraseña"}
                  <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
                </button>
              </form>
            )}
          </div>
        </motion.div>

        {/* Footer */}
        <div className="border-t border-[#DDD6C5] px-8 py-6 md:px-16">
          <div className="flex flex-col gap-3 text-[12px] text-[#7A7066] md:flex-row md:items-center md:justify-between">
            <span className="font-italic italic">¿Ya recuerdas la contraseña?</span>
            <Link
              href="/login"
              className="link-reveal font-medium text-[#1A1612]"
            >
              Iniciar sesión →
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────── */

function EditorialField({
  label,
  value,
  onChange,
  type = "text",
  autoFocus,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  autoFocus?: boolean
}) {
  const [focused, setFocused] = useState(false)
  const hasValue = value.length > 0

  return (
    <div className="relative pt-5">
      <label
        className={`absolute left-0 transition-all duration-300 ease-[cubic-bezier(0.19,1,0.22,1)] ${
          focused || hasValue
            ? "top-0 text-[10px] uppercase tracking-[0.2em] text-[#7A7066]"
            : "top-7 text-[14px] text-[#7A7066]"
        }`}
      >
        {label}
      </label>
      <input
        type={type}
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        autoFocus={autoFocus}
        className="w-full border-b border-[#DDD6C5] bg-transparent py-2 text-[15px] text-[#1A1612] outline-none transition-colors focus:border-[#1A1612]"
      />
    </div>
  )
}
