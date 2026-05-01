"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { motion } from "motion/react"
import { ArrowRight, ArrowLeft } from "lucide-react"
import { useAuth } from "@/lib/auth"

const HERO_IMG = "https://images.unsplash.com/photo-1466637574441-749b8f19452f?w=1200&q=85&auto=format&fit=crop"

export default function RegisterPage() {
  const { register } = useAuth()
  const router = useRouter()

  const [username, setUsername] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      await register(username, email, password)
      router.push("/onboarding")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al registrarse")
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
        className="relative hidden md:block md:order-2"
      >
        <div className="absolute inset-0">
          <img src={HERO_IMG} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-b from-[#1A1612]/30 via-transparent to-[#1A1612]/60" />
        </div>

        <div className="pointer-events-none absolute inset-0 z-10 p-10 text-[#FAF6EE]">
          <div className="flex h-full flex-col justify-between">
            <div className="text-eyebrow text-[#FAF6EE]/80 text-right">
              <Link href="/" className="link-reveal pointer-events-auto">← Volver a inicio</Link>
            </div>
            <div>
              <div className="font-italic italic text-sm text-[#FAF6EE]/70">
                Empieza aqui
              </div>
              <h2 className="mt-3 font-display text-[clamp(2.5rem,5vw,4rem)] leading-[0.95] text-[#FAF6EE]">
                Tu primer
                <br />
                <span className="font-italic italic">menu</span> en 2 minutos.
              </h2>
              <p className="mt-4 max-w-md text-sm text-[#FAF6EE]/80">
                Cinco preguntas, sin tarjeta de credito, y en pantalla un menu semanal con su lista de la compra.
              </p>
            </div>
            <div className="text-[10px] uppercase tracking-[0.25em] text-[#FAF6EE]/60">
              Issue №01 · Spring 2026
            </div>
          </div>
        </div>
      </motion.div>

      {/* Right — Form */}
      <div className="relative flex min-h-screen flex-col justify-between bg-[#FAF6EE] grain-subtle md:order-1">
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
            <div className="text-eyebrow mb-4">Nuevo aqui</div>
            <h1 className="font-display text-[clamp(2.5rem,5vw,3.5rem)] leading-[0.95] text-[#1A1612]">
              Crea tu
              <br />
              <span className="font-italic italic text-[#C65D38]">primer menu</span>.
            </h1>
            <p className="mt-4 max-w-xs text-sm text-[#4A4239]">
              Sin tarjeta. Sin compromiso. Dos minutos.
            </p>

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
                label="Nombre de usuario"
                value={username}
                onChange={setUsername}
                autoFocus
              />

              <EditorialField
                label="Email"
                type="email"
                value={email}
                onChange={setEmail}
              />

              <EditorialField
                label="Contrasena"
                type="password"
                value={password}
                onChange={setPassword}
              />

              <button
                type="submit"
                disabled={isSubmitting || !username || !email || !password}
                className="group flex w-full items-center justify-center gap-2 rounded-full bg-[#1A1612] py-4 text-[13px] font-medium text-[#FAF6EE] transition-all hover:bg-[#2D6A4F] hover:gap-3 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isSubmitting ? "Creando cuenta..." : "Crear cuenta gratis"}
                <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
              </button>

              <p className="text-center text-[11px] text-[#7A7066]">
                Al crear cuenta aceptas los{" "}
                <Link href="/terminos" className="link-reveal text-[#1A1612]">terminos</Link>
                {" "}y la{" "}
                <Link href="/privacidad" className="link-reveal text-[#1A1612]">privacidad</Link>.
              </p>
            </form>
          </div>
        </motion.div>

        <div className="border-t border-[#DDD6C5] px-8 py-6 md:px-16">
          <div className="flex flex-col gap-3 text-[12px] text-[#7A7066] md:flex-row md:items-center md:justify-between">
            <span className="font-italic italic">¿Ya tienes cuenta?</span>
            <Link href="/login" className="link-reveal font-medium text-[#1A1612]">
              Inicia sesion →
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
