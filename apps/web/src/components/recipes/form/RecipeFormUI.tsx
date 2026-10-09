"use client"

/**
 * Building blocks of the recipe forms (`/recipes/new`, `/recipes/[id]/edit`)
 * in the "D · Luz y foto" skin (PRO-42): paper section cards with Fraunces
 * titles, #E8E2D3 bordered 44 px inputs, ink/paper choice pills, dashed
 * ingredient rows like the recipe detail's and a sticky ink "save" pill.
 *
 * Presentation only — every piece takes its state and handlers from the page,
 * so the form payload (and `recipeFormContract.test.ts`) is untouched.
 */
import { useEffect, useRef, type ReactNode } from "react"
import Link from "next/link"
import { ChevronLeft, Plus, Trash2 } from "lucide-react"
import type { Ingredient } from "@ona/shared"
import { cn } from "@/lib/utils"
import { humanizeLintKey } from "@/lib/recipeView"
import { IngredientAutocomplete } from "@/components/recipes/IngredientAutocomplete"

/** Fraunces at text sizes, semibold — the `/menu` and `/recipes` title cut. */
export const FORM_TITLE = "font-serif-text font-[650] text-ink"

/** 44 px paper input with the soft border; terracotta when it has an error. */
export function fieldClass(hasError = false, extra = "") {
  return cn(
    "h-11 w-full rounded-xl border bg-paper px-3.5 text-[16px] text-ink placeholder:text-ink-light focus:outline-none focus:ring-1 disabled:opacity-60 lg:text-[15px]",
    hasError
      ? "border-terracotta focus:border-terracotta focus:ring-terracotta"
      : "border-border-soft focus:border-ink focus:ring-ink",
    extra,
  )
}

/** 11 px uppercase field label (eyebrow) in ink-muted. */
export const LABEL = "text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted"

/** Small italic helper line under a label. */
export const HINT = "text-[13px] leading-snug text-ink-muted"

/** Inline error under a field. */
export function FieldError({ children }: { children?: ReactNode }) {
  if (!children) return null
  return <p className="mt-2 text-[13px] italic text-terracotta-deep">{children}</p>
}

/** Back link + eyebrow + Fraunces h1 + one-line intro. */
export function FormHeader({
  backHref,
  backLabel,
  eyebrow,
  title,
  accent,
  intro,
}: {
  backHref: string
  backLabel: string
  eyebrow: string
  title: string
  accent: string
  intro: ReactNode
}) {
  return (
    <header>
      <Link
        href={backHref}
        className="-ml-1 inline-flex min-h-11 items-center gap-1 px-1 text-[13px] font-medium text-ink-muted transition-colors hover:text-ink"
      >
        <ChevronLeft size={16} aria-hidden />
        {backLabel}
      </Link>
      <p className={cn(LABEL, "mt-3")}>{eyebrow}</p>
      <h1 className={cn(FORM_TITLE, "mt-1.5 text-[30px] leading-[1.1] lg:text-[40px] lg:leading-[1.05]")}>
        {title} <span className="font-medium italic text-terracotta-deep">{accent}</span>
      </h1>
      <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-ink-muted">{intro}</p>
    </header>
  )
}

/** Paper section card: radius 20, soft border, Fraunces title. */
export function FormCard({
  title,
  description,
  action,
  children,
  className,
  labelledBy,
}: {
  title: ReactNode
  description?: ReactNode
  /** Right-aligned slot next to the title (e.g. a count). */
  action?: ReactNode
  children: ReactNode
  className?: string
  labelledBy?: string
}) {
  return (
    <section
      aria-labelledby={labelledBy}
      className={cn("rounded-[20px] border border-border-soft bg-paper p-4 sm:p-5 lg:p-6", className)}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={labelledBy} className={cn(FORM_TITLE, "text-[20px] leading-tight lg:text-[22px]")}>
          {title}
        </h2>
        {action}
      </div>
      {description && <p className={cn(HINT, "mt-1")}>{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}

/** One field inside a card: label + control (+ hint / error). */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode
  htmlFor?: string
  hint?: ReactNode
  error?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      {htmlFor ? (
        <label htmlFor={htmlFor} className={LABEL}>
          {label}
        </label>
      ) : (
        <div className={LABEL}>{label}</div>
      )}
      {hint && <p className={cn(HINT, "mt-1")}>{hint}</p>}
      <div className="mt-2">{children}</div>
      <FieldError>{error}</FieldError>
    </div>
  )
}

/** Ink (selected) / paper choice pill: 36 px visual, 44 px hit area. */
export function choicePillClass(active: boolean) {
  return cn(
    "relative inline-flex h-9 items-center whitespace-nowrap rounded-full border px-3.5 text-[14px] transition-colors before:absolute before:inset-x-0 before:-inset-y-1 active:scale-[0.97]",
    active ? "border-ink bg-ink font-medium text-cream" : "border-border bg-paper text-ink hover:border-ink",
  )
}

/** Tag pills under the tag input, each with its own 44 px "x". */
export function TagList({ tags, onRemove }: { tags: string[]; onRemove: (tag: string) => void }) {
  if (tags.length === 0) return null
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex h-9 items-center rounded-full border border-border-soft bg-cream-deep pl-3.5 text-[13px] text-ink-mid"
        >
          {tag}
          <button
            type="button"
            onClick={() => onRemove(tag)}
            className="relative flex h-9 w-9 items-center justify-center rounded-full text-ink-muted transition-colors before:absolute before:-inset-y-1 before:inset-x-0 hover:text-terracotta-deep"
            aria-label={`Quitar etiqueta ${tag}`}
          >
            x
          </button>
        </span>
      ))}
    </div>
  )
}

/** Text button that appends a row ("Añadir ingrediente", "Añadir paso"…). */
export function AddRowButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-full px-1 text-[14px] font-medium text-ink underline-offset-4 transition-colors hover:text-terracotta-deep hover:underline"
    >
      <Plus size={16} aria-hidden />
      {children}
    </button>
  )
}

/** 44 px icon button used for the per-row trash. */
export const ICON_BUTTON =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-cream-deep hover:text-terracotta-deep disabled:opacity-30 disabled:hover:bg-transparent"

/**
 * The editable body of one ingredient row, laid out like the detail's dashed
 * rows: name (autocomplete) + trash on the first line, then quantity (mono),
 * unit and the "opc" toggle. The sortable list adds the grip handle.
 */
export function IngredientRowFields({
  selected,
  onSelect,
  placeholder,
  hasError,
  defaultText,
  quantity,
  onQuantity,
  unit,
  units,
  onUnit,
  optional,
  onToggleOptional,
  onRemove,
  removable,
  hint,
}: {
  selected: Ingredient | null
  onSelect: (ing: Ingredient) => void
  placeholder: string
  hasError: boolean
  defaultText?: string
  quantity: number | ""
  onQuantity: (value: string) => void
  unit: string
  units: string[]
  onUnit: (value: string) => void
  optional: boolean
  onToggleOptional: () => void
  onRemove: () => void
  removable: boolean
  hint?: string | null
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        <IngredientAutocomplete
          value={selected}
          onSelect={onSelect}
          placeholder={placeholder}
          hasError={hasError}
          defaultText={defaultText}
        />
        <button
          type="button"
          onClick={onRemove}
          disabled={!removable}
          className={ICON_BUTTON}
          aria-label="Quitar ingrediente"
        >
          <Trash2 size={17} />
        </button>
      </div>
      <div className="flex items-center gap-2 pr-12">
        <input
          type="number"
          value={quantity === "" ? "" : quantity}
          onChange={(e) => onQuantity(e.target.value)}
          placeholder="Cant."
          min={0}
          step="any"
          className={fieldClass(false, "w-24 font-mono text-[15px] lg:text-[14px]")}
        />
        <select
          value={unit}
          onChange={(e) => onUnit(e.target.value)}
          className={fieldClass(false, "w-24 px-2.5")}
        >
          {units.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onToggleOptional}
          aria-pressed={optional}
          title={optional ? "Quitar marca opcional" : "Marcar como opcional"}
          className={cn(
            "relative inline-flex h-9 items-center rounded-full px-3 text-[11px] uppercase tracking-[0.1em] transition-colors before:absolute before:inset-x-0 before:-inset-y-1",
            optional
              ? "bg-cream-deep font-semibold text-ink"
              : "border border-dashed border-border text-ink-muted hover:border-ink hover:text-ink",
          )}
        >
          opc
        </button>
      </div>
      {hint && <p className="text-[12px] italic text-terracotta-deep">{hint}</p>}
    </div>
  )
}

/**
 * Error / lint summary above the save bar. Scrolls itself into view when it
 * first appears, since the save pill is sticky and may be far from it.
 */
export function FormErrors({
  errors,
  title,
  footnote,
  children,
}: {
  errors: Record<string, string>
  title: string
  footnote?: ReactNode
  /** Extra actions (the "Guardar igualmente" submit). */
  children?: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const count = Object.keys(errors).length
  useEffect(() => {
    if (count > 0) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }, [count])
  if (count === 0) return null
  return (
    <div
      ref={ref}
      role="alert"
      className="rounded-[20px] border border-terracotta/40 bg-warn-bg px-4 py-4 lg:px-5"
    >
      <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-terracotta-deep">{title}</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-terracotta-deep">
        {Object.entries(errors).map(([key, msg]) => {
          const label = humanizeLintKey(key)
          // Server-side lint messages already mention "el paso N" / "el
          // ingrediente X" — drop the prefix to avoid "Paso 1: El paso 1…".
          const showLabel = !!label && !msg.toLowerCase().includes(label.toLowerCase())
          return (
            <li key={key}>
              {showLabel ? (
                <>
                  <span className="font-semibold">{label}:</span> {msg}
                </>
              ) : (
                msg
              )}
            </li>
          )
        })}
      </ul>
      {footnote && <p className="mt-3 text-[13px] text-ink-mid">{footnote}</p>}
      {children && <div className="mt-3 flex flex-wrap gap-2">{children}</div>}
    </div>
  )
}

/** Outline terracotta pill for "Guardar igualmente". */
export const FORCE_PILL =
  "inline-flex h-11 items-center justify-center rounded-full border border-terracotta-deep bg-paper px-5 text-[15px] font-semibold text-terracotta-deep transition-colors hover:bg-terracotta-deep hover:text-cream active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"

/**
 * Sticky save bar (render it as a direct child of the <form>, or it only
 * sticks inside its wrapper): an ink pill that stays at the bottom of the viewport while
 * the form scrolls (above the tab bar on mobile), plus "Cancelar". It leaves
 * room on the right for the floating Mimo button.
 */
export function SaveBar({
  submitLabel,
  disabled,
  cancelHref,
}: {
  submitLabel: string
  disabled: boolean
  cancelHref: string
}) {
  return (
    <div className="sticky bottom-[calc(72px+var(--safe-bottom))] z-30 mt-4 pr-[68px] md:bottom-4 md:pr-[76px] lg:pr-0">
      <div className="flex items-center gap-2 rounded-full border border-border-soft bg-paper/95 p-1.5 shadow-[0_8px_24px_-12px_rgba(26,22,18,0.35)] backdrop-blur lg:mx-auto lg:max-w-[560px]">
        <button
          type="submit"
          disabled={disabled}
          className="flex h-11 min-w-0 flex-1 items-center justify-center rounded-full bg-ink px-5 text-[15px] font-semibold text-cream transition-colors hover:bg-ink-mid active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitLabel}
        </button>
        <Link
          href={cancelHref}
          className="inline-flex h-11 shrink-0 items-center rounded-full px-4 text-[14px] font-medium text-ink-muted transition-colors hover:text-ink"
        >
          Cancelar
        </Link>
      </div>
    </div>
  )
}
