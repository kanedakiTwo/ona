"use client"

import { Suspense, useState, type FormEvent } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { Accent, AUTH_PILL, AuthError, AuthField, AuthFooterLink, AuthHeading, AuthShell } from "@/components/auth/AuthShell"

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
    <AuthShell
      image={HERO_IMG}
      backHref="/"
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
            Nueva <Accent>contraseña</Accent>.
          </>
        }
        lead="Elige una contraseña nueva y guarda los cambios. El enlace caduca a las 24 horas."
      />

      {success ? (
        <div className="mt-7 flex flex-col gap-5">
          <div role="status" className="rounded-[16px] border border-border-soft bg-cream px-4 py-4 text-[14px] text-ink">
            Contraseña actualizada. Ya puedes entrar con tu cuenta.
          </div>
          <Link href="/login" className={AUTH_PILL}>
            Ir a iniciar sesión
            <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-7 flex flex-col gap-5">
          {error && <AuthError>{error}</AuthError>}

          <AuthField
            label="Contraseña nueva"
            type="password"
            value={password}
            onChange={setPassword}
            autoFocus
            autoComplete="new-password"
          />

          <AuthField
            label="Repite la contraseña"
            type="password"
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
          />

          <button type="submit" disabled={isSubmitting || !password || !confirm} className={`mt-2 ${AUTH_PILL}`}>
            {isSubmitting ? "Guardando..." : "Guardar contraseña"}
            <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" aria-hidden />
          </button>
        </form>
      )}
    </AuthShell>
  )
}
