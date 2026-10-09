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
 * "Mimo en WhatsApp" block inside the WhatsApp card on /profile ("D · Luz y
 * foto", PRO-39: cream inset on the paper card, ink pills). Two states:
 *   - not linked → "Conectar WhatsApp" mints a one-time code and shows a
 *     wa.me link with it prefilled; the status polls until the phone sends it.
 *   - linked → masked number, "Abrir chat", proactive-messages toggle, disconnect.
 */
export function WhatsAppCard({ status }: { status: WhatsAppStatus }) {
  return status.linked ? <LinkedState status={status} /> : <UnlinkedState />
}

const PILL_INK =
  'inline-flex h-11 items-center rounded-full bg-ink px-5 text-[13px] font-medium text-cream transition-colors hover:bg-ink-mid active:scale-95 disabled:opacity-50'
const PILL_OUTLINE =
  'h-11 rounded-full border border-border bg-paper px-4 text-[13px] font-medium text-ink-muted transition-colors hover:text-ink active:scale-95'

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
    <div className="rounded-2xl border border-border-soft bg-cream p-4">
      <div className="flex items-start gap-3">
        <MessageCircle size={18} className="mt-0.5 shrink-0 text-ink-muted" />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-medium text-ink">Conecta tu WhatsApp</div>
          <div className="mt-1 text-[12px] leading-snug text-ink-muted">
            Pregúntale a Mimo qué toca hoy, pídele la lista de la compra,
            mándale notas de voz o compártele recetas (enlace o foto) para
            guardarlas.
          </div>

          {!pending || expired ? (
            <div className="mt-3">
              {expired && (
                <p className="mb-2 text-[12px] text-terracotta-deep">El código ha caducado. Genera otro.</p>
              )}
              <button
                type="button"
                onClick={handleConnect}
                disabled={linkCode.isPending}
                className={PILL_INK}
              >
                {linkCode.isPending ? 'Generando…' : 'Conectar WhatsApp'}
              </button>
              {linkCode.error && (
                <p className="mt-2 text-[12px] text-terracotta-deep">{linkCode.error.message}</p>
              )}
            </div>
          ) : (
            <div className="mt-3 border-t border-border-soft pt-3">
              <p className="text-[13px] text-ink">
                Envía este mensaje a Mimo desde tu WhatsApp:
              </p>
              <p
                data-testid="whatsapp-link-message"
                className="mt-2 inline-block rounded-lg border border-border-soft bg-paper px-3 py-1.5 font-mono text-[13px] tracking-wide text-ink"
              >
                {pending.message}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {pending.waLink && (
                  <a
                    href={pending.waLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={PILL_INK}
                  >
                    Abrir WhatsApp
                  </a>
                )}
                <span className="text-[12px] text-ink-muted">
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
    <div className="rounded-2xl border border-border-soft bg-cream p-4">
      <div className="flex items-start gap-3">
        <Check size={18} className="mt-0.5 shrink-0 text-ink" />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-medium text-ink">WhatsApp conectado</div>
          <div className="mt-0.5 text-[12px] text-ink-muted" data-testid="whatsapp-phone">
            {status.phone}
          </div>
          {status.chatLink && (
            <a
              href={status.chatLink}
              target="_blank"
              rel="noopener noreferrer"
              className={`mt-3 ${PILL_INK}`}
            >
              Abrir chat con Mimo
            </a>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => notify.mutate(!notifyOn)}
        className="mt-4 flex min-h-[56px] w-full items-center justify-between gap-3 border-t border-border-soft pt-4"
        aria-pressed={notifyOn}
      >
        <div className="text-left min-w-0">
          <div className="text-[14px] font-medium text-ink">Avisos por WhatsApp</div>
          <div className="text-[12px] leading-snug text-ink-muted">
            Resumen de la mañana, aviso para empezar a cocinar, “¿hiciste la cena?”,
            recordatorio de la compra y menú del domingo. Para quitar alguno, díselo a
            Mimo por WhatsApp (“no me mandes el resumen de la mañana”).
          </div>
        </div>
        <span
          className={`relative block h-6 w-11 shrink-0 rounded-full transition-colors ${
            notifyOn ? 'bg-ink' : 'bg-border'
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-paper shadow transition-[left] duration-200 ${
              notifyOn ? 'left-[22px]' : 'left-0.5'
            }`}
          />
        </span>
      </button>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {confirming ? (
          <>
            <span className="text-[13px] text-ink">¿Desconectar WhatsApp?</span>
            <button
              type="button"
              onClick={() => unlink.mutate(undefined, { onSettled: () => setConfirming(false) })}
              disabled={unlink.isPending}
              className="h-11 rounded-full border border-terracotta-deep bg-paper px-4 text-[13px] font-medium text-terracotta-deep transition-colors active:scale-95 disabled:opacity-50"
            >
              Sí, desconectar
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className={PILL_OUTLINE}
            >
              Cancelar
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className={PILL_OUTLINE}
          >
            Desconectar
          </button>
        )}
      </div>
    </div>
  )
}
