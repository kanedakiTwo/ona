"use client"

/**
 * «Mandar la lista» (PRO-380, D-158; specs/shopping.md): the list's main
 * button. What is left to buy goes out by aisle (`shoppingListShareText`)
 * and ends with the household's invitation, «Hecho con Mimo ·
 * mimoia.com/i/<code>» (PRO-162, PRO-1016). Options: on a phone, the system share sheet first; «Por
 * WhatsApp» (wa.me); «Copiar»; «Enviar a {súper}» when the browser extension
 * fills the household's súper; «Pedir a mi tienda» when it has shops. Each
 * send counts as `shopping_list_shared` (POST /usage/list-shared), which
 * makes the week a resolved one; the orders count by themselves when sent.
 */
import { useState } from "react"
import { Check, Copy, MessageCircle, Send, Share2, ShoppingCart, Store } from "lucide-react"
import { ingredientDisplayName, missingQuantity, shoppingListShareText, whatsappShareHref } from "@ona/shared"
import { api } from "@/lib/api"
import { haptic } from "@/lib/pwa/haptics"
import { useMediaQuery } from "@/hooks/useMediaQuery"
import { useShops } from "@/hooks/useShopOrders"
import { useBasketExtension } from "@/hooks/useBasketExtension"
import { useReferralLink } from "@/components/referrals/InviteHouseholdButton"
import { MenuSheet, SheetAction } from "@/components/menu/MenuSheet"
import { UNIT_LABEL, formatAmount } from "@/components/shopping/LineControls"

type Via = "whatsapp" | "copiar" | "compartir"

function countShare(via: Via) {
  void api.post("/usage/list-shared", { channel: "web", via }).catch(() => {})
}

/** Pending rows → lines with their amount as the list shows it (only the rest when part is at home). */
function shareLines(items: any[]) {
  return items.map((i) => {
    const qty = i.haveQuantity > 0 ? missingQuantity(i) : i.quantity
    const amountText = i.amountText ?? (qty && i.unit ? `${formatAmount(qty)} ${UNIT_LABEL[i.unit] ?? i.unit}` : null)
    return { name: ingredientDisplayName(i.name), aisle: i.aisle, amountText }
  })
}

export function SendListButton({ items, className = "" }: { items: any[]; className?: string }) {
  const [open, setOpen] = useState(false)
  const pending = items.filter((i) => !i.checked && !i.inStock && !i.skipped)
  return (
    <>
      <button
        type="button"
        disabled={pending.length === 0}
        onClick={() => {
          haptic.light()
          setOpen(true)
        }}
        aria-haspopup="dialog"
        data-testid="send-list"
        className={`inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full bg-ink px-6 text-[15px] font-semibold text-cream transition-colors hover:bg-ink-mid disabled:opacity-40 ${className}`}
      >
        <Send size={17} aria-hidden="true" /> Mandar la lista
      </button>
      <SendListSheet open={open} onClose={() => setOpen(false)} items={pending} />
    </>
  )
}

function SendListSheet({ open, onClose, items }: { open: boolean; onClose: () => void; items: any[] }) {
  const referral = useReferralLink()
  const { data: shops } = useShops()
  const superShop = (shops ?? []).find((s) => s.kind === "supermercado" && !!s.webUrl) ?? null
  const basket = useBasketExtension(superShop?.webUrl ?? null)
  const [copied, setCopied] = useState(false)
  // A phone with the system share sheet: that goes first (any app, not only WhatsApp).
  const coarse = useMediaQuery("(pointer: coarse)")
  const canShare = coarse && typeof navigator !== "undefined" && typeof navigator.share === "function"

  const text =
    typeof window === "undefined"
      ? ""
      : shoppingListShareText(shareLines(items), { origin: window.location.origin, code: referral.data?.code })
  const superLabel = basket.available ? basket.etiqueta ?? superShop?.name : null
  const otherShops = (shops ?? []).filter((s) => !(superLabel && s.id === superShop?.id))

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      countShare("copiar")
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard blocked: WhatsApp still works.
    }
  }

  async function nativeShare() {
    try {
      await navigator.share({ title: "Lista de la compra", text })
      countShare("compartir")
      onClose()
    } catch {
      // Dismissed: nothing was sent.
    }
  }

  return (
    <MenuSheet open={open} onClose={onClose} eyebrow="Lista de la compra" title="Mandar la lista">
      <div className="flex flex-col gap-0.5" data-testid="send-list-sheet">
        {canShare && (
          <SheetAction icon={Share2} label="Compartir" hint="A quien compra, en la app que quieras" onClick={() => void nativeShare()} testId="send-list-share" />
        )}
        <SheetAction
          icon={MessageCircle}
          label="Por WhatsApp"
          hint="Lo que falta, por pasillos"
          href={whatsappShareHref(text)}
          external
          disabled={referral.isLoading}
          onClick={() => {
            countShare("whatsapp")
            // After the browser has followed the link (closing at once could take it out first).
            setTimeout(onClose, 0)
          }}
          testId="send-list-whatsapp"
        />
        <SheetAction
          icon={copied ? Check : Copy}
          label={copied ? "Copiada" : "Copiar"}
          hint="Para pegarla donde quieras"
          disabled={referral.isLoading}
          onClick={() => void copy()}
          testId="send-list-copy"
        />
        {superLabel && (
          <SheetAction icon={ShoppingCart} label={`Enviar a ${superLabel}`} hint="Llena tu carro con lo que falta" href="/compra" testId="send-list-super" />
        )}
        {otherShops.length > 0 && (
          <SheetAction icon={Store} label="Pedir a mi tienda" hint="Un pedido por tienda, por WhatsApp" href="/compra" testId="send-list-shop" />
        )}
      </div>
    </MenuSheet>
  )
}
