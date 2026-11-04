/**
 * Field marks for every web form (PRO-1103, see specs/design-system.md →
 * "Form fields"): a required field ends its label in « *» (terracotta-deep,
 * `aria-hidden`; the control carries `required` or `aria-required`), an
 * optional one in « (opcional)» (grey) — «(opcionales)» when the label names
 * several things. Never neither: the props only type-check with one of them.
 * Forms with required fields end with `<RequiredNote />` («* Obligatorio»).
 *
 * No `@/` imports: `apps/api/src/tests/fieldLabel.test.ts` renders this file.
 */
import type { ReactNode } from "react"

export type FieldMarkProps =
  | { required: true; optional?: never; plural?: never }
  | { optional: true; plural?: boolean; required?: never }

/** The visible mark text, with its leading space: « *», « (opcional)», « (opcionales)». */
export function fieldMarkText(mark: FieldMarkProps): string {
  if (mark.required) return " *"
  return mark.plural ? " (opcionales)" : " (opcional)"
}

/** The mark alone, for labels that are not a `FieldLabel` (checkbox rows, card titles). */
export function FieldMark(props: FieldMarkProps) {
  if (props.required) {
    return (
      <span data-field-mark="required" aria-hidden="true" className="font-semibold text-terracotta-deep">
        {fieldMarkText(props)}
      </span>
    )
  }
  return (
    <span data-field-mark="optional" className="font-normal normal-case tracking-normal text-ink-muted">
      {fieldMarkText(props)}
    </span>
  )
}

/**
 * A field label with its mark. Keeps whatever look the form already has
 * (`className`); renders a `<label>` by default, or a `span`/`div`/`legend`
 * for groups of chips or radios.
 */
export function FieldLabel({
  htmlFor,
  id,
  className,
  as: Tag = "label",
  children,
  ...mark
}: {
  htmlFor?: string
  id?: string
  className?: string
  as?: "label" | "span" | "div" | "legend" | "p"
  children: ReactNode
} & FieldMarkProps) {
  return (
    <Tag htmlFor={Tag === "label" ? htmlFor : undefined} id={id} className={className}>
      {children}
      <FieldMark {...(mark as FieldMarkProps)} />
    </Tag>
  )
}

/** The discreet «* Obligatorio» line at the foot of a form with required fields. */
export function RequiredNote({ className = "" }: { className?: string }) {
  return (
    <p data-required-note className={`text-[12px] text-ink-muted ${className}`.trim()}>
      <span aria-hidden="true" className="font-semibold text-terracotta-deep">
        *
      </span>{" "}
      Obligatorio
    </p>
  )
}
