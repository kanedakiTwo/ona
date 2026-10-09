"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { campaignCodeFromLocation, householdInviteTokenFromNext, nextFromLocation, useNextSuffix } from "@/lib/safeNext"
import { ApiError } from "@/lib/api"
import { ArrowRight } from "lucide-react"
import { Accent, AUTH_PILL, AuthError, AuthField, AuthFooterLink, AuthHeading, AuthShell } from "@/components/auth/AuthShell"
import { useAuth } from "@/lib/auth"

const HERO_IMG = "https://images.unsplash.com/photo-1466637574441-749b8f19452f?w=1200&q=85&auto=format&fit=crop"

export default function RegisterPage() {
  const { register } = useAuth()
  const router = useRouter()

  const [username, setUsername] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [ageConfirmed, setAgeConfirmed] = useState(false)
  const nextSuffix = useNextSuffix()
  const [error, setError] = useState<string | null>(null)
  // Closed beta (PRO-27): no invitation → point to the waitlist.
  const [closedBeta, setClosedBeta] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setClosedBeta(false)
    setIsSubmitting(true)
    try {
      const next = nextFromLocation()
      await register(username, email, password, ageConfirmed, {
        inviteCode: campaignCodeFromLocation(),
        householdInviteToken: householdInviteTokenFromNext(next),
      })
      router.push(next ?? "/onboarding")
    } catch (err) {
      if (err instanceof ApiError && err.code === "REGISTRATION_INVITE_REQUIRED") {
        setClosedBeta(true)
        return
      }
      setError(err instanceof Error ? err.message : "Error al registrarse")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AuthShell
      image={HERO_IMG}
      backHref="/"
      caption={{
        eyebrow: "Empieza aquí",
        title: (
          <>
            Tu primer <Accent>menú</Accent> en 2 minutos.
          </>
        ),
        body: "Cinco preguntas, sin tarjeta de crédito, y en pantalla un menú semanal con su lista de la compra.",
      }}
      footer={
        <>
          <span>¿Ya tienes cuenta?</span>
          <AuthFooterLink href={`/login${nextSuffix}`}>Inicia sesión →</AuthFooterLink>
        </>
      }
    >
      <AuthHeading
        eyebrow="Nuevo aquí"
        title={
          <>
            Crea tu <Accent>primer menú</Accent>.
          </>
        }
        lead="Sin tarjeta. Sin compromiso. Dos minutos."
      />

      <form onSubmit={handleSubmit} className="mt-7 flex flex-col gap-5">
        {closedBeta && (
          <div
            role="alert"
            data-testid="closed-beta"
            className="rounded-[16px] border border-border-soft bg-cream px-4 py-4 text-[14px] text-ink"
          >
            <p className="font-semibold">Mimoia está en beta cerrada</p>
            <p className="mt-1 leading-relaxed text-ink-mid">
              De momento solo se entra con invitación. Apúntate a la lista de espera y te avisamos cuando le
              toque a tu tanda.
            </p>
            <Link
              href="/#lista-de-espera"
              className="mt-1 inline-flex min-h-[44px] items-center font-semibold text-terracotta-deep underline underline-offset-4"
            >
              Apuntarme a la lista de espera
            </Link>
          </div>
        )}
        {error && <AuthError>{error}</AuthError>}

        <AuthField label="Nombre de usuario" value={username} onChange={setUsername} autoFocus autoComplete="username" />

        <AuthField label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" />

        <AuthField
          label="Contraseña"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
        />

        {/* LOPDGDD art. 7: Mimoia is not for under-14s (PRO-23). */}
        <label className="flex min-h-[44px] cursor-pointer items-center gap-3 text-[14px] text-ink">
          <input
            type="checkbox"
            name="ageConfirmed"
            checked={ageConfirmed}
            onChange={(e) => setAgeConfirmed(e.target.checked)}
            className="h-5 w-5 shrink-0 accent-ink"
          />
          <span>Tengo 14 años o más</span>
        </label>

        <button
          type="submit"
          disabled={isSubmitting || !username || !email || !password || !ageConfirmed}
          className={AUTH_PILL}
        >
          {isSubmitting ? "Creando cuenta..." : "Crear cuenta gratis"}
          <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" aria-hidden />
        </button>

        <p className="text-center text-[12px] leading-relaxed text-ink-muted">
          Al crear cuenta aceptas los{" "}
          <Link href="/terminos" className="font-medium text-ink underline underline-offset-2">
            términos
          </Link>{" "}
          y la{" "}
          <Link href="/privacidad" className="font-medium text-ink underline underline-offset-2">
            privacidad
          </Link>
          .
        </p>
      </form>
    </AuthShell>
  )
}
