'use client'

/**
 * /whatsapp/conectar — WhatsApp-first linking.
 *
 * An unlinked number that writes to our WhatsApp gets a link here. Logged-out visitors
 * go to /login or /register with `?next=` back here. Logged in, the page mints
 * a one-time code and asks the user to send it FROM their WhatsApp (wa.me with
 * the message prefilled). The phone that sends the code is the one that gets
 * linked, so forwarding this link to someone else can't attach your phone to
 * their account (nor theirs to yours).
 *
 * Skin: "D · Luz y foto" (PRO-44) — compact header with the brand lockup, a
 * Fraunces 650 title and one central paper card with the steps and an ink pill.
 * At lg+ the title and the card sit side by side (max 1180 px).
 */

import { useEffect, useRef, type ReactNode } from 'react'
import { useAuth } from '@/lib/auth'
import { useWhatsAppLinkCode, useWhatsAppStatus } from '@/hooks/useWhatsApp'
import { MimoiaLogo } from '@/components/brand/Mimoia'

const TITLE = 'font-serif-text text-[30px] font-[650] leading-[1.1] text-ink lg:text-[44px] lg:leading-[1.05]'
const ACCENT = 'font-medium italic text-terracotta-deep'
const BODY = 'text-[15px] leading-relaxed text-ink-muted'
const CARD = 'rounded-[24px] border border-border-soft bg-paper p-5 lg:p-7'
const INK_PILL =
  'inline-flex min-h-[46px] items-center justify-center gap-2 rounded-full bg-ink px-[22px] text-[15px] font-semibold text-cream transition-colors hover:bg-ink-mid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink'
const TEXT_LINK =
  'inline-flex min-h-[44px] items-center justify-center px-3 text-[14px] font-medium text-ink-muted underline-offset-4 hover:text-ink hover:underline'

export default function WhatsAppConnectPage() {
  const { user, isLoading: authLoading } = useAuth()

  return (
    <div className="min-h-screen bg-cream pb-10">
      <header className="mx-auto flex max-w-[1180px] items-center px-5 pt-4 lg:px-8 lg:pt-8">
        <MimoiaLogo size={20} />
      </header>
      {authLoading ? (
        <Loading text="Cargando…" />
      ) : user ? (
        <LoggedIn username={user.username} />
      ) : (
        <LoggedOut />
      )}
    </div>
  )
}

/** Title block (eyebrow + h1 + intro) beside the paper card at lg+, stacked on mobile. */
function Layout({ title, intro, children }: { title: ReactNode; intro?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto grid max-w-[1180px] gap-6 px-5 pt-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,480px)] lg:items-center lg:gap-16 lg:px-8 lg:pt-20">
      <div className="flex flex-col gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-muted lg:text-[12px]">
          Mimo en WhatsApp
        </p>
        <h1 className={TITLE}>{title}</h1>
        {intro && <p className={`${BODY} max-w-md`}>{intro}</p>}
      </div>
      <section className={CARD}>{children}</section>
    </div>
  )
}

function Loading({ text }: { text: string }) {
  return (
    <div className="mx-auto max-w-[1180px] px-5 pt-10 lg:px-8" role="status">
      <p className={BODY}>{text}</p>
    </div>
  )
}

function LoggedOut() {
  const next = encodeURIComponent('/whatsapp/conectar')
  return (
    <Layout
      title={
        <>
          Conecta tu <span className={ACCENT}>WhatsApp</span>
        </>
      }
    >
      <p className={BODY}>Entra en tu cuenta de Mimoia (o créala) y vuelves aquí para terminar.</p>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
        <a href={`/login?next=${next}`} className={INK_PILL}>
          Iniciar sesión
        </a>
        <a href={`/register?next=${next}`} className={TEXT_LINK}>
          Crear cuenta
        </a>
      </div>
    </Layout>
  )
}

function LoggedIn({ username }: { username: string }) {
  const linkCode = useWhatsAppLinkCode()
  const pending = Boolean(linkCode.data)
  const status = useWhatsAppStatus({ pollWhilePending: pending })
  const requested = useRef(false)

  // Mint the code once the status says the channel is available and the
  // account isn't linked yet.
  useEffect(() => {
    if (requested.current || !status.data) return
    if (status.data.available && !status.data.linked) {
      requested.current = true
      linkCode.mutate()
    }
  }, [status.data, linkCode])

  if (status.isLoading) return <Loading text="Cargando…" />

  if (status.data?.linked) {
    return (
      <Layout
        title={
          <>
            ¡<span className={ACCENT}>Listo</span>!
          </>
        }
      >
        <p className={BODY}>
          Tu WhatsApp ({status.data.phone}) está conectado a <strong className="font-semibold text-ink">{username}</strong>.
          Pregúntame qué toca hoy, mándame audios o compárteme recetas.
        </p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
          {status.data.chatLink && (
            <a href={status.data.chatLink} className={INK_PILL}>
              Volver a WhatsApp
            </a>
          )}
          <a href="/profile" className={TEXT_LINK}>
            Ajustes de WhatsApp
          </a>
        </div>
      </Layout>
    )
  }

  if (status.data && !status.data.available) {
    return <Message title="Aún no disponible" body="WhatsApp todavía no está disponible para tu cuenta de Mimoia." />
  }

  if (linkCode.error || status.error) {
    return <Message title="No ha funcionado" body={(linkCode.error ?? status.error)?.message ?? 'Inténtalo de nuevo.'} />
  }

  if (!linkCode.data) return <Loading text="Preparando tu código…" />

  return (
    <Layout
      title={
        <>
          Último <span className={ACCENT}>paso</span>
        </>
      }
    >
      <ol className="flex flex-col gap-5">
        <li className="flex gap-4">
          <StepNumber n={1} />
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <p className={BODY}>
              Envía este mensaje a Mimo desde tu WhatsApp para conectarlo a{' '}
              <strong className="font-semibold text-ink">{username}</strong>:
            </p>
            <p
              data-testid="whatsapp-connect-message"
              className="rounded-[16px] border border-dashed border-border bg-cream px-4 py-3 font-mono text-[15px] tracking-wide break-words text-ink"
            >
              {linkCode.data.message}
            </p>
            {linkCode.data.waLink && (
              <a href={linkCode.data.waLink} className={`${INK_PILL} self-start`}>
                Enviar desde WhatsApp
              </a>
            )}
          </div>
        </li>
        <li className="flex gap-4">
          <StepNumber n={2} />
          <p className="flex-1 pt-1 text-[13px] leading-relaxed text-ink-muted" role="status">
            Esperando tu mensaje… el código caduca en 10 min.
          </p>
        </li>
      </ol>
    </Layout>
  )
}

/** Solid terracotta step number, like the recipe detail's steps. */
function StepNumber({ n }: { n: number }) {
  return (
    <span aria-hidden className="w-9 shrink-0 font-display text-[28px] leading-none text-terracotta">
      {String(n).padStart(2, '0')}
    </span>
  )
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <Layout title={title}>
      <p className={BODY}>{body}</p>
      <a href="/menu" className={`${INK_PILL} mt-5`}>
        Ir a Mimoia
      </a>
    </Layout>
  )
}
