'use client'

/**
 * /profile/suscripcion — the household's plan (specs/billing.md).
 *
 * No subscription: the two plans (Esencial featured) with a monthly/yearly
 * switch and «Suscribirme», which opens Stripe Checkout. During the beta the
 * card is saved now and the first charge is on launch day. With one: the plan,
 * its next charge and «Gestionar mi suscripción» (Stripe's portal: card,
 * receipts, change plan, cancel). Back from Checkout with `?estado=ok` we poll
 * until the webhook has written the subscription.
 */

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { LAUNCH_DATE_LABEL, PLAN_CAPS_NOTE, founderOfferText, trialLastDayLabel, planByKey, subscriptionSummary, type BillingPeriod, type PlanKey } from '@ona/shared'
import { PlanCards } from '@/components/billing/PlanCards'
import { chargeNoticeLine } from '@/components/billing/AccountAccessNotice'
import { useBilling, useCheckout, usePortal } from '@/hooks/useBilling'
import { Accent, PILL_INK, PILL_OUTLINE, SUB_CARD, SUB_EYEBROW, SubNotice, SubPage } from '@/components/profile/SubPage'
import { SubLoadError, useQueryLoad } from '@/components/profile/SubLoadError'

const shortDay = (iso: string) =>
  new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', timeZone: 'Europe/Madrid' }).format(new Date(iso))
const fmt = (iso: string) =>
  new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Madrid' }).format(new Date(iso))

export default function SuscripcionPage() {
  return (
    <Suspense fallback={null}>
      <Suscripcion />
    </Suspense>
  )
}

function Suscripcion() {
  const params = useSearchParams()
  const justPaid = params.get('estado') === 'ok'
  const cancelled = params.get('estado') === 'cancelado'
  // The legal notice's «Cancelar mi suscripción» link (PRO-136).
  const wantsCancel = params.get('cancelar') === '1'
  const billing = useBilling({ poll: justPaid })
  const checkout = useCheckout()
  const portal = usePortal()
  // PRO-143: failed or > 8 s → «No hemos podido cargar esto» + «Reintentar».
  const load = useQueryLoad([['billing'], billing])
  const [plan, setPlan] = useState<PlanKey>('esencial')
  const [period, setPeriod] = useState<BillingPeriod>('mensual')

  const state = billing.data
  const sub = state?.subscription
  const summary = sub ? subscriptionSummary(sub) : null
  const error = checkout.error ?? portal.error

  return (
    <SubPage
      eyebrow="Tu plan"
      title={
        <>
          <Accent>Suscripción</Accent>
        </>
      }
      intro={
        state?.beta ? (
          `Durante la beta tienes Plus gratis hasta el ${LAUNCH_DATE_LABEL}.`
        ) : state?.access?.state === 'paused' ? (
          // PRO-135: texts for Legal to review.
          <span data-testid="subscription-paused">
            Tu prueba ha terminado y tu cuenta está en pausa. Elige un plan para volver a generar menús y hablar con Mimo. No se ha
            borrado nada.
          </span>
        ) : state?.access?.state === 'trial' ? (
          <span data-testid="subscription-trial">Estás en tu prueba de 14 días: dura hasta el {trialLastDayLabel(state.access)}, incluido.</span>
        ) : undefined
      }
    >
      {error && (
        <div role="alert" className="mb-5 rounded-2xl border border-terracotta-deep/25 bg-warn-bg px-4 py-3 text-[14px] text-terracotta-deep">
          {error instanceof Error ? error.message : 'No hemos podido abrir el pago.'}
        </div>
      )}
      {cancelled && !sub && (
        <div className="mb-5">
          <SubNotice>No has pagado nada. Puedes elegir un plan cuando quieras.</SubNotice>
        </div>
      )}

      {load.failed ? (
        <SubLoadError onRetry={load.retry} retrying={load.retrying} />
      ) : (
        billing.isLoading && <div className="text-eyebrow">Cargando…</div>
      )}

      {state && sub && (
        <section className={`${SUB_CARD} p-5`} data-testid="subscription-current">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className={SUB_EYEBROW}>Tu plan</div>
            <span
              data-testid="subscription-badge"
              className={`rounded-full px-3 py-1 text-[12px] font-semibold ${
                summary!.tone === 'good'
                  ? 'bg-forest/10 text-forest'
                  : summary!.tone === 'warn'
                    ? 'bg-warn-bg text-terracotta-deep'
                    : 'bg-cream-deep text-ink-muted'
              }`}
            >
              {summary!.badge}
            </span>
          </div>
          <p className="mt-2 font-display text-[28px] leading-tight text-ink">
            {planByKey(sub.plan).name} <span className="text-ink-muted">· {planByKey(sub.plan).prices[sub.period].label}</span>
          </p>
          <p className="mt-2 text-[14px] leading-relaxed text-ink-mid" data-testid="subscription-line">
            {summary!.line}
          </p>
          {sub.founderPrice && (
            <p className="mt-2 text-[14px] leading-relaxed text-ink-mid" data-testid="subscription-founder">
              Tienes el precio de fundador: no te sube mientras sigas suscrito.
            </p>
          )}
          {sub.upcomingCharge && (
            // PRO-136: the legal notice, in the app (text for Legal to review).
            <div className="mt-4 rounded-2xl bg-cream-deep px-4 py-3 text-[14px] leading-relaxed text-ink" data-testid="charge-notice">
              {chargeNoticeLine(sub.upcomingCharge)}
            </div>
          )}
          {state.canManage && wantsCancel && !sub.cancelAtPeriodEnd && (
            <button
              type="button"
              className={`${PILL_INK} mt-5 w-full sm:w-auto`}
              disabled={portal.isPending}
              onClick={() => portal.mutate({ cancel: true })}
              data-testid="cancel-subscription"
            >
              Cancelar mi suscripción
            </button>
          )}
          {state.canManage ? (
            <button type="button" className={`${PILL_OUTLINE} mt-5`} disabled={portal.isPending} onClick={() => portal.mutate({})}>
              Gestionar mi suscripción
            </button>
          ) : (
            <p className="mt-4 text-[13px] text-ink-muted">La gestiona quien administra tu hogar.</p>
          )}
          <p className="mt-3 text-[12px] text-ink-muted">Cambiar de plan, la tarjeta, los recibos o cancelar.</p>
        </section>
      )}

      {state && !sub && justPaid && (
        <SubNotice>Estamos confirmando tu pago con Stripe… tarda unos segundos.</SubNotice>
      )}

      {state && !sub && !justPaid && (
        <>
          {!state.enabled ? (
            <SubNotice dashed>
              Muy pronto podrás dejar tu plan pagado desde aquí. Mientras, mira los planes en{' '}
              <Link href="/precios" className="underline underline-offset-4">
                Precios
              </Link>
              .
            </SubNotice>
          ) : !state.canManage ? (
            <SubNotice>El plan lo contrata quien gestiona tu hogar. Pídeselo desde Casa.</SubNotice>
          ) : (
            <>
              <p className="mb-5 text-[14px] leading-relaxed text-ink-mid">
                {state.beta
                  ? `Si ya sabes que te quedas, déjalo pagado con tu precio de fundador: guardamos la tarjeta hoy y el primer cobro es el ${fmt(state.firstChargeAt)} (como todos, tienes 14 días de prueba desde la salida, el ${LAUNCH_DATE_LABEL}). Hasta entonces puedes cancelar sin pagar nada.`
                  : `Guardamos la tarjeta hoy y el primer cobro es el ${fmt(state.firstChargeAt)}. Hasta entonces puedes cancelar sin pagar nada.`}
              </p>
              {state.founder?.offer && (
                <div className="mb-5 rounded-2xl border border-border-soft bg-paper px-4 py-3" data-testid="founder-offer">
                  <p className="font-serif-text text-[17px] font-[650] leading-snug text-ink">Quédate el precio de fundador</p>
                  <p className="mt-1 text-[14px] leading-relaxed text-ink-mid">
                    {founderOfferText({ trialLastDay: state.access.trialLastDay, firstChargeAt: state.firstChargeAt })}
                  </p>
                </div>
              )}
              {state.founder?.household && (
                <p className="mb-5 text-[14px] leading-relaxed text-ink-mid" data-testid="founder-household">
                  Tu hogar es fundador: cuando te suscribas, tienes el precio de fundador para siempre (no te sube mientras sigas suscrito).
                </p>
              )}
              <PlanCards period={period} onPeriodChange={setPeriod} selected={plan} onSelect={setPlan} testIdPrefix="subscribe" />
              <button
                type="button"
                className={`${PILL_INK} mt-6 w-full sm:w-auto`}
                disabled={checkout.isPending}
                onClick={() => checkout.mutate({ plan, period })}
                data-testid="subscribe-cta"
              >
                {`Suscribirme a ${planByKey(plan).name} · pago el ${shortDay(state.firstChargeAt)}`}
              </button>
              <p className="mt-3 text-[12px] leading-relaxed text-ink-muted">
                Precios con IVA incluido, para todo tu hogar. El pago lo gestiona Stripe (en tu extracto, «LINK.COM* MIMOIA»).{' '}
                {PLAN_CAPS_NOTE}{' '}
                <Link href="/precios" className="underline underline-offset-4">
                  Qué incluye cada plan
                </Link>
              </p>
            </>
          )}
        </>
      )}
    </SubPage>
  )
}
