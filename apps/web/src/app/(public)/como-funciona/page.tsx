"use client"

import { useState } from "react"
import Link from "next/link"
import { ChevronDown } from "lucide-react"

/* ────────────────────────────────────────────
   Steps data
   ──────────────────────────────────────────── */
const STEPS = [
  {
    num: "1",
    title: "Cuentale tus gustos",
    desc: "Al empezar, ONA te hace 5 preguntas rapidas: que te gusta, que no te gusta, cuantos sois en casa, cuanto tiempo tienes para cocinar entre semana, y si tienes alguna restriccion (vegano, sin gluten, alergias...). No necesitas saber de nutricion. Solo contestar con sinceridad.",
  },
  {
    num: "2",
    title: "Recibe tu menu semanal",
    desc: "Con tus respuestas, ONA genera un menu completo para toda la semana: desayuno, comida y cena. Cada semana es diferente, con variedad y equilibrio. Si algo no te convence, puedes cambiarlo con un toque. El menu se adapta a ti, no al reves.",
  },
  {
    num: "3",
    title: "Compra y cocina sin pensar",
    desc: "Tu lista de la compra se genera sola, organizada por pasillo del supermercado. Cuando toca cocinar, abres la receta y sigues los pasos. Sin buscar en internet, sin improvisar, sin estres. Solo cocinar y disfrutar.",
  },
]

/* ────────────────────────────────────────────
   FAQ data
   ──────────────────────────────────────────── */
const FAQS = [
  {
    q: "Es gratis de verdad?",
    a: "Si. ONA tiene un plan gratuito con el que puedes generar tu menu semanal, ver recetas y crear tu lista de la compra. Sin tarjeta de credito, sin periodos de prueba. En el futuro habra funcionalidades premium, pero el core de ONA siempre sera gratuito.",
  },
  {
    q: "Puedo personalizar el menu si no me gusta algo?",
    a: "Por supuesto. Si una receta no te convence, puedes cambiarla con un toque. ONA te sugiere alternativas que encajan con el resto de tu semana para que el equilibrio nutricional se mantenga.",
  },
  {
    q: "Funciona si soy vegano, celiaco o tengo alergias?",
    a: "Si. Durante el onboarding puedes indicar cualquier restriccion alimentaria: vegetariano, vegano, sin gluten, sin lactosa, alergias a frutos secos, etc. ONA solo te propondra recetas compatibles con tu perfil.",
  },
  {
    q: "Cuanto tiempo lleva usar ONA cada semana?",
    a: "Unos 2 minutos. Abres la app, generas tu menu de la semana (o aceptas la sugerencia de ONA) y listo. La lista de la compra se crea sola. El resto de la semana solo tienes que abrir la receta del dia y cocinar.",
  },
]

/* ════════════════════════════════════════════
   FAQ Accordion Item
   ════════════════════════════════════════════ */
function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="border-b border-[#DDDDDD]">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between py-5 text-left"
      >
        <span className="text-h4 text-[#1A1A1A]">{q}</span>
        <ChevronDown
          size={20}
          className={`shrink-0 text-[#777777] transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      <div
        className="overflow-hidden transition-all duration-300"
        style={{ maxHeight: open ? "400px" : "0", opacity: open ? 1 : 0 }}
      >
        <p className="pb-5 leading-relaxed text-[#444444]">{a}</p>
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════
   Page component
   ════════════════════════════════════════════ */
export default function ComoFuncionaPage() {
  return (
    <>
      {/* ── Hero ──────────────────────────── */}
      <section className="bg-[#D8F3DC] py-16 md:py-24">
        <div className="mx-auto max-w-3xl px-4 text-center">
          <h1 className="text-h1 text-[#1B4332]">Asi funciona ONA</h1>
          <p className="text-body-lg mt-4 text-[#444444]">
            Tres pasos. Sin complicaciones. Tu menu semanal listo antes de que te de tiempo a
            pensar &quot;que hago de comer hoy&quot;.
          </p>
        </div>
      </section>

      {/* ── Steps (alternating layout) ────── */}
      <section className="bg-white py-16 md:py-24">
        <div className="mx-auto max-w-5xl px-4">
          {STEPS.map((step, i) => {
            const reversed = i % 2 !== 0
            return (
              <div
                key={step.num}
                className={`mb-20 grid items-center gap-10 last:mb-0 md:grid-cols-2 ${
                  reversed ? "md:direction-rtl" : ""
                }`}
              >
                {/* Text side */}
                <div className={reversed ? "md:order-2" : ""}>
                  <span className="font-[family-name:var(--font-display)] text-[72px] leading-none text-[#2D6A4F]">
                    {step.num}
                  </span>
                  <h2 className="text-h2 mt-2 text-[#1A1A1A]">{step.title}</h2>
                  <p className="mt-4 text-base leading-relaxed text-[#444444]">{step.desc}</p>
                </div>

                {/* Image placeholder side */}
                <div className={reversed ? "md:order-1" : ""}>
                  <div className="flex h-[280px] w-full items-center justify-center rounded-xl bg-[#F7F7F7] text-sm text-[#777777]">
                    Ilustracion paso {step.num}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* ── FAQ ───────────────────────────── */}
      <section className="bg-white py-16 md:py-24">
        <div className="mx-auto max-w-[720px] px-4">
          <h2 className="text-h2 mb-10 text-center text-[#2D6A4F]">Preguntas frecuentes</h2>
          <div className="border-t border-[#DDDDDD]">
            {FAQS.map((faq) => (
              <FaqItem key={faq.q} q={faq.q} a={faq.a} />
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA final ─────────────────────── */}
      <section className="bg-[#D8F3DC] py-16 md:py-24">
        <div className="mx-auto max-w-3xl px-4 text-center">
          <h2 className="text-h1 text-[#1B4332]">
            Tu menu de esta semana esta a 2 minutos.
          </h2>

          <div className="mt-8">
            <Link href="/register" className="btn-primary btn-l inline-flex items-center">
              Empezar gratis &rarr;
            </Link>
          </div>

          <p className="mt-4 text-sm text-[#777777]">
            Sin tarjeta &middot; Sin compromiso &middot; Cancela cuando quieras
          </p>
        </div>
      </section>
    </>
  )
}
