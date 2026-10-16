"use client"

import { useEffect, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  campaignCodeFromLocation,
  householdInviteTokenFromNext,
  nextFromLocation,
  useNextSuffix,
  waitlistTokenFromLocation,
} from "@/lib/safeNext"
import { ApiError, apiPublic } from "@/lib/api"
import { ArrowRight } from "lucide-react"
import { Accent, AUTH_PILL, AuthError, AuthField, AuthFooterLink, AuthHeading, AuthShell } from "@/components/auth/AuthShell"
import { useAuth } from "@/lib/auth"
import { NEWSLETTER_OPT_IN_HINT, NEWSLETTER_OPT_IN_LABEL } from "@ona/shared"
import { signupAttributionForRegister } from "@/lib/signupAttribution"

const HERO_IMG = "https://images.unsplash.com/photo-1466637574441-749b8f19452f?w=1200&q=85&auto=format&fit=crop"

export default function RegisterPage() {
  const { register } = useAuth()
  const router = useRouter()

  const [username, setUsername] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [ageConfirmed, setAgeConfirmed] = useState(false)
  const [newsletterOptIn, setNewsletterOptIn] = useState(false)
  const nextSuffix = useNextSuffix()
  const [error, setError] = useState<string | null>(null)
  // Closed beta (PRO-27): no invitation → point to the waitlist.
  const [closedBeta, setClosedBeta] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  // Waitlist invitation (PRO-97): /entrar/<token> → ?entrada=<token>. The
  // email is the one on the list, fixed; the token goes with the account.
  const [entry, setEntry] = useState<
    | { state: "none" }
    | { state: "loading"; token: string }
    | { state: "ok"; token: string; firstName: string | null }
    | { state: "error"; message: string; used: boolean }
  >({ state: "none" })

  useEffect(() => {
    const token = waitlistTokenFromLocation()
    if (!token) return
    setEntry({ state: "loading", token })
    apiPublic
      .get<{ email: string; firstName: string | null }>(`/waitlist/invite/${encodeURIComponent(token)}`)
      .then((r) => {
        setEmail(r.email)
        setEntry({ state: "ok", token, firstName: r.firstName })
      })
      .catch((err) =>
        setEntry({
          state: "error",
          used: err instanceof ApiError && err.code === "WAITLIST_INVITE_USED",
          message:
            err instanceof ApiError && err.status < 500
              ? err.message
              : "No hemos podido comprobar tu enlace. Recarga la página en un momento.",
        }),
      )
  }, [])
  const emailFixed = entry.state === "ok" || entry.state === "loading"

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
        waitlistToken: entry.state === "ok" ? entry.token : undefined,
        newsletterOptIn,
        // Who invited them and where the visit came from (PRO-162).
        ...signupAttributionForRegister(),
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
        {entry.state === "ok" && (
          <div
            data-testid="waitlist-entry"
            className="rounded-[16px] border border-border-soft bg-cream px-4 py-4 text-[14px] text-ink"
          >
            <p className="font-semibold">
              {entry.firstName ? `¡Te toca, ${entry.firstName}!` : "¡Te toca!"} Vienes de la lista de espera.
            </p>
            <p className="mt-1 leading-relaxed text-ink-mid">
              Crea tu cuenta con el correo en el que te llegó la invitación. El enlace es personal y sirve una vez.
            </p>
          </div>
        )}
        {entry.state === "error" && (
          <div data-testid="waitlist-entry-error">
            <AuthError>{entry.message}</AuthError>
            {entry.used && (
              <Link
                href="/login"
                className="mt-1 inline-flex min-h-[44px] items-center font-semibold text-terracotta-deep underline underline-offset-4"
              >
                Iniciar sesión
              </Link>
            )}
          </div>
        )}
        {error && <AuthError>{error}</AuthError>}

        <AuthField label="Nombre de usuario" value={username} onChange={setUsername} autoFocus autoComplete="username" />

        <AuthField
          label="Email"
          type="email"
          value={email}
          onChange={(v) => {
            if (!emailFixed) setEmail(v)
          }}
          autoComplete="email"
          readOnly={emailFixed}
          hint={emailFixed ? "Es el correo de tu invitación: no se puede cambiar." : undefined}
        />

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

        {/* Friday menu email (PRO-95): separate, optional, unticked (LSSI art. 21). */}
        <label className="flex min-h-[44px] cursor-pointer items-start gap-3 text-[14px] text-ink">
          <input
            type="checkbox"
            name="newsletterOptIn"
            checked={newsletterOptIn}
            onChange={(e) => setNewsletterOptIn(e.target.checked)}
            aria-describedby="register-newsletter-hint"
            className="mt-0.5 h-5 w-5 shrink-0 accent-ink"
          />
          <span>
            {NEWSLETTER_OPT_IN_LABEL}
            <span id="register-newsletter-hint" className="mt-0.5 block text-[12px] text-ink-muted">
              {NEWSLETTER_OPT_IN_HINT} Opcional; te das de baja con un clic.
            </span>
          </span>
        </label>

        <button
          type="submit"
          disabled={
            isSubmitting || !username || !email || !password || !ageConfirmed || entry.state === "loading" || entry.state === "error"
          }
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
