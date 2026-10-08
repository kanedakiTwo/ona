'use client'

import { useEffect, useState } from 'react'
import { MessageCircle, Check } from 'lucide-react'
import {
  useWhatsAppLinkCode,
  useWhatsAppNotify,
  useWhatsAppStatus,
  useWhatsAppUnlink,
  type WhatsAppLinkCode,
  type WhatsAppStatus,
} from '@/hooks/useWhatsApp'

/**
 * "Mimo en WhatsApp" card on /profile. Two states:
 *   - not linked → "Conectar WhatsApp" mints a one-time code and shows a
 *     wa.me link with it prefilled; the status polls until the phone sends it.
 *   - linked → masked number, "Abrir chat", proactive-messages toggle, disconnect.
 */
export function WhatsAppCard({ status }: { status: WhatsAppStatus }) {
  return status.linked ? <LinkedState status={status} /> : <UnlinkedState />
}

function UnlinkedState() {
  const linkCode = useWhatsAppLinkCode()
  const [pending, setPending] = useState<WhatsAppLinkCode | null>(null)
  // Poll /whatsapp/status while a code is out; the card flips to the linked
  // state by itself once the message arrives from the phone.
  useWhatsAppStatus({ pollWhilePending: Boolean(pending) })

  const expired = pending ? new Date(pending.expiresAt).getTime() < Date.now() : false
  const [, forceTick] = useState(0)
  useEffect(() => {
    if (!pending) return
    const t = setInterval(() => forceTick((n) => n + 1), 15_000)
    return () => clearInterval(t)
  }, [pending])

  async function handleConnect() {
    const res = await linkCode.mutateAsync().catch(() => null)
    if (res) setPending(res)
  }

  return (
    <div className="rounded-2xl bg-[#FFFEFA] border border-[#DDD6C5] p-4">
      <div className="flex items-start gap-3">
        <MessageCircle size={18} className="mt-0.5 shrink-0 text-[#7A7066]" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-[#1A1612]">Conecta tu WhatsApp</div>
          <div className="mt-1 text-[11px] leading-snug text-[#7A7066]">
            Pregúntale a Mimo qué toca hoy, pídele la lista de la compra,
            mándale notas de voz o compártele recetas (enlace o foto) para
            guardarlas.
          </div>

          {!pending || expired ? (
            <div className="mt-3">
              {expired && (
                <p className="mb-2 text-[11px] text-[#C65D38]">El código ha caducado. Genera otro.</p>
              )}
              <button
                type="button"
                onClick={handleConnect}
                disabled={linkCode.isPending}
                className="rounded-full bg-[#1A1612] px-3.5 py-1.5 text-[11px] font-medium uppercase tracking-[0.1em] text-[#FAF6EE] transition-all hover:bg-[#2D6A4F] active:scale-95 disabled:opacity-50"
              >
                {linkCode.isPending ? 'Generando…' : 'Conectar WhatsApp'}
              </button>
              {linkCode.error && (
                <p className="mt-2 text-[11px] text-[#C65D38]">{linkCode.error.message}</p>
              )}
            </div>
          ) : (
            <div className="mt-3 border-t border-[#DDD6C5] pt-3">
              <p className="text-[12px] text-[#1A1612]">
                Envía este mensaje a Mimo desde tu WhatsApp:
              </p>
              <p
                data-testid="whatsapp-link-message"
                className="mt-2 inline-block rounded-lg bg-[#F2EDE0] px-3 py-1.5 font-mono text-[13px] tracking-wide text-[#1A1612]"
              >
                {pending.message}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {pending.waLink && (
                  <a
                    href={pending.waLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-full bg-[#2D6A4F] px-3.5 py-1.5 text-[11px] font-medium uppercase tracking-[0.1em] text-[#FAF6EE] transition-all hover:opacity-90 active:scale-95"
                  >
                    Abrir WhatsApp
                  </a>
                )}
                <span className="text-[11px] text-[#7A7066]">
                  Esperando tu mensaje… caduca en 10 min.
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function LinkedState({ status }: { status: WhatsAppStatus }) {
  const notify = useWhatsAppNotify()
  const unlink = useWhatsAppUnlink()
  const [confirming, setConfirming] = useState(false)
  const notifyOn = notify.isPending ? notify.variables ?? status.notify : status.notify

  return (
    <div className="rounded-2xl bg-[#FFFEFA] border border-[#DDD6C5] p-4">
      <div className="flex items-start gap-3">
        <Check size={18} className="mt-0.5 shrink-0 text-[#2D6A4F]" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-[#1A1612]">WhatsApp conectado</div>
          <div className="mt-0.5 text-[11px] text-[#7A7066]" data-testid="whatsapp-phone">
            {status.phone}
          </div>
          {status.chatLink && (
            <a
              href={status.chatLink}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-block rounded-full bg-[#2D6A4F] px-3.5 py-1.5 text-[11px] font-medium uppercase tracking-[0.1em] text-[#FAF6EE] transition-all hover:opacity-90 active:scale-95"
            >
              Abrir chat con Mimo
            </a>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => notify.mutate(!notifyOn)}
        className="mt-4 flex w-full items-center justify-between gap-3 border-t border-[#DDD6C5] pt-4"
        aria-pressed={notifyOn}
      >
        <div className="text-left min-w-0">
          <div className="text-[13px] font-medium text-[#1A1612]">Avisos por WhatsApp</div>
          <div className="text-[11px] leading-snug text-[#7A7066]">
            Resumen de la mañana, aviso para empezar a cocinar, “¿hiciste la cena?”,
            recordatorio de la compra y menú del domingo. Para quitar alguno, díselo a
            Mimo por WhatsApp (“no me mandes el resumen de la mañana”).
          </div>
        </div>
        <span
          className={`relative block h-6 w-11 shrink-0 rounded-full transition-colors ${
            notifyOn ? 'bg-[#1A1612]' : 'bg-[#DDD6C5]'
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left] duration-200 ${
              notifyOn ? 'left-[22px]' : 'left-0.5'
            }`}
          />
        </span>
      </button>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {confirming ? (
          <>
            <span className="text-[11px] text-[#1A1612]">¿Desconectar WhatsApp?</span>
            <button
              type="button"
              onClick={() => unlink.mutate(undefined, { onSettled: () => setConfirming(false) })}
              disabled={unlink.isPending}
              className="rounded-full border border-[#C65D38] bg-[#FFFEFA] px-3 py-1.5 text-[11px] font-medium text-[#C65D38] transition-all active:scale-95 disabled:opacity-50"
            >
              Sí, desconectar
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-full border border-[#DDD6C5] bg-[#FFFEFA] px-3 py-1.5 text-[11px] font-medium text-[#7A7066] active:scale-95"
            >
              Cancelar
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded-full border border-[#DDD6C5] bg-[#FFFEFA] px-3 py-1.5 text-[11px] font-medium text-[#7A7066] transition-all hover:text-[#1A1612] active:scale-95"
          >
            Desconectar
          </button>
        )}
      </div>
    </div>
  )
}
