"use client"

import type { ReactNode } from "react"
import { Check } from "lucide-react"
import { PLANS, PLAN_HOUSEHOLD, type BillingPeriod, type Plan, type PlanKey } from "@ona/shared"

/**
 * The two plans (specs/billing.md) with a monthly / yearly switch. Esencial
 * is the featured plan and goes first. Used by `/precios`, `/suscripcion`
 * and the founder reservation on the waitlist.
 *
 * - `selected` + `onSelect`: the cards are a radio group (pick a plan).
 * - `cta`: a button under each card instead (the pricing page).
 */
export function PlanCards({
  period,
  onPeriodChange,
  selected,
  onSelect,
  cta,
  className = "",
  testIdPrefix = "plan",
}: {
  period: BillingPeriod
  onPeriodChange: (p: BillingPeriod) => void
  selected?: PlanKey
  onSelect?: (p: PlanKey) => void
  cta?: (plan: Plan) => ReactNode
  className?: string
  testIdPrefix?: string
}) {
  const selectable = !!onSelect
  return (
    <div className={className}>
      <PeriodSwitch period={period} onChange={onPeriodChange} />
      <div
        className="mt-5 grid gap-4 md:grid-cols-2"
        role={selectable ? "radiogroup" : undefined}
        aria-label={selectable ? "Planes" : undefined}
      >
        {PLANS.map((p) => {
          const price = p.prices[period]
          const isSelected = selectable && selected === p.key
          const body = (
            <>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[17px] font-semibold text-[#1A1612]">{p.name}</span>
                {p.featured && (
                  <span className="rounded-full bg-[#C65D38] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#FAF6EE]">
                    Recomendado
                  </span>
                )}
              </div>
              <span className="mt-1 text-[13px] leading-snug text-[#4A4239]">{p.tagline}</span>
              <span className="mt-4 font-display text-[34px] leading-none text-[#1A1612]" data-testid={`${testIdPrefix}-price-${p.key}`}>
                {price.label}
              </span>
              <span className="mt-1.5 text-[12px] text-[#7A7066]">
                {price.perMonth ? `Sale a ${price.perMonth} · ` : ""}
                {PLAN_HOUSEHOLD}
              </span>
              <ul className="mt-4 space-y-2 text-[14px] text-[#1A1612]">
                {p.highlights.map((h) => (
                  <li key={h} className="flex gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#2D6A4F]" aria-hidden />
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
            </>
          )
          const frame = `flex flex-col rounded-2xl border p-5 text-left transition-colors ${
            p.featured ? "border-[#C65D38] bg-[#FFFEFA] shadow-[0_1px_0_#C65D38]" : "border-[#DDD6C5] bg-[#FFFEFA]/60"
          } ${isSelected ? "ring-2 ring-[#1A1612]" : ""}`
          return selectable ? (
            <button
              key={p.key}
              type="button"
              role="radio"
              aria-checked={isSelected}
              data-testid={`${testIdPrefix}-${p.key}`}
              onClick={() => onSelect!(p.key)}
              className={frame}
            >
              {body}
            </button>
          ) : (
            <div key={p.key} data-testid={`${testIdPrefix}-${p.key}`} className={frame}>
              {body}
              {cta && <div className="mt-6 pt-1">{cta(p)}</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function PeriodSwitch({ period, onChange }: { period: BillingPeriod; onChange: (p: BillingPeriod) => void }) {
  const opt = (value: BillingPeriod, label: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={period === value}
      onClick={() => onChange(value)}
      data-testid={`period-${value}`}
      className={`rounded-full px-4 py-2 text-[13px] font-medium transition-colors ${
        period === value ? "bg-[#1A1612] text-[#FAF6EE]" : "text-[#4A4239]"
      }`}
    >
      {label}
    </button>
  )
  return (
    <div role="radiogroup" aria-label="Forma de pago" className="inline-flex rounded-full border border-[#DDD6C5] bg-[#FFFEFA] p-1">
      {opt("mensual", "Mensual")}
      {opt("anual", "Anual")}
    </div>
  )
}
