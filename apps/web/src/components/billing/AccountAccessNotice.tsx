"use client"

/**
 * The trial and the paused account (PRO-135, specs/billing.md), from
 * `GET /billing` → `access`. Only from launch day: during the beta nothing
 * shows.
 *
 * - `paused` (14 days over, no plan): «Tu prueba ha terminado» — menu,
 *   recipes and list stay; new menus and Mimo need a plan. Owner: «Elegir
 *   plan»; a member: ask whoever runs the household.
 * - `trial` with ≤ 2 days left: «Te quedan 2 días de prueba» + what happens next.
 * - PRO-136: the day-7 founder-price offer (`founder.offer`, until the last
 *   2 days) and the legal notice 15 days before the first charge
 *   (`subscription.upcomingCharge`). One card at a time; the pause wins.
 *
 * Texts for Legal to review before publishing.
 */
import Link from "next/link"
import { TRIAL_ENDING_NOTICE_DAYS, founderOfferText, trialDaysLeftLabel, trialLastDayLabel, type BillingState } from "@ona/shared"
import { useBilling } from "@/hooks/useBilling"

export const PAUSED_TITLE = "Tu prueba ha terminado"
export const PAUSED_BODY =
  "Tu cuenta está en pausa. Tu menú, tus recetas y tu lista siguen aquí y no se borra nada. Para generar menús nuevos y volver a hablar con Mimo, elige un plan."
export const PAUSED_MEMBER = "El plan lo elige quien gestiona tu hogar: pídeselo desde Casa."

/** «El 29 de diciembre te cobraremos 4,99 €…» (PRO-136, legal notice in the app). */
export function chargeNoticeLine(c: { at: string; amount: string }): string {
  const day = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Madrid" }).format(new Date(c.at))
  return `El ${day} te cobraremos ${c.amount} (IVA incluido), el primer pago de tu suscripción. Si no quieres seguir, cancela antes de esa fecha y no se te cobrará nada.`
}

export function isPaused(state: BillingState | undefined): boolean {
  return state?.access?.state === "paused"
}

export function AccountAccessNotice({ variant = "page" }: { variant?: "page" | "panel" }) {
  const billing = useBilling()
  const state = billing.data
  const access = state?.access
  if (!state || !access) return null
  const edge = variant === "page" ? "mx-5 mt-3 lg:mx-0" : ""

  if (access.state === "paused") {
    return (
      <section
        data-testid="account-paused"
        aria-label="Cuenta en pausa"
        className={`${edge} rounded-2xl border border-border-soft bg-paper px-4 py-4`}
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">Cuenta en pausa</p>
        <p className="mt-1 font-serif-text text-[20px] font-[650] leading-snug text-ink">{PAUSED_TITLE}</p>
        <p className="mt-1 text-[14px] leading-relaxed text-ink-mid">{PAUSED_BODY}</p>
        {state.canManage ? (
          <Link
            href="/profile/suscripcion"
            data-testid="account-paused-cta"
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
          Tu prueba dura hasta el {trialLastDayLabel(access)}, incluido. Si no eliges un plan, no se te cobra nada: la cuenta
          queda en pausa y ves tu menú, tus recetas y tu lista, pero sin menús nuevos ni Mimo.
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
