"use client"

/**
 * Lo que dice la Red al preparar los pedidos (specs/shop-orders.md → «Red de
 * tiendas»): el código postal si falta, la pregunta de una vez a quien tiene
 * súper, las tiendas asignadas solas (con «¿Prefieres otra?») y las que no se
 * asignan solas por halal o alergias.
 */
import { useState } from "react"
import type { RedKind, RedPrepareInfo } from "@ona/shared"
import { useRedChoice, useSetPostalCode } from "@/hooks/useRed"
import { ghostBtn, primaryBtn } from "./styles"

const NOUN: Record<RedKind, string> = { fruteria: "la fruta y la verdura", carniceria: "la carne", pescaderia: "el pescado" }
const SHOP: Record<RedKind, string> = { fruteria: "frutería", carniceria: "carnicería", pescaderia: "pescadería" }
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const box = "rounded-xl border border-[#2D6A4F]/30 bg-[#2D6A4F]/5 px-3 py-3 text-[13px] text-[#1A1612]"

export function RedPrepareNotes({ info, onChanged }: { info: RedPrepareInfo; onChanged: () => void }) {
  const choose = useRedChoice()
  const pick = (kind: RedKind, choice: "red" | "super", redShopId?: string) => choose.mutate({ kind, choice, redShopId }, { onSuccess: onChanged })
  if (!info.enabled) return null
  const pct = info.discountPct
  return (
    <div className="space-y-3" data-testid="red-notes">
      {info.needsPostalCode && <PostalCodeAsk pct={pct} onSaved={onChanged} />}

      {info.questions.map((q) => (
        <div key={q.kind} className={box} data-testid={`red-question-${q.kind}`}>
          <p>{cap(NOUN[q.kind])}, ¿a {q.redShop.name} (−{pct} %) o la sigues pidiendo en {q.superName}?</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button type="button" disabled={choose.isPending} className={primaryBtn} onClick={() => pick(q.kind, "red", q.redShop.id)}>
              A {q.redShop.name}
            </button>
            <button type="button" disabled={choose.isPending} className={ghostBtn} onClick={() => pick(q.kind, "super")}>
              En {q.superName}
            </button>
          </div>
        </div>
      ))}

      {info.assigned.map((a) => (
        <div key={a.kind} className={box} data-testid={`red-assigned-${a.kind}`}>
          <p>Tu {SHOP[a.kind]}: {a.name}, de la Red, con un {pct} % menos.</p>
          {a.alternatives.length > 0 && (
            <label className="mt-1 flex items-center gap-2 text-[12px] text-[#7A7066]">
              ¿Prefieres otra?
              <select
                className="border-b border-[#DDD6C5] bg-transparent text-[12px] text-[#1A1612]"
                value=""
                onChange={(e) => e.target.value && pick(a.kind, "red", e.target.value)}
              >
                <option value="">Elegir…</option>
                {a.alternatives.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      ))}

      {info.heldBack.map((h) => (
        <div key={h.kind} className={box} data-testid={`red-held-${h.kind}`}>
          <p>
            {h.reason === "halal"
              ? "Como en casa coméis halal, no os asignamos sola una carnicería de la Red."
              : `Por las alergias de casa, no os asignamos sola una ${SHOP[h.kind]} de la Red.`}{" "}
            A las tiendas de la Red todavía no les pasamos lo del halal ni las alergias: si la eliges, díselo tú al recoger.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {h.candidates.map((c) => (
              <button key={c.id} type="button" disabled={choose.isPending} className={ghostBtn} onClick={() => pick(h.kind, "red", c.id)}>
                Elegir {c.name}
              </button>
            ))}
          </div>
        </div>
      ))}

      {info.uncovered.length > 0 && (
        <p className="text-[12px] text-[#7A7066]">Aún no hay {info.uncovered.map((k) => SHOP[k]).join(", ")} de la Red en tu código postal.</p>
      )}
      {choose.error && <p role="alert" className="text-[12px] text-[#C65D38]">{choose.error.message}</p>}
    </div>
  )
}

function PostalCodeAsk({ pct, onSaved }: { pct: number; onSaved: () => void }) {
  const save = useSetPostalCode()
  const [code, setCode] = useState("")
  return (
    <form
      className={box}
      data-testid="red-postal-code"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate({ postalCode: code }, { onSuccess: onSaved })
      }}
    >
      <label htmlFor="red-cp" className="block">
        ¿Cuál es tu código postal? Así te buscamos tiendas de la Red en tu barrio, con un {pct} % menos.
      </label>
      <div className="mt-2 flex items-center gap-3">
        <input
          id="red-cp"
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={5}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          className="w-24 border-b border-[#DDD6C5] bg-transparent py-1 text-[14px] outline-none focus:border-[#1A1612]"
        />
        <button type="submit" disabled={code.length !== 5 || save.isPending} className={primaryBtn}>
          Guardar
        </button>
      </div>
      {save.error && <p role="alert" className="mt-1 text-[12px] text-[#C65D38]">{save.error.message}</p>}
    </form>
  )
}
