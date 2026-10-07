"use client"

/**
 * /compra/tiendas — the household's shops (specs/shop-orders.md). ONA
 * routes each shopping-list line to one of these: fruta y verdura → la
 * frutería, carne → la carnicería, pescado → la pescadería, el resto → el
 * súper.
 */
import { useState } from "react"
import Link from "next/link"
import { ChevronLeft, MessageCircle, Mail, Globe, Phone, Pencil, Plus, Trash2 } from "lucide-react"
import { SHOP_KIND_LABELS, type Shop } from "@ona/shared"
import { useAuth } from "@/lib/auth"
import { useDeleteShop, useShops } from "@/hooks/useShopOrders"
import { ShopForm } from "@/components/compra/ShopForm"

function contactOf(s: Shop): { icon: React.ReactNode; text: string } {
  switch (s.channel) {
    case "whatsapp":
      return { icon: <MessageCircle size={12} />, text: `WhatsApp +${s.whatsapp}` }
    case "email":
      return { icon: <Mail size={12} />, text: s.email ?? "" }
    case "web":
      return { icon: <Globe size={12} />, text: s.webUrl?.replace(/^https?:\/\//, "") ?? "" }
    case "telefono":
      return { icon: <Phone size={12} />, text: `+${s.phone}` }
  }
}

export default function ShopsPage() {
  const { user } = useAuth()
  const { data: shops, isLoading } = useShops()
  const del = useDeleteShop()
  const [editing, setEditing] = useState<Shop | "new" | null>(null)

  if (!user) return null

  return (
    <div className="bg-[#FAF6EE] min-h-screen pb-24 lg:mx-auto lg:max-w-[900px]">
      <header className="px-5 pt-8 pb-6">
        <Link href="/compra" className="inline-flex items-center gap-1 text-eyebrow text-[#7A7066] hover:text-[#C65D38]">
          <ChevronLeft size={14} /> Volver a la compra
        </Link>
        <div className="mt-3 text-eyebrow">Dónde compras</div>
        <h1 className="mt-1 font-display text-[2.2rem] leading-[0.95] text-[#1A1612]">
          Tus <span className="italic text-[#C65D38]">tiendas</span>.
        </h1>
        <p className="mt-3 max-w-md text-[12px] text-[#7A7066]">
          ONA reparte tu lista entre ellas: fruta y verdura a la frutería, carne a la carnicería, pescado a la pescadería y
          el resto al súper. Si falta una, lo suyo va al súper.
        </p>
      </header>

      <section className="px-5 space-y-3">
        {isLoading ? (
          <div className="py-10 text-center font-italic italic text-[#7A7066]">Cargando…</div>
        ) : (
          <ul className="space-y-3">
            {(shops ?? []).map((s) =>
              editing !== "new" && editing?.id === s.id ? (
                <li key={s.id}>
                  <ShopForm shop={s} onDone={() => setEditing(null)} />
                </li>
              ) : (
                <li key={s.id} className="flex items-start justify-between gap-3 rounded-2xl border border-[#DDD6C5] bg-[#FFFEFA] px-4 py-3">
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-[0.14em] text-[#C65D38]">{SHOP_KIND_LABELS[s.kind]}</div>
                    <div className="font-display text-[18px] leading-tight text-[#1A1612]">{s.name}</div>
                    <div className="mt-1 flex items-center gap-1.5 text-[12px] text-[#7A7066]">
                      {contactOf(s).icon}
                      <span className="truncate">{contactOf(s).text}</span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-[#A39A8E]">
                      {s.fulfilment === "domicilio" ? `A domicilio · ${s.address}` : "Recoges en tienda"}
                      {s.customerName ? ` · te conocen como ${s.customerName}` : ""}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button aria-label={`Editar ${s.name}`} onClick={() => setEditing(s)} className="rounded-full p-2 text-[#7A7066] hover:bg-[#F2EDE0] hover:text-[#1A1612]">
                      <Pencil size={14} />
                    </button>
                    <button
                      aria-label={`Borrar ${s.name}`}
                      onClick={() => {
                        if (typeof window === "undefined" || window.confirm(`¿Borrar ${s.name} de tus tiendas?`)) del.mutate({ id: s.id })
                      }}
                      className="rounded-full p-2 text-[#7A7066] hover:bg-[#F2EDE0] hover:text-[#C65D38]"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </li>
              ),
            )}
          </ul>
        )}

        {editing === "new" ? (
          <ShopForm onDone={() => setEditing(null)} />
        ) : (
          <button
            onClick={() => setEditing("new")}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-[#DDD6C5] py-4 text-[13px] text-[#1A1612] hover:border-[#1A1612]"
          >
            <Plus size={14} /> Añadir tienda
          </button>
        )}
      </section>
    </div>
  )
}
