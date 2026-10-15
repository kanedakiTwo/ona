"use client"

import { useState } from "react"
import Link from "next/link"
import { Check, Minus } from "lucide-react"
import {
  BETA_FIRST_CHARGE_LABEL,
  LAUNCH_DATE_LABEL,
  PLANS,
  PLAN_CAPS_NOTE,
  PLAN_FEATURE_GROUPS,
  type BillingPeriod,
  type FeatureValue,
  type Plan,
} from "@ona/shared"
import { useAuth } from "@/lib/auth"
import { useBilling, useCheckout } from "@/hooks/useBilling"
import { PlanCards } from "./PlanCards"

const WAITLIST_HREF = "/#lista-de-espera"

/** «29 de diciembre», in Madrid. */
const shortDay = (iso: string) =>
  new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "long", timeZone: "Europe/Madrid" }).format(new Date(iso))

const FAQS: { q: string; a: string }[] = [
  {
    q: "¿Es para una persona o para toda la casa?",
    a: "Para todo el hogar. Pagáis una vez y cada uno tiene su cuenta, con el mismo menú, la misma lista y la misma despensa. Hasta 6 personas.",
  },
  {
    q: "¿Cuándo se cobra?",
    a: `Abrimos el ${LAUNCH_DATE_LABEL}. Desde que te registras tienes 14 días gratis con todo, sin tarjeta, y pagas solo si eliges un plan. Si estás en la beta, la tienes gratis hasta la salida y, como todos, después tienes 14 días de prueba: si lo dejas pagado ya, guardas la tarjeta hoy y el primer cobro es el ${BETA_FIRST_CHARGE_LABEL}. Nunca cobramos antes de 15 días desde que dejas la tarjeta, y hasta entonces puedes cancelar sin pagar nada.`,
  },
  {
    q: "¿Puedo cambiar de plan o cancelar?",
    a: "Cuando quieras, desde Perfil → Suscripción. Si cancelas, sigues con tu plan hasta el final de lo que ya has pagado y no se renueva.",
  },
  {
    q: "¿Qué diferencia hay entre Esencial y Plus?",
    a: "Esencial tiene todo para planificar, comprar y cocinar, y Mimo por chat en la app y por WhatsApp. Plus añade hablar con Mimo por voz, que Mimo te escriba él solo por WhatsApp (el menú de hoy, qué sacar del congelador) y más uso de Mimo al mes.",
  },
  {
    q: "¿Quién me cobra?",
    a: "Los pagos los gestiona Stripe a través de Link, que es quien emite los recibos con el IVA incluido. En tu extracto aparecerá «LINK.COM* MIMOIA».",
  },
]

/** `/precios`: the two plans, what each includes, and how to get one. */
export function PricingPage() {
  const [period, setPeriod] = useState<BillingPeriod>("mensual")
  const { user } = useAuth()
  const billing = useBilling({ enabled: !!user })
  const checkout = useCheckout()

  const cta = (plan: Plan) => {
    const primary = plan.featured
    const cls = `inline-flex w-full min-h-[48px] items-center justify-center rounded-full px-6 text-[14px] font-medium transition-colors ${
      primary ? "bg-[#1A1612] text-[#FAF6EE] hover:bg-[#2B241E]" : "border border-[#1A1612] text-[#1A1612] hover:bg-[#F1EBDD]"
    } disabled:opacity-50`
    if (!user) {
      return (
        <Link href={WAITLIST_HREF} className={cls} data-testid={`cta-${plan.key}`}>
          Apúntate a la lista de espera
        </Link>
      )
    }
    const state = billing.data
    if (state?.subscription) {
      const mine = state.subscription.plan === plan.key
      return (
        <Link href="/profile/suscripcion" className={cls} data-testid={`cta-${plan.key}`}>
          {mine ? "Es tu plan · ver suscripción" : "Cambiar a este plan"}
        </Link>
      )
    }
    if (state && !state.enabled) {
      return (
        <button type="button" disabled className={cls} data-testid={`cta-${plan.key}`}>
          Muy pronto podrás pagarlo aquí
        </button>
      )
    }
    if (state && !state.canManage) {
      return (
        <p className="text-center text-[13px] text-[#7A7066]" data-testid={`cta-${plan.key}`}>
          Lo contrata quien gestiona tu hogar.
        </p>
      )
    }
    return (
      <button
        type="button"
        className={cls}
        disabled={!state || checkout.isPending}
        onClick={() => checkout.mutate({ plan: plan.key, period })}
        data-testid={`cta-${plan.key}`}
      >
        {state ? `Elegir ${plan.name} · pagas el ${shortDay(state.firstChargeAt)}` : `Elegir ${plan.name}`}
      </button>
    )
  }

  return (
    <div className="bg-[#FAF6EE]">
      <section className="px-5 pb-10 pt-28 md:px-10 md:pt-40">
        <div className="mx-auto max-w-5xl">
          <div className="text-eyebrow mb-5">Precios</div>
          <h1 className="text-editorial-xl max-w-3xl">
            Un precio para <span className="font-italic italic">todo tu hogar</span>.
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-[#4A4239] md:text-lg">
            Dos planes. <strong className="font-semibold text-[#1A1612]">Esencial</strong> es el que recomendamos: con él tienes
            todo para comer bien cada semana. Plus añade la voz y que Mimo se adelante por WhatsApp.
          </p>
          <p className="mt-4 max-w-2xl text-[14px] leading-relaxed text-[#7A7066]">
            Abrimos el {LAUNCH_DATE_LABEL}, con 14 días gratis con todo y sin tarjeta. Si ya estás en la beta, la tienes
            gratis con Plus hasta entonces y, como todos, después tienes 14 días de prueba: puedes dejarlo pagado ya y no
            se cobra nada hasta el {BETA_FIRST_CHARGE_LABEL}.
          </p>

          {checkout.isError && (
            <p role="alert" className="mt-6 rounded-xl border border-[#C65D38]/30 bg-[#FDEEE8] px-4 py-3 text-[13px] text-[#B5451B]">
              {checkout.error instanceof Error ? checkout.error.message : "No hemos podido abrir el pago."}
            </p>
          )}

          <PlanCards className="mt-10" period={period} onPeriodChange={setPeriod} cta={cta} testIdPrefix="pricing" />
          <p className="mt-4 text-[12px] leading-relaxed text-[#7A7066]">
            Precios con IVA incluido. {PLAN_CAPS_NOTE}
          </p>
        </div>
      </section>

      <section className="px-5 pb-16 md:px-10" aria-labelledby="comparativa">
        <div className="mx-auto max-w-5xl">
          <h2 id="comparativa" className="font-display text-3xl text-[#1A1612] md:text-4xl">
            Qué incluye cada plan
          </h2>
          <ComparisonTable />
        </div>
      </section>

      <section className="px-5 pb-28 md:px-10" aria-labelledby="preguntas">
        <div className="mx-auto max-w-3xl">
          <h2 id="preguntas" className="font-display text-3xl text-[#1A1612] md:text-4xl">
            Preguntas
          </h2>
          <dl className="mt-6 divide-y divide-[#DDD6C5] border-y border-[#DDD6C5]">
            {FAQS.map((f) => (
              <div key={f.q} className="py-5">
                <dt className="text-[16px] font-semibold text-[#1A1612]">{f.q}</dt>
                <dd className="mt-2 text-[15px] leading-relaxed text-[#4A4239]">{f.a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </div>
  )
}

function Cell({ value, plan }: { value: FeatureValue; plan: string }) {
  if (value === true) return <Check className="mx-auto h-5 w-5 text-[#2D6A4F]" aria-label={`Incluido en ${plan}`} />
  if (value === false) return <Minus className="mx-auto h-5 w-5 text-[#C9C0AE]" aria-label={`No incluido en ${plan}`} />
  return <span className="text-[12px] leading-tight text-[#1A1612] md:text-[13px]">{value}</span>
}

function ComparisonTable() {
  const [esencial, plus] = PLANS
  return (
    <div className="mt-6 overflow-hidden rounded-2xl border border-[#DDD6C5] bg-[#FFFEFA]">
      <table className="w-full table-fixed border-collapse text-left" data-testid="pricing-comparison">
        <colgroup>
          <col />
          <col className="w-[84px] md:w-[160px]" />
          <col className="w-[84px] md:w-[160px]" />
        </colgroup>
        <thead>
          <tr className="border-b border-[#DDD6C5]">
            <th scope="col" className="p-3 text-[12px] font-normal text-[#7A7066] md:p-4">
              <span className="sr-only">Función</span>
            </th>
            <th scope="col" className="bg-[#C65D38]/[0.06] p-3 text-center text-[14px] font-semibold text-[#1A1612] md:p-4">
              {esencial.name}
              <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-[#C65D38]">Recomendado</span>
            </th>
            <th scope="col" className="p-3 text-center text-[14px] font-semibold text-[#1A1612] md:p-4">
              {plus.name}
            </th>
          </tr>
        </thead>
        {PLAN_FEATURE_GROUPS.map((g) => (
          <tbody key={g.title}>
            <tr>
              <th colSpan={3} scope="colgroup" className="bg-[#F5EFE3] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7A7066] md:px-4">
                {g.title}
              </th>
            </tr>
            {g.features.map((f) => (
              <tr key={f.label} className="border-t border-[#EEE7D8]">
                <th scope="row" className="p-3 align-top font-normal md:p-4">
                  <span className="block text-[14px] text-[#1A1612]">{f.label}</span>
                  {f.detail && <span className="mt-0.5 block text-[12px] leading-snug text-[#7A7066]">{f.detail}</span>}
                </th>
                <td className="bg-[#C65D38]/[0.06] p-2 text-center align-middle md:p-4">
                  <Cell value={f.esencial} plan={esencial.name} />
                </td>
                <td className="p-2 text-center align-middle md:p-4">
                  <Cell value={f.plus} plan={plus.name} />
                </td>
              </tr>
            ))}
          </tbody>
        ))}
        <tfoot>
          <tr className="border-t border-[#DDD6C5]">
            <th scope="row" className="p-3 text-[13px] font-normal text-[#4A4239] md:p-4">
              Precio, para todo el hogar
            </th>
            <td className="bg-[#C65D38]/[0.06] p-2 text-center text-[12px] font-semibold text-[#1A1612] md:p-4 md:text-[14px]">
              {esencial.prices.mensual.label}
              <span className="block font-normal text-[#7A7066]">o {esencial.prices.anual.label}</span>
            </td>
            <td className="p-2 text-center text-[12px] font-semibold text-[#1A1612] md:p-4 md:text-[14px]">
              {plus.prices.mensual.label}
              <span className="block font-normal text-[#7A7066]">o {plus.prices.anual.label}</span>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
