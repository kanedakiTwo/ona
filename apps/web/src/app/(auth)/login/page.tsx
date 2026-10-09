"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { nextFromLocation, useNextSuffix } from "@/lib/safeNext"
import { ArrowRight } from "lucide-react"
import { Accent, AUTH_PILL, AuthError, AuthField, AuthFooterLink, AuthHeading, AuthShell } from "@/components/auth/AuthShell"
import { useAuth } from "@/lib/auth"

const HERO_IMG = "https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=1200&q=85&auto=format&fit=crop"

export default function LoginPage() {
  const { login } = useAuth()
  const router = useRouter()

  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const nextSuffix = useNextSuffix()
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      await login(username, password)
      router.push(nextFromLocation() ?? "/menu")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al iniciar sesión")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AuthShell
      image={HERO_IMG}
      backHref="/"
      caption={{ eyebrow: "Mimoia", title: <>Bienvenida <Accent>a la mesa</Accent>.</> }}
      footer={
        <>
          <span>¿Aún no tienes cuenta?</span>
          <AuthFooterLink href={`/register${nextSuffix}`}>Crear cuenta gratis →</AuthFooterLink>
        </>
      }
    >
      <AuthHeading
        eyebrow="Acceso"
        title={
          <>
            Bien<Accent>venida</Accent> de vuelta.
          </>
        }
        lead="Entra a tu cuenta y sigue cocinando con criterio."
      />

      <form onSubmit={handleSubmit} className="mt-7 flex flex-col gap-5">
        {error && <AuthError>{error}</AuthError>}

        <AuthField label="Usuario o email" value={username} onChange={setUsername} autoFocus autoComplete="username" />

        <AuthField
          label="Contraseña"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />

        <button type="submit" disabled={isSubmitting || !username || !password} className={`mt-2 ${AUTH_PILL}`}>
          {isSubmitting ? "Entrando..." : "Entrar"}
          <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" aria-hidden />
        </button>
      </form>
    </AuthShell>
  )
}
