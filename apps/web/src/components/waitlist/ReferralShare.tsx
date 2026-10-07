"use client"

import { useRef, useState } from "react"
import { Check, Copy, MessageCircle } from "lucide-react"
import { waitlistShareText, whatsappShareHref } from "@ona/shared"

/**
 * The personal waitlist link + "Copiar enlace" + "Enviar por WhatsApp"
 * (specs/waitlist.md). Used on the landing's success state and on
 * /lista/[code]. `tone="dark"` for ink backgrounds.
 */
export default function ReferralShare({ url, tone = "light" }: { url: string; tone?: "light" | "dark" }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [copied, setCopied] = useState<"ok" | "manual" | null>(null)

  async function copy() {
    if (await copyText(url)) {
      setCopied("ok")
      setTimeout(() => setCopied(null), 2500)
      return
    }
    // Last resort: leave the link selected so a long-press / Ctrl+C copies it.
    inputRef.current?.focus()
    inputRef.current?.select()
    setCopied("manual")
  }

  const dark = tone === "dark"
  return (
    <div>
      <label className="sr-only" htmlFor="waitlist-referral-url">
        Tu enlace personal
      </label>
      <input
        ref={inputRef}
        id="waitlist-referral-url"
        data-testid="waitlist-referral-url"
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        className={`w-full rounded-2xl border px-4 py-3 font-mono text-[13px] ${
          dark ? "border-[#FAF6EE]/20 bg-[#FAF6EE]/5 text-[#FAF6EE]" : "border-[#DDD6C5] bg-[#FAF6EE] text-[#1A1612]"
        }`}
      />
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={copy}
          className={`inline-flex flex-1 items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-medium transition-colors ${
            dark
              ? "bg-[#FAF6EE] text-[#1A1612] hover:bg-[#E0917D]"
              : "bg-[#1A1612] text-[#FAF6EE] hover:bg-[#2D6A4F]"
          }`}
        >
          {copied === "ok" ? <Check size={16} /> : <Copy size={16} />}
          {copied === "ok" ? "¡Copiado!" : "Copiar enlace"}
        </button>
        <a
          href={whatsappShareHref(waitlistShareText(url))}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex flex-1 items-center justify-center gap-2 rounded-full border px-5 py-3 text-sm font-medium transition-colors ${
            dark
              ? "border-[#FAF6EE]/40 text-[#FAF6EE] hover:border-[#FAF6EE]"
              : "border-[#1A1612] text-[#1A1612] hover:bg-[#1A1612] hover:text-[#FAF6EE]"
          }`}
        >
          <MessageCircle size={16} />
          Enviar por WhatsApp
        </a>
      </div>
      <p aria-live="polite" className={`mt-2 min-h-[1.25rem] text-xs ${dark ? "text-[#FAF6EE]/60" : "text-[#7A7066]"}`}>
        {copied === "manual" ? "Tu navegador no nos deja copiar: el enlace está seleccionado, cópialo a mano." : ""}
      </p>
    </div>
  )
}

/** Clipboard API, then the old execCommand trick (older iOS / non-secure contexts). */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement("textarea")
    ta.value = text
    ta.setAttribute("readonly", "")
    ta.style.position = "fixed"
    ta.style.opacity = "0"
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand("copy")
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
