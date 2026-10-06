'use client'

/**
 * /whatsapp/conectar?t=<token> — WhatsApp-first linking.
 *
 * An unlinked number that writes to ONA gets this one-tap link. Possession of
 * the phone is proven by receiving the token over WhatsApp; the logged-in user
 * confirms here. The masked number is shown before confirming so a link
 * forwarded by someone else can't silently attach their phone to your account.
 * Logged-out visitors go to /login or /register with `?next=` back here.
 */

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'

interface TokenPreview {
  status: 'valid' | 'expired' | 'used'
  phone: string
  profileName: string | null
  available: boolean
}

interface ConfirmResult {
  linked: true
  phone: string
  chatLink: string | null
}

type View =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'preview'; preview: TokenPreview }
  | { kind: 'done'; result: ConfirmResult }

export default function WhatsAppConnectPage() {
  const { user, isLoading: authLoading } = useAuth()
  const [token, setToken] = useState<string | null>(null)
  const [view, setView] = useState<View>({ kind: 'loading' })
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get('t'))
  }, [])

  const load = useCallback(async (t: string) => {
    try {
      const preview = await api.get<TokenPreview>(`/whatsapp/phone-token/${encodeURIComponent(t)}`)
      setView({ kind: 'preview', preview })
    } catch (e: any) {
      setView({ kind: 'error', message: e?.message ?? 'El enlace no es válido.' })
    }
  }, [])

  useEffect(() => {
    if (authLoading || token === null) return
    if (!token) {
      setView({ kind: 'error', message: 'Falta el código del enlace.' })
      return
    }
    if (user) void load(token)
  }, [authLoading, user, token, load])

  async function handleConfirm() {
    if (!token) return
    setConfirming(true)
    try {
      const result = await api.post<ConfirmResult>(`/whatsapp/phone-token/${encodeURIComponent(token)}/confirm`)
      setView({ kind: 'done', result })
    } catch (e: any) {
      setView({ kind: 'error', message: e?.message ?? 'No se pudo conectar tu WhatsApp.' })
    } finally {
      setConfirming(false)
    }
  }

  const next = token ? `/whatsapp/conectar?t=${encodeURIComponent(token)}` : '/whatsapp/conectar'

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-[#FAF6EE] px-6 pb-24 text-center">
      <div className="text-eyebrow">Ona en WhatsApp</div>

      {(authLoading || (user && view.kind === 'loading') || token === null) && (
        <div className="text-[13px] text-[#7A7066]">Cargando…</div>
      )}

      {!authLoading && !user && token !== null && (
        <>
          <h1 className="font-display text-[2rem] leading-[1.05] text-[#1A1612] max-w-sm">
            Conecta tu <span className="italic text-[#C65D38]">WhatsApp</span>
          </h1>
          <p className="max-w-xs text-[13px] text-[#7A7066]">
            Entra en tu cuenta de ONA (o créala) y vuelves aquí para terminar.
          </p>
          <div className="flex flex-col items-center gap-3">
            <a
              href={`/login?next=${encodeURIComponent(next)}`}
              className="rounded-full bg-[#1A1612] px-8 py-3 text-[12px] uppercase tracking-[0.12em] text-[#FAF6EE] hover:bg-[#2D6A4F]"
            >
              Iniciar sesión
            </a>
            <a
              href={`/register?next=${encodeURIComponent(next)}`}
              className="text-[11px] uppercase tracking-[0.12em] text-[#7A7066] hover:text-[#1A1612]"
            >
              Crear cuenta
            </a>
          </div>
        </>
      )}

      {user && view.kind === 'preview' && view.preview.status === 'valid' && view.preview.available && (
        <>
          <h1 className="font-display text-[2rem] leading-[1.05] text-[#1A1612] max-w-sm">
            ¿Conectar <span className="italic text-[#C65D38]">este número</span>?
          </h1>
          <p data-testid="whatsapp-connect-phone" className="rounded-lg bg-[#F2EDE0] px-4 py-2 font-mono text-[15px] text-[#1A1612]">
            {view.preview.phone}
            {view.preview.profileName ? ` · ${view.preview.profileName}` : ''}
          </p>
          <p className="max-w-xs text-[13px] text-[#7A7066]">
            Se conectará a tu cuenta <strong className="text-[#1A1612]">{user.username}</strong>.
            Hazlo solo si este WhatsApp es tuyo: quien lo tenga podrá ver y cambiar tus menús.
          </p>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={confirming}
            className="rounded-full bg-[#1A1612] px-8 py-3 text-[12px] uppercase tracking-[0.12em] text-[#FAF6EE] hover:bg-[#2D6A4F] disabled:opacity-50"
          >
            {confirming ? 'Conectando…' : 'Sí, conectar'}
          </button>
          <a href="/menu" className="text-[11px] uppercase tracking-[0.12em] text-[#7A7066] hover:text-[#1A1612]">
            No es mío
          </a>
        </>
      )}

      {user && view.kind === 'preview' && view.preview.status === 'valid' && !view.preview.available && (
        <Message title="Aún no disponible" body="WhatsApp todavía no está disponible para tu cuenta de ONA." />
      )}

      {user && view.kind === 'preview' && view.preview.status !== 'valid' && (
        <Message
          title="Enlace caducado"
          body={
            view.preview.status === 'used'
              ? 'Este enlace ya se usó. Si tu WhatsApp no está conectado, escribe de nuevo a Ona y te mando otro.'
              : 'El enlace ha caducado. Escribe de nuevo a Ona por WhatsApp y te mando otro.'
          }
        />
      )}

      {view.kind === 'error' && <Message title="No ha funcionado" body={view.message} />}

      {view.kind === 'done' && (
        <>
          <h1 className="font-display text-[2rem] leading-[1.05] text-[#1A1612] max-w-sm">
            ¡<span className="italic text-[#2D6A4F]">Listo</span>!
          </h1>
          <p className="max-w-xs text-[13px] text-[#7A7066]">
            Tu WhatsApp ({view.result.phone}) ya está conectado. Te he escrito por allí: pregúntame qué
            toca hoy, mándame audios o compárteme recetas.
          </p>
          {view.result.chatLink && (
            <a
              href={view.result.chatLink}
              className="rounded-full bg-[#2D6A4F] px-8 py-3 text-[12px] uppercase tracking-[0.12em] text-[#FAF6EE] hover:opacity-90"
            >
              Volver a WhatsApp
            </a>
          )}
          <a href="/profile" className="text-[11px] uppercase tracking-[0.12em] text-[#7A7066] hover:text-[#1A1612]">
            Ajustes de WhatsApp
          </a>
        </>
      )}
    </div>
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
        Ir a ONA
      </a>
    </>
  )
}
