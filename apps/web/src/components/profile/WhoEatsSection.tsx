"use client"

/**
 * «Quién come» (PRO-1203, maqueta del perfil 2026-11-12): one row per person
 * of the house — the members with an account and the people without one,
 * as in «Tu ficha» — with their age or «Adulto», their allergies and diet in
 * chips and, for a child, the school menu. A tap opens the person
 * (`/profile/quien/[id]`). What the counter had and nobody describes yet shows
 * as «Otro adulto» / «Un niño»: «Describir» turns it into that person, «No
 * está» takes it away. The size of the house (what the shopping list scales
 * by) comes from these people: the old «Adultos / Niños 2–10» counter is gone.
 */
import { useState } from "react"
import Link from "next/link"
import { ChevronRight, Plus, UserPlus } from "lucide-react"
import { PersonSheet } from "@/components/ficha/FichaSheets"
import { useSchoolMenu } from "@/hooks/useSchoolMenu"
import {
  useAddHouseholdPerson,
  useHouseholdPeople,
  useRemoveUndescribed,
  type PersonRow,
} from "@/hooks/useHouseholdPeople"
import { ApiError } from "@/lib/api"
import { ageBandPill } from "@/lib/ficha"
import { GroupLabel } from "@/app/profile/sections/ProfileCards"
import { SUB_LIST } from "@/components/profile/SubPage"

/** «Adulto · tú», «6–12 años», «Niñ@»: the second line of a row. */
export function personAgeLine(p: PersonRow): string {
  if (p.kind === "me") return p.role === "child" ? "Niñ@ · tú" : "Adulto · tú"
  if (p.kind === "member") return p.role === "child" ? "Niñ@ · con cuenta" : "Adulto · con cuenta"
  if (p.kind === "extra") return "Sin describir · cuenta para la compra"
  return p.ageBand ? ageBandPill(p.ageBand) : ""
}

/** «2 adultos y 1 niño»: what the shopping list and the menu count. */
export function countsLine(c: { adults: number; kidsCount: number }): string {
  const adults = `${c.adults} ${c.adults === 1 ? "adulto" : "adultos"}`
  if (c.kidsCount === 0) return adults
  return `${adults} y ${c.kidsCount} ${c.kidsCount === 1 ? "niño" : "niños"}`
}

function Initial({ name, muted }: { name: string; muted?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-serif-text text-[16px] font-[650] ${
        muted ? "border border-dashed border-border text-ink-muted" : "bg-cream-deep text-ink"
      }`}
    >
      {muted ? "?" : name.trim().charAt(0).toUpperCase()}
    </span>
  )
}

function Chips({ items }: { items: string[] }) {
  return (
    <span className="mt-1.5 flex flex-wrap gap-1">
      {items.map((r) => (
        <span key={r} className="rounded-full bg-warn-bg px-2.5 py-0.5 text-[12px] font-medium text-terracotta-deep">
          {r}
        </span>
      ))}
    </span>
  )
}

export function WhoEatsSection() {
  const people = useHouseholdPeople()
  const school = useSchoolMenu()
  const add = useAddHouseholdPerson()
  const removeExtra = useRemoveUndescribed()
  const [sheet, setSheet] = useState<{ open: boolean; band: string }>({ open: false, band: "" })
  const [error, setError] = useState<string | null>(null)

  const view = people.data
  const schoolConnected = (school.data?.days.length ?? 0) > 0

  function openAdd(band = "") {
    setError(null)
    setSheet({ open: true, band })
  }

  return (
    <section data-testid="who-eats" aria-labelledby="who-eats-title">
      <div className="flex items-center justify-between gap-3">
        <span id="who-eats-title">
          <GroupLabel>Quién come</GroupLabel>
        </span>
        {view?.canEdit && (
          <Link
            href="/profile/casa"
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-2 text-[13px] font-medium text-ink-mid hover:text-ink"
          >
            <UserPlus size={15} strokeWidth={1.8} aria-hidden="true" />
            Invitar
          </Link>
        )}
      </div>

      {people.isPending ? (
        <div aria-hidden="true" className="mt-2 h-[140px] rounded-[20px] bg-bone" />
      ) : people.isError || !view ? (
        <p className="mt-2 text-[13px] text-ink-muted">No hemos podido cargar quién come en casa. Vuelve a intentarlo.</p>
      ) : (
        <>
          <ul className={`${SUB_LIST} mt-2`}>
            {view.people.map((p) => {
              const line = personAgeLine(p)
              const kidSchool = p.group === "kid" && p.kind !== "extra" && school.data?.visible
              const sub = kidSchool ? `${line} · menú del cole ${schoolConnected ? "conectado" : "sin conectar"}` : line
              if (p.kind === "extra") {
                return (
                  <li key={p.id} data-testid="who-eats-extra" className="flex items-center gap-3 px-4 py-3">
                    <Initial name={p.name} muted />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-medium text-ink">{p.name}</span>
                      <span className="block text-[12.5px] text-ink-muted">{sub}</span>
                    </span>
                    {p.canEdit && (
                      <span className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          onClick={() => openAdd(p.group === "kid" ? "6-12" : "adulto")}
                          className="min-h-[44px] rounded-full px-3 text-[13px] font-medium text-ink underline underline-offset-4"
                        >
                          Describir
                        </button>
                        <button
                          type="button"
                          onClick={() => removeExtra.mutate(p.group === "kid" ? "kid" : "adult")}
                          disabled={removeExtra.isPending}
                          aria-label={`${p.name}: no está`}
                          className="min-h-[44px] rounded-full px-3 text-[13px] text-ink-muted hover:text-ink disabled:opacity-40"
                        >
                          No está
                        </button>
                      </span>
                    )}
                  </li>
                )
              }
              const chips = p.restrictions ?? []
              return (
                <li key={p.id}>
                  <Link
                    href={`/profile/quien/${p.id}`}
                    data-testid="who-eats-row"
                    className="flex min-h-[64px] items-center gap-3 px-4 py-3 transition-colors hover:bg-cream-deep/40"
                  >
                    <Initial name={p.name} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium text-ink">{p.name}</span>
                      <span className="block text-[12.5px] text-ink-muted">{sub}</span>
                      {chips.length > 0 && <Chips items={chips} />}
                      {p.kind === "member" && p.answered === false && (
                        <span className="mt-1 block text-[12.5px] text-terracotta-deep">Aún no nos ha dicho sus alergias</span>
                      )}
                    </span>
                    <ChevronRight size={18} strokeWidth={1.8} aria-hidden="true" className="shrink-0 text-ink-light" />
                  </Link>
                </li>
              )
            })}
            {view.canEdit && (
              <li>
                <button
                  type="button"
                  onClick={() => openAdd()}
                  className="flex min-h-[56px] w-full items-center gap-2 px-4 py-3 text-left text-[14px] font-medium text-ink hover:bg-cream-deep/40"
                >
                  <Plus size={16} strokeWidth={2} aria-hidden="true" />
                  Añadir a alguien que no usa Mimoia
                </button>
              </li>
            )}
          </ul>
          <p className="mt-2 text-[12.5px] leading-snug text-ink-muted">
            En cada persona: alergias y dieta, lo que no le gusta y, con su permiso, salud y objetivos. La compra y el
            menú, para {countsLine(view.counts)}.
          </p>
        </>
      )}

      <PersonSheet
        person={null}
        defaultAgeBand={sheet.band}
        open={sheet.open}
        onClose={() => setSheet({ open: false, band: "" })}
        saving={add.isPending}
        error={error}
        onSave={(input) => {
          setError(null)
          add.mutate(input, {
            onSuccess: () => setSheet({ open: false, band: "" }),
            onError: (e) => setError(e instanceof ApiError ? e.message : "No hemos podido añadirla. Inténtalo otra vez."),
          })
        }}
      />
    </section>
  )
}
