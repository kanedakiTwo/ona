"use client"

import { useState, type FormEvent } from "react"
import { ArrowRight } from "lucide-react"
import { Accent, AUTH_PILL, AuthError, AuthField, AuthFooterLink, AuthHeading, AuthShell } from "@/components/auth/AuthShell"

const HERO_IMG = "https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=1200&q=85&auto=format&fit=crop"

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

/**
 * «¿Has olvidado la contraseña?» (specs/auth.md): asks for the email and
 * says the same thing whether or not it has an account. The email carries a
 * one-time /reset link valid for 1 hour.
 */
export default function RecoverPage() {
  const [email, setEmail] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      const response = await fetch(`${API_BASE}/auth/forgot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setError(data?.error ?? "No hemos podido enviarte el enlace. Inténtalo de nuevo.")
        return
      }
      setSent(true)
    } catch {
      setError("No hemos podido contactar con el servidor. Inténtalo de nuevo.")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AuthShell
      image={HERO_IMG}
      backHref="/login"
      caption={{
        eyebrow: "Mimoia",
        title: (
          <>
            Vuelve a <Accent>tu cocina</Accent>.
          </>
        ),
      }}
      footer={
        <>
          <span>¿Ya recuerdas la contraseña?</span>
          <AuthFooterLink href="/login">Iniciar sesión →</AuthFooterLink>
        </>
      }
    >
      <AuthHeading
        eyebrow="Recuperar acceso"
        title={
          <>
            ¿Has olvidado la <Accent>contraseña</Accent>?
          </>
        }
        lead="Escribe el email de tu cuenta y te mandamos un enlace para elegir una nueva."
      />

      {sent ? (
        <div role="status" className="mt-7 rounded-[16px] border border-border-soft bg-cream px-4 py-4 text-[14px] leading-relaxed text-ink">
          Si hay una cuenta con <strong>{email.trim()}</strong>, te acabamos de mandar un enlace. Caduca en 1 hora.
          Si no lo ves en unos minutos, mira en la carpeta de spam.
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-7 flex flex-col gap-5">
          {error && <AuthError>{error}</AuthError>}

          <AuthField label="Email" type="email" value={email} onChange={setEmail} autoFocus autoComplete="email" />

          <button type="submit" disabled={isSubmitting || !email.trim()} className={`mt-2 ${AUTH_PILL}`}>
            {isSubmitting ? "Enviando..." : "Enviarme el enlace"}
            <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" aria-hidden />
          </button>
        </form>
      )}
    </AuthShell>
  )
}
