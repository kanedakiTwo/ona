"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowUpRight } from "lucide-react"
import {
  BRAND_NAME,
  EMPTY_WAITLIST_FORM,
  WAITLIST_CURRENT_METHODS,
  WAITLIST_CURRENT_METHOD_LABELS,
  WAITLIST_HOUSEHOLD_SIZES,
  WAITLIST_HOUSEHOLD_SIZE_LABELS,
  WAITLIST_PLANNER_ROLES,
  WAITLIST_PLANNER_ROLE_LABELS,
  WAITLIST_PLATFORMS,
  WAITLIST_PLATFORM_LABELS,
  buildWaitlistPayload,
  isWaitlistFormComplete,
  readWaitlistAttribution,
  waitlistReferralUrl,
  waitlistStatusPath,
  waitlistUnsubscribePath,
  type WaitlistAttribution,
  type WaitlistFormState,
  type WaitlistSignupResponse,
} from "@ona/shared"
import { apiPublic } from "@/lib/api"
import ReferralShare from "./ReferralShare"

/** Anchor every public CTA points to ("/#lista-de-espera"). */
export const WAITLIST_ANCHOR = "lista-de-espera"

/**
 * Landing section: the pre-launch waitlist form and its success state
 * (specs/waitlist.md). Reads `?ref`, `?utm_*` and `?invita=<code>` from the
 * URL the visitor landed on and sends them with the answers.
 */
export default function WaitlistSection() {
  const [form, setForm] = useState<WaitlistFormState>(EMPTY_WAITLIST_FORM)
  const [attribution, setAttribution] = useState<WaitlistAttribution | null>(null)
  const [status, setStatus] = useState<"idle" | "sending" | "error">("idle")
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<(WaitlistSignupResponse & { origin: string; firstName: string }) | null>(null)

  useEffect(() => {
    setAttribution(readWaitlistAttribution(new URLSearchParams(window.location.search)))
  }, [])

  const set = <K extends keyof WaitlistFormState>(key: K, value: WaitlistFormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const complete = isWaitlistFormComplete(form)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!complete || status === "sending") return
    setStatus("sending")
    setError(null)
    try {
      const attr = attribution ?? readWaitlistAttribution(new URLSearchParams(window.location.search))
      const res = await apiPublic.post<WaitlistSignupResponse>("/waitlist", buildWaitlistPayload(form, attr))
      setDone({ ...res, origin: window.location.origin, firstName: form.firstName.trim() })
      setStatus("idle")
    } catch (err: any) {
      setError(err?.message ?? "No hemos podido apuntarte. Inténtalo de nuevo en un momento.")
      setStatus("error")
    }
  }

  return (
    <section
      id={WAITLIST_ANCHOR}
      aria-labelledby="waitlist-title"
      className="scroll-mt-20 border-t border-[#E8E2D3] bg-[#FAF6EE] px-6 py-24 md:px-10 md:py-32"
    >
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-12 md:grid-cols-12 md:gap-16">
        <div className="md:col-span-5">
          <div className="text-eyebrow mb-6">Lista de espera · {BRAND_NAME}</div>
          <h2 id="waitlist-title" className="text-editorial-lg">
            Tu menú semanal y tu lista de la compra,{" "}
            <span className="font-italic italic text-[#C65D38]">que te escriben por WhatsApp.</span>
          </h2>
          <p className="mt-8 max-w-md text-base leading-relaxed text-[#4A4239] md:text-lg">
            Sin contar calorías. Y sin el «¿qué cenamos?» de todos los días a las ocho de la tarde.
          </p>
          <p className="mt-6 max-w-md text-base leading-relaxed text-[#4A4239]">
            Entramos por tandas, cada dos a cuatro semanas, porque cada hogar lo acompañamos de cerca. No hay
            número de turno que vigilar: cuando te toque, te escribimos.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-[#1A1612]">
            <li className="flex gap-3">
              <span className="text-[#C65D38]">✦</span>Cuatro preguntas rápidas sobre cómo coméis en casa.
            </li>
            <li className="flex gap-3">
              <span className="text-[#C65D38]">✦</span>Si invitas a tu hogar, entráis antes. Y juntos.
            </li>
            <li className="flex gap-3">
              <span className="text-[#C65D38]">✦</span>Te borras de la lista con un clic, cuando quieras.
            </li>
          </ul>
        </div>

        <div className="md:col-span-7">
          <div className="rounded-[28px] border border-[#DDD6C5] bg-[#FFFEFA] p-6 md:p-10">
            {done ? (
              <WaitlistSuccess done={done} />
            ) : (
              <form onSubmit={submit} noValidate aria-describedby="waitlist-form-help">
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                  <Field label="Tu email" htmlFor="waitlist-email">
                    <input
                      id="waitlist-email"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      required
                      placeholder="tu@email.com"
                      value={form.email}
                      onChange={(e) => set("email", e.target.value)}
                      className="input-editorial"
                    />
                  </Field>
                  <Field label="Tu nombre (opcional)" htmlFor="waitlist-name">
                    <input
                      id="waitlist-name"
                      type="text"
                      autoComplete="given-name"
                      maxLength={60}
                      placeholder="Para saludarte bien"
                      value={form.firstName}
                      onChange={(e) => set("firstName", e.target.value)}
                      className="input-editorial"
                    />
                  </Field>
                </div>

                <ChoiceGroup
                  id="waitlist-household"
                  legend="¿Cuántos sois en casa?"
                  options={WAITLIST_HOUSEHOLD_SIZES.map((v) => [v, WAITLIST_HOUSEHOLD_SIZE_LABELS[v]])}
                  value={form.householdSize}
                  onChange={(v) => set("householdSize", v)}
                />
                <ChoiceGroup
                  id="waitlist-planner"
                  legend="¿Quién planifica las comidas y hace la compra?"
                  options={WAITLIST_PLANNER_ROLES.map((v) => [v, WAITLIST_PLANNER_ROLE_LABELS[v]])}
                  value={form.plannerRole}
                  onChange={(v) => set("plannerRole", v)}
                />
                <ChoiceGroup
                  id="waitlist-method"
                  legend="¿Cómo lo organizas hoy?"
                  options={WAITLIST_CURRENT_METHODS.map((v) => [v, WAITLIST_CURRENT_METHOD_LABELS[v]])}
                  value={form.currentMethod}
                  onChange={(v) => set("currentMethod", v)}
                />
                <ChoiceGroup
                  id="waitlist-platform"
                  legend="¿Qué móvil usas?"
                  options={WAITLIST_PLATFORMS.map((v) => [v, WAITLIST_PLATFORM_LABELS[v]])}
                  value={form.platform}
                  onChange={(v) => set("platform", v)}
                />

                <div className="mt-8">
                  <Field label="¿Dónde sueles hacer la compra? (opcional)" htmlFor="waitlist-supermarket">
                    <input
                      id="waitlist-supermarket"
                      type="text"
                      maxLength={80}
                      placeholder="El súper de siempre, el mercado del barrio…"
                      value={form.supermarket}
                      onChange={(e) => set("supermarket", e.target.value)}
                      className="input-editorial"
                    />
                  </Field>
                </div>

                {/* Honeypot: off-screen, no tab stop, ignored by autofill. People never see it. */}
                <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
                  <label htmlFor="waitlist-website">No rellenes este campo</label>
                  <input
                    id="waitlist-website"
                    name="website"
                    type="text"
                    tabIndex={-1}
                    autoComplete="off"
                    value={form.website}
                    onChange={(e) => set("website", e.target.value)}
                  />
                </div>

                <div className="mt-8 space-y-4">
                  <CheckRow
                    id="waitlist-whatsapp"
                    checked={form.wantsWhatsapp}
                    onChange={(v) => set("wantsWhatsapp", v)}
                    label={`Quiero usar ${BRAND_NAME} por WhatsApp cuando entre`}
                    hint="La invitación te llega por email, con el enlace para escribirle por WhatsApp."
                  />
                  <CheckRow
                    id="waitlist-newsletter"
                    checked={form.newsletterOptIn}
                    onChange={(v) => set("newsletterOptIn", v)}
                    label="Quiero recibir cada viernes el menú de la semana por email"
                    hint="Opcional y aparte de la lista. Te das de baja con un clic."
                  />
                  <CheckRow
                    id="waitlist-consent"
                    checked={form.consent}
                    onChange={(v) => set("consent", v)}
                    label={
                      <>
                        He leído la{" "}
                        <Link href="/privacidad#lista-de-espera" target="_blank" className="underline underline-offset-4">
                          política de privacidad
                        </Link>{" "}
                        y quiero entrar en la lista de espera.
                      </>
                    }
                  />
                </div>

                {error && (
                  <p role="alert" className="mt-6 rounded-2xl bg-[#C65D38]/10 px-4 py-3 text-sm text-[#8A3B22]">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={!complete || status === "sending"}
                  className="mt-8 inline-flex w-full items-center justify-center gap-2.5 rounded-full bg-[#1A1612] px-7 py-4 text-base font-medium text-[#FAF6EE] transition-colors hover:bg-[#2D6A4F] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-[#1A1612]"
                >
                  {status === "sending" ? "Apuntándote…" : "Apuntarme a la lista"}
                  <ArrowUpRight size={18} />
                </button>
                <p id="waitlist-form-help" className="mt-3 text-center text-xs text-[#7A7066]">
                  {complete
                    ? "Sin tarjeta. Solo te escribimos para invitarte (y los viernes, si lo has marcado)."
                    : "Te falta el email, alguna de las cuatro preguntas o la casilla de privacidad."}
                </p>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

function WaitlistSuccess({ done }: { done: WaitlistSignupResponse & { origin: string; firstName: string } }) {
  const url = waitlistReferralUrl(done.origin, done.code)
  return (
    <div role="status" aria-live="polite" data-testid="waitlist-success">
      <div className="text-eyebrow mb-4 text-[#2D6A4F]">Hecho</div>
      <h3 className="text-editorial-md">
        Ya estás en la lista{done.firstName ? `, ${done.firstName}` : ""}.
      </h3>
      <p className="mt-6 text-base leading-relaxed text-[#4A4239]">
        Entramos por tandas, cada dos a cuatro semanas, porque cada hogar lo acompañamos de cerca. No hay número
        de turno que vigilar: cuando te toque, te llega un email.
      </p>

      <div className="mt-10 border-t border-dashed border-[#DDD6C5] pt-8">
        <h4 className="font-display text-2xl text-[#1A1612]">
          Invita a tu hogar <span className="font-italic italic text-[#C65D38]">y entráis antes</span>
        </h4>
        <p className="mt-3 text-sm leading-relaxed text-[#4A4239]">
          Si alguien de tu casa (o tu hermana, la que también improvisa la cena) se apunta con tu enlace, os damos
          prioridad y entráis juntos.
        </p>
        <div className="mt-5">
          <ReferralShare url={url} />
        </div>
        <Link href={waitlistStatusPath(done.code)} className="link-reveal mt-2 inline-block text-sm font-medium text-[#1A1612]">
          Ver a cuántas personas has invitado
        </Link>
      </div>

      {done.unsubscribeToken && (
        <p className="mt-8 text-xs leading-relaxed text-[#7A7066]">
          ¿Cambio de planes?{" "}
          <Link href={waitlistUnsubscribePath(done.unsubscribeToken)} className="underline underline-offset-4">
            Date de baja aquí
          </Link>
          . También va un enlace de baja en cada email que te mandemos.
        </p>
      )}
    </div>
  )
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="text-eyebrow block text-[#7A7066]">
        {label}
      </label>
      {children}
    </div>
  )
}

function ChoiceGroup<T extends string>({
  id,
  legend,
  options,
  value,
  onChange,
}: {
  id: string
  legend: string
  options: Array<[T, string]>
  value: T | ""
  onChange: (v: T) => void
}) {
  return (
    <div className="mt-8">
      <div id={`${id}-legend`} className="mb-3 text-sm font-medium text-[#1A1612]">
        {legend}
      </div>
      <div role="radiogroup" aria-labelledby={`${id}-legend`} className="flex flex-wrap gap-2">
        {options.map(([v, label]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={value === v}
            data-active={value === v}
            onClick={() => onChange(v)}
            className="chip-filter"
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}

function CheckRow({
  id,
  checked,
  onChange,
  label,
  hint,
}: {
  id: string
  checked: boolean
  onChange: (v: boolean) => void
  label: React.ReactNode
  hint?: string
}) {
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="mt-0.5 h-5 w-5 shrink-0 accent-[#2D6A4F]"
      />
      <div>
        <label htmlFor={id} className="text-sm leading-snug text-[#1A1612]">
          {label}
        </label>
        {hint && (
          <p id={`${id}-hint`} className="mt-1 text-xs text-[#7A7066]">
            {hint}
          </p>
        )}
      </div>
    </div>
  )
}
