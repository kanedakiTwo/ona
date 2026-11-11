"use client"

/**
 * The trial and the Gratis plan (PRO-135, PRO-385, specs/billing.md), from
 * `GET /billing` → `access`. Only from launch day: during the beta nothing
 * shows.
 *
 * - `gratis` (trial over, no plan; D-158): «Estás en el plan Gratis» — the
 *   week and the list stay theirs, on the web; Mimo needs a plan. Owner:
 *   «Elegir plan»; a member: ask whoever runs the household. In Mimo's panel,
 *   «En el plan Gratis, Mimo descansa…» instead of the composer.
 * - `trial` with ≤ 2 days left: «Te quedan 2 días de prueba» + what happens next.
 * - PRO-136: the founder-price offer (`founder.offer`: from the first
 *   resolved week or day 10, PRO-384; until the last 2 days) and the legal
 *   notice 15 days before the first charge
 *   (`subscription.upcomingCharge`). One card at a time; Gratis wins.
 *
 * Texts for Legal to review before publishing.
 */
import Link from "next/link"
import { PLAN_GRATIS_MESSAGE, TRIAL_ENDING_NOTICE_DAYS, founderOfferText, trialDaysLeftLabel, trialLastDayLabel, type BillingState } from "@ona/shared"
import { useBilling } from "@/hooks/useBilling"

export const GRATIS_TITLE = "Estás en el plan Gratis"
export const GRATIS_BODY =
  "Lo haces tú: genera tu menú de la semana y cámbialo aquí, en la web, y haz y manda tu lista. Tus recetas siguen aquí y no se borra nada. Con Esencial, Mimo vuelve a haceros la semana él solo."
export const PAUSED_MEMBER = "El plan lo elige quien gestiona tu hogar: pídeselo desde Casa."

/** «El 29 de diciembre te cobraremos 4,99 €…» (PRO-136, legal notice in the app). */
export function chargeNoticeLine(c: { at: string; amount: string }): string {
  const day = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Madrid" }).format(new Date(c.at))
  return `El ${day} te cobraremos ${c.amount} (IVA incluido), el primer pago de tu suscripción. Si no quieres seguir, cancela antes de esa fecha y no se te cobrará nada.`
}

export function isOnGratis(state: BillingState | undefined): boolean {
  return state?.access?.state === "gratis"
}

export function AccountAccessNotice({ variant = "page" }: { variant?: "page" | "panel" }) {
  const billing = useBilling()
  const state = billing.data
  const access = state?.access
  if (!state || !access) return null
  const edge = variant === "page" ? "mx-5 mt-3 lg:mx-0" : ""

  if (access.state === "gratis") {
    const panel = variant === "panel"
    return (
      <section
        data-testid="plan-gratis"
        aria-label="Plan Gratis"
        className={`${edge} rounded-2xl border border-border-soft bg-paper px-4 py-4`}
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">Plan Gratis</p>
        {panel ? (
          <p className="mt-1 text-[15px] leading-relaxed text-ink">{PLAN_GRATIS_MESSAGE}</p>
        ) : (
          <>
            <p className="mt-1 font-serif-text text-[20px] font-[650] leading-snug text-ink">{GRATIS_TITLE}</p>
            <p className="mt-1 text-[14px] leading-relaxed text-ink-mid">{GRATIS_BODY}</p>
          </>
        )}
        {state.canManage ? (
          <Link
            href="/profile/suscripcion"
            data-testid="plan-gratis-cta"
            className="mt-3 inline-flex min-h-[44px] items-center rounded-full bg-ink px-5 text-[14px] font-semibold text-cream"
          >
            Elegir plan
          </Link>
        ) : (
          <p className="mt-2 text-[13px] text-ink-muted">{PAUSED_MEMBER}</p>
        )}
      </section>
    )
  }

  const upcoming = state.subscription?.upcomingCharge
  if (upcoming && variant === "page") {
    return (
      <section data-testid="charge-notice" aria-label="Tu primer cobro" className={`${edge} rounded-2xl border border-border-soft bg-paper px-4 py-3`}>
        <p className="font-serif-text text-[17px] font-[650] leading-snug text-ink">Tu primer cobro</p>
        <p className="mt-1 text-[14px] leading-relaxed text-ink-mid">{chargeNoticeLine(upcoming)}</p>
        {state.canManage && (
          <Link href="/profile/suscripcion?cancelar=1" className="mt-2 inline-block text-[14px] font-semibold text-ink underline underline-offset-4">
            Ver o cancelar mi suscripción
          </Link>
        )}
      </section>
    )
  }

  const lastDays = access.state === "trial" && access.daysLeft !== null && access.daysLeft <= TRIAL_ENDING_NOTICE_DAYS
  if (state.founder?.offer && !lastDays && variant === "page") {
    return (
      <section data-testid="founder-offer" aria-label="Precio de fundador" className={`${edge} rounded-2xl border border-border-soft bg-paper px-4 py-4`}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-terracotta-deep">Precio de fundador</p>
        <p className="mt-1 font-serif-text text-[19px] font-[650] leading-snug text-ink">Quédate el precio de fundador</p>
        <p className="mt-1 text-[14px] leading-relaxed text-ink-mid">{founderOfferText({ trialLastDay: access.trialLastDay, firstChargeAt: state.firstChargeAt })}</p>
        {state.canManage ? (
          <Link
            href="/profile/suscripcion"
            data-testid="founder-offer-cta"
            className="mt-3 inline-flex min-h-[44px] items-center rounded-full bg-ink px-5 text-[14px] font-semibold text-cream"
          >
            Elegir plan
          </Link>
        ) : (
          <p className="mt-2 text-[13px] text-ink-muted">{PAUSED_MEMBER}</p>
        )}
      </section>
    )
  }

  if (lastDays && access.daysLeft !== null) {
    return (
      <section
        data-testid="trial-ending"
        aria-label="Tu prueba"
        className={`${edge} rounded-2xl border border-border-soft bg-paper px-4 py-3`}
      >
        <p className="font-serif-text text-[17px] font-[650] leading-snug text-ink">{trialDaysLeftLabel(access.daysLeft)}</p>
        <p className="mt-1 text-[14px] leading-relaxed text-ink-mid">
          Tu prueba dura hasta el {trialLastDayLabel(access)}, incluido. Si no eliges un plan, no se te cobra nada: pasas al
          plan Gratis y sigues haciendo tu menú de la semana y tu lista en la web, pero sin Mimo ni avisos.
        </p>
        {state.canManage && (
          <Link href="/profile/suscripcion" className="mt-2 inline-block text-[14px] font-semibold text-ink underline underline-offset-4">
            Ver los planes
          </Link>
        )}
      </section>
    )
  }
  return null
}
