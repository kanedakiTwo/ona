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
 */

import { useEffect, useRef } from 'react'
import { useAuth } from '@/lib/auth'
import { useWhatsAppLinkCode, useWhatsAppStatus } from '@/hooks/useWhatsApp'

export default function WhatsAppConnectPage() {
  const { user, isLoading: authLoading } = useAuth()

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-[#FAF6EE] px-6 pb-24 text-center">
      <div className="text-eyebrow">Mimo en WhatsApp</div>
      {authLoading ? (
        <div className="text-[13px] text-[#7A7066]">Cargando…</div>
      ) : user ? (
        <LoggedIn username={user.username} />
      ) : (
        <LoggedOut />
      )}
    </div>
  )
}

function LoggedOut() {
  const next = encodeURIComponent('/whatsapp/conectar')
  return (
    <>
      <h1 className="font-display text-[2rem] leading-[1.05] text-[#1A1612] max-w-sm">
        Conecta tu <span className="italic text-[#C65D38]">WhatsApp</span>
      </h1>
      <p className="max-w-xs text-[13px] text-[#7A7066]">
        Entra en tu cuenta de Mimoia (o créala) y vuelves aquí para terminar.
      </p>
      <div className="flex flex-col items-center gap-3">
        <a
          href={`/login?next=${next}`}
          className="rounded-full bg-[#1A1612] px-8 py-3 text-[12px] uppercase tracking-[0.12em] text-[#FAF6EE] hover:bg-[#2D6A4F]"
        >
          Iniciar sesión
        </a>
        <a
          href={`/register?next=${next}`}
          className="text-[11px] uppercase tracking-[0.12em] text-[#7A7066] hover:text-[#1A1612]"
        >
          Crear cuenta
        </a>
      </div>
    </>
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

  if (status.isLoading) return <div className="text-[13px] text-[#7A7066]">Cargando…</div>

  if (status.data?.linked) {
    return (
      <>
        <h1 className="font-display text-[2rem] leading-[1.05] text-[#1A1612] max-w-sm">
          ¡<span className="italic text-[#2D6A4F]">Listo</span>!
        </h1>
        <p className="max-w-xs text-[13px] text-[#7A7066]">
          Tu WhatsApp ({status.data.phone}) está conectado a <strong className="text-[#1A1612]">{username}</strong>.
          Pregúntame qué toca hoy, mándame audios o compárteme recetas.
        </p>
        {status.data.chatLink && (
          <a
            href={status.data.chatLink}
            className="rounded-full bg-[#2D6A4F] px-8 py-3 text-[12px] uppercase tracking-[0.12em] text-[#FAF6EE] hover:opacity-90"
          >
            Volver a WhatsApp
          </a>
        )}
        <a href="/profile" className="text-[11px] uppercase tracking-[0.12em] text-[#7A7066] hover:text-[#1A1612]">
          Ajustes de WhatsApp
        </a>
      </>
    )
  }

  if (status.data && !status.data.available) {
    return <Message title="Aún no disponible" body="WhatsApp todavía no está disponible para tu cuenta de Mimoia." />
  }

  if (linkCode.error || status.error) {
    return <Message title="No ha funcionado" body={(linkCode.error ?? status.error)?.message ?? 'Inténtalo de nuevo.'} />
  }

  if (!linkCode.data) return <div className="text-[13px] text-[#7A7066]">Preparando tu código…</div>

  return (
    <>
      <h1 className="font-display text-[2rem] leading-[1.05] text-[#1A1612] max-w-sm">
        Último <span className="italic text-[#C65D38]">paso</span>
      </h1>
      <p className="max-w-xs text-[13px] text-[#7A7066]">
        Envía este mensaje a Mimo desde tu WhatsApp para conectarlo a <strong className="text-[#1A1612]">{username}</strong>:
      </p>
      <p
        data-testid="whatsapp-connect-message"
        className="rounded-lg bg-[#F2EDE0] px-4 py-2 font-mono text-[15px] tracking-wide text-[#1A1612]"
      >
        {linkCode.data.message}
      </p>
      {linkCode.data.waLink && (
        <a
          href={linkCode.data.waLink}
          className="rounded-full bg-[#2D6A4F] px-8 py-3 text-[12px] uppercase tracking-[0.12em] text-[#FAF6EE] hover:opacity-90"
        >
          Enviar desde WhatsApp
        </a>
      )}
      <p className="text-[11px] text-[#7A7066]">Esperando tu mensaje… el código caduca en 10 min.</p>
    </>
  )
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <>
      <div className="font-display text-2xl text-[#1A1612]">{title}</div>
      <p className="max-w-xs text-[13px] text-[#7A7066]">{body}</p>
      <a
        href="/menu"
        className="mt-3 rounded-full bg-[#1A1612] px-5 py-2 text-[12px] uppercase tracking-[0.12em] text-[#FAF6EE]"
      >
        Ir a Mimoia
      </a>
    </>
  )
}
