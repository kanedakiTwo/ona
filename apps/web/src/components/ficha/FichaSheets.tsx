"use client"

/**
 * «Tu ficha» sheets (PRO-318), on the app's `MenuSheet` (bottom sheet on
 * phones, centred dialog at lg+, Esc closes, focus comes back):
 *
 * - `WhySheet` «¿Por qué lo sé?» — asks `…/facts/:id/why` when it opens:
 *   where the fact comes from, how sure Mimo is, since when, what it saw and
 *   «Cómo lo uso»; «Así es» / «Corregir» / «Olvidar» only when the reader may
 *   change it (`canEdit`).
 * - `CorrectSheet` «Corregir» — «¿Cómo es en realidad?» in their words, and
 *   until when («Siempre» / «Hasta una fecha»).
 * - `PersonSheet` — a person of the house without an account: alias and age
 *   band. The API's own message (422) is shown as it comes (a minor only with
 *   a generic alias).
 */
import { useEffect, useId, useState, type FormEvent } from "react"
import type { FichaFactView, FichaPersonView } from "@ona/shared"
import { MenuSheet } from "@/components/menu/MenuSheet"
import { useFichaWhy } from "@/hooks/useFicha"
import { AGE_BANDS, ageBandPill, endOfDayIso, localDay, longDate, shortDate, todayLocal } from "@/lib/ficha"
import { OriginBadge, TemporaryBadge } from "./FichaUI"

const SHEET_PILL = "flex min-h-[48px] items-center justify-center rounded-full px-5 text-[15px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-40"
const PILL_INK = `${SHEET_PILL} bg-ink text-cream hover:bg-ink-mid`
const PILL_OUTLINE = `${SHEET_PILL} border border-ink bg-transparent text-ink hover:bg-cream-deep`
const PILL_DANGER_TEXT = `${SHEET_PILL} text-terracotta-deep hover:bg-warn-bg`
const LABEL = "text-[14px] font-semibold text-ink"
const FIELD =
  "w-full rounded-[10px] border border-border bg-paper px-3.5 text-[16px] leading-[1.5] text-ink placeholder:text-ink-light focus:border-ink focus:outline-none"

function SheetError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="rounded-[10px] bg-warn-bg px-3.5 py-2.5 text-[14px] leading-snug text-warn-text">
      {message}
    </p>
  )
}

export function WhySheet({
  fact,
  open,
  onClose,
  onConfirm,
  onCorrect,
  onForget,
  confirming,
  error,
  ownerName,
}: {
  fact: FichaFactView
  open: boolean
  onClose: () => void
  onConfirm: () => void
  onCorrect: () => void
  onForget: () => void
  confirming: boolean
  error: string | null
  /** Who changes it when the reader can't (another member's fact). */
  ownerName: string | null
}) {
  const why = useFichaWhy(open ? fact.id : null)
  const data = why.data
  const meta = data ? [data.confidence, `${data.confidence ? "desde" : "Desde"} el ${longDate(data.since)}`].filter(Boolean).join(" · ") : null

  return (
    <MenuSheet open={open} onClose={onClose} eyebrow="¿Por qué lo sé?" title={fact.sentence}>
      <div className="flex flex-col gap-[18px]" data-testid="ficha-why">
        <div className="-mt-1 flex flex-wrap items-center gap-1.5">
          <OriginBadge origin={fact.origin} label={fact.originLabel} />
          {fact.temporary && <TemporaryBadge />}
          {meta && <span className="text-[13px] text-ink-muted">{meta}</span>}
        </div>

        {why.isPending && (
          <div className="flex animate-pulse flex-col gap-2.5" aria-hidden="true">
            <div className="h-4 w-1/3 rounded-full bg-bone" />
            <div className="h-4 w-full rounded-full bg-bone" />
            <div className="h-4 w-4/5 rounded-full bg-bone" />
          </div>
        )}
        {why.isError && (
          <div role="alert" className="flex flex-col items-start gap-2">
            <p className="text-[14px] text-ink-mid">No hemos podido cargar por qué lo sé.</p>
            <button type="button" onClick={() => void why.refetch()} className={`${PILL_OUTLINE} min-h-[44px] text-[14px]`}>
              Reintentar
            </button>
          </div>
        )}

        {data && data.evidence.length > 0 && (
          <div className="flex flex-col gap-2.5">
            <h3 className="text-[13px] font-semibold text-ink-mid">Lo que he visto</h3>
            <ol className="flex flex-col gap-2.5">
              {data.evidence.map((e, i) => (
                <li key={`${e.date}-${i}`} className="flex gap-3 text-[14.5px] leading-[1.45] text-ink">
                  <span className="w-[52px] shrink-0 text-ink-muted">{shortDate(e.date)}</span>
                  <span className="min-w-0 [overflow-wrap:anywhere]">{e.text}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {data && (
          <div className="flex flex-col gap-1 rounded-[10px] bg-cream-deep px-3.5 py-3">
            <h3 className="text-[13px] font-semibold text-ink-mid">Cómo lo uso</h3>
            <p className="text-[14.5px] leading-[1.45] text-ink">{data.howIUse}</p>
          </div>
        )}

        <SheetError message={error} />

        {fact.canEdit ? (
          <div className="flex flex-col gap-2">
            {/* What the reader said is theirs already: «Así es» only for what Mimo deduced, the sign-up or someone else wrote. */}
            {fact.origin !== "tu" && (
              <button type="button" onClick={onConfirm} disabled={confirming} className={`${PILL_INK} w-full`}>
                {confirming ? "Guardando…" : "Así es"}
              </button>
            )}
            <div className="flex gap-2">
              <button type="button" onClick={onCorrect} className={`${PILL_OUTLINE} flex-1`}>
                Corregir
              </button>
              <button type="button" onClick={onForget} className={`${PILL_DANGER_TEXT} flex-1`}>
                Olvidar
              </button>
            </div>
          </div>
        ) : (
          <p className="text-[14px] leading-snug text-ink-muted">
            Esto lo cambia {ownerName ?? "esa persona"} desde su ficha.
          </p>
        )}
      </div>
    </MenuSheet>
  )
}

export function CorrectSheet({
  fact,
  open,
  onClose,
  onSave,
  saving,
  error,
}: {
  fact: FichaFactView
  open: boolean
  onClose: () => void
  onSave: (input: { text: string; validUntil: string | null }) => void
  saving: boolean
  error: string | null
}) {
  const textId = useId()
  const hintId = useId()
  const [text, setText] = useState("")
  const [until, setUntil] = useState<"siempre" | "fecha">(fact.validUntil ? "fecha" : "siempre")
  const [day, setDay] = useState(fact.validUntil ? localDay(fact.validUntil) : "")

  // A new fact opens a clean form.
  useEffect(() => {
    if (!open) return
    setText("")
    setUntil(fact.validUntil ? "fecha" : "siempre")
    setDay(fact.validUntil ? localDay(fact.validUntil) : "")
  }, [open, fact.id, fact.validUntil])

  const ready = text.trim().length >= 2 && (until === "siempre" || !!day)

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!ready || saving) return
    onSave({ text: text.trim(), validUntil: until === "fecha" ? endOfDayIso(day) : null })
  }

  return (
    <MenuSheet open={open} onClose={onClose} eyebrow="Corregir" title={fact.sentence}>
      <form onSubmit={submit} className="flex flex-col gap-[18px]" data-testid="ficha-correct">
        <div className="flex flex-col gap-2">
          <label htmlFor={textId} className={LABEL}>
            ¿Cómo es en realidad?
          </label>
          <textarea
            id={textId}
            rows={4}
            value={text}
            maxLength={600}
            onChange={(e) => setText(e.target.value)}
            aria-describedby={hintId}
            className={`${FIELD} resize-none py-3`}
          />
          <p id={hintId} className="text-[13.5px] leading-[1.45] text-ink-muted">
            Escríbelo como se lo dirías a alguien de casa. Lo apunto así y manda sobre lo que yo deduje.
          </p>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className={`${LABEL} pb-2`}>¿Hasta cuándo?</legend>
          <div className="flex flex-wrap gap-2">
            <ChoicePill name={`hasta-${fact.id}`} checked={until === "siempre"} onChange={() => setUntil("siempre")}>
              Siempre
            </ChoicePill>
            <ChoicePill name={`hasta-${fact.id}`} checked={until === "fecha"} onChange={() => setUntil("fecha")}>
              Hasta una fecha
            </ChoicePill>
          </div>
          {until === "fecha" && (
            <input
              type="date"
              value={day}
              min={todayLocal()}
              onChange={(e) => setDay(e.target.value)}
              aria-label="Hasta qué fecha"
              required
              className={`${FIELD} mt-1 min-h-[44px] max-w-[220px]`}
            />
          )}
        </fieldset>

        <SheetError message={error} />

        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className={`${PILL_OUTLINE} flex-1`}>
            Cancelar
          </button>
          <button type="submit" disabled={!ready || saving} className={`${PILL_INK} flex-1`}>
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </form>
    </MenuSheet>
  )
}

/** A native radio dressed as a pill (ink when picked), 44 px tall. */
function ChoicePill({
  name,
  checked,
  onChange,
  children,
}: {
  name: string
  checked: boolean
  onChange: () => void
  children: React.ReactNode
}) {
  return (
    <label
      className={`inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-full px-3.5 text-[14px] font-medium transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink ${
        checked ? "bg-ink text-cream" : "border border-border bg-paper text-ink hover:border-ink"
      }`}
    >
      <input type="radio" name={name} checked={checked} onChange={onChange} className={`m-0 h-4 w-4 ${checked ? "accent-cream" : "accent-ink"}`} />
      {children}
    </label>
  )
}

export function PersonSheet({
  person,
  open,
  onClose,
  onSave,
  saving,
  error,
}: {
  /** null = a new person. */
  person: FichaPersonView | null
  open: boolean
  onClose: () => void
  onSave: (input: { alias: string; ageBand: string }) => void
  saving: boolean
  error: string | null
}) {
  const aliasId = useId()
  const noteId = useId()
  const [alias, setAlias] = useState(person?.label ?? "")
  const [band, setBand] = useState<string>(person?.ageBand ?? "")

  useEffect(() => {
    if (!open) return
    setAlias(person?.label ?? "")
    setBand(person?.ageBand ?? "")
  }, [open, person?.key, person?.label, person?.ageBand])

  const ready = alias.trim().length > 0 && !!band

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!ready || saving) return
    onSave({ alias: alias.trim(), ageBand: band })
  }

  return (
    <MenuSheet
      open={open}
      onClose={onClose}
      eyebrow={person ? "Editar" : "Persona sin cuenta"}
      title={person ? person.label : "Añadir una persona de la casa"}
    >
      <form onSubmit={submit} className="flex flex-col gap-[18px]" data-testid="ficha-person-form">
        <div className="flex flex-col gap-2">
          <label htmlFor={aliasId} className={LABEL}>
            Apodo
          </label>
          <input
            id={aliasId}
            value={alias}
            maxLength={40}
            onChange={(e) => setAlias(e.target.value)}
            aria-describedby={noteId}
            autoComplete="off"
            className={`${FIELD} min-h-[44px]`}
          />
          <p id={noteId} className="text-[13.5px] leading-[1.45] text-ink-muted">
            De los menores solo guardo un apodo («el pequeño», «la mayor», «hija 2») y la edad aproximada. Nunca su nombre.
          </p>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className={`${LABEL} pb-2`}>Edad</legend>
          <div className="flex flex-wrap gap-2">
            {AGE_BANDS.map((b) => (
              <ChoicePill key={b} name={`edad-${person?.key ?? "nueva"}`} checked={band === b} onChange={() => setBand(b)}>
                {ageBandPill(b)}
              </ChoicePill>
            ))}
          </div>
        </fieldset>

        <SheetError message={error} />

        <div className="flex gap-2 pt-1">
          <button type="button" onClick={onClose} className={`${PILL_OUTLINE} flex-1`}>
            Cancelar
          </button>
          <button type="submit" disabled={!ready || saving} className={`${PILL_INK} flex-1`}>
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </form>
    </MenuSheet>
  )
}
