"use client"

/**
 * QR for connecting WhatsApp from a computer (PRO-123, specs/whatsapp.md):
 * the same `wa.me` link as the button, with the code already written, so the
 * phone's camera opens the chat ready to send. Only on desktop (lg+); on a
 * phone the button is enough. Drawn locally (no third-party service).
 */
import { useEffect, useState } from "react"
import QRCode from "qrcode"

export function WhatsAppQr({ href }: { href: string }) {
  const [svg, setSvg] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    QRCode.toString(href, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#1A1612", light: "#FFFFFF" } })
      .then((s) => !cancelled && setSvg(s))
      .catch(() => !cancelled && setSvg(null))
    return () => {
      cancelled = true
    }
  }, [href])

  if (!svg) return null
  return (
    <figure data-testid="whatsapp-qr" data-href={href} className="hidden items-center gap-4 rounded-[16px] border border-border-soft bg-paper p-3 lg:flex">
      {/* The SVG is generated here from our own link, never from user input. */}
      <div className="h-32 w-32 shrink-0" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />
      <figcaption className="text-[13px] leading-snug text-ink-muted">
        ¿Estás en el ordenador? Escanea este código con la cámara del móvil: se abre WhatsApp con el mensaje ya escrito.
      </figcaption>
    </figure>
  )
}
