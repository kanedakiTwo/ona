"use client"

/**
 * /newsletter/comparte?c=<code>&k=lista|hogar — the «Copiar el enlace»
 * button of the newsletter's «Corre la voz» (PRO-1019, specs/newsletter.md).
 * An email can't copy, so it lands here: the person's own link, a copy
 * button and WhatsApp. The click was counted on the way (`/n/<issue>/42`);
 * nothing is counted or stored here. The link is the household's `/i/<code>`
 * for an account and the list's `?invita=<code>` for the waitlist.
 */

import { useEffect, useState } from "react"
import Link from "next/link"
import { Check, Copy, Send } from "lucide-react"
import {
  BRAND_NAME,
  inviteHouseholdShareText,
  normalizeReferralCode,
  waitlistReferralUrl,
  waitlistShareText,
  whatsappShareHref,
} from "@ona/shared"

type Share = { link: string; message: string }

function shareFor(origin: string, code: string, kind: string | null): Share {
  if (kind === "hogar") {
    const link = `${origin}/i/${code}`
    return { link, message: inviteHouseholdShareText(link) }
  }
  const link = waitlistReferralUrl(origin, code)
  return { link, message: waitlistShareText(link) }
}

export default function NewsletterSharePage() {
  const [share, setShare] = useState<Share | null | undefined>(undefined)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = normalizeReferralCode(params.get("c"))
    setShare(code ? shareFor(window.location.origin, code, params.get("k")) : null)
  }, [])

  async function copy() {
    if (!share) return
    try {
      await navigator.clipboard.writeText(share.link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard blocked: the link is on screen and WhatsApp still works.
    }
  }

  return (
    <div className="bg-[#FAF6EE] pb-24 pt-28 text-[#1A1612] md:pt-36">
      <div className="public-container">
        <div className="max-w-2xl" aria-live="polite">
          <div className="text-eyebrow mb-6">Corre la voz · {BRAND_NAME}</div>

          {share && (
            <>
              <h1 className="text-editorial-lg">Este es tu enlace</h1>
              <p className="mt-8 text-base leading-relaxed text-[#4A4239] md:text-lg">
                Mándaselo a otra casa a la que le vendría bien {BRAND_NAME}. Es personal: así sabemos que llega de tu
                parte.
              </p>
              <p
                data-testid="share-link"
                className="mt-8 break-all rounded-2xl border border-[#E8E2D3] bg-[#FFFEFA] px-5 py-4 text-base font-medium"
              >
                {share.link}
              </p>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={copy}
                  data-testid="share-copy"
                  className="inline-flex min-h-[48px] items-center gap-2.5 rounded-full bg-[#1A1612] px-7 text-base font-medium text-[#FAF6EE] transition-colors hover:bg-[#C65D38]"
                >
                  {copied ? <Check size={18} /> : <Copy size={18} />} {copied ? "Copiado" : "Copiar el enlace"}
                </button>
                <a
                  href={whatsappShareHref(share.message)}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="share-whatsapp"
                  className="inline-flex min-h-[48px] items-center gap-2.5 rounded-full border border-[#1A1612] px-7 text-base font-medium"
                >
                  <Send size={18} /> Compartir por WhatsApp
                </a>
              </div>
            </>
          )}

          {share === null && (
            <>
              <h1 className="text-editorial-lg">Este enlace no es válido.</h1>
              <p className="mt-8 text-base leading-relaxed text-[#4A4239]">
                Usa el botón del email tal cual. Si no funciona, escríbenos (el contacto está en la{" "}
                <Link href="/privacidad" className="underline underline-offset-4">
                  política de privacidad
                </Link>
                ).
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
