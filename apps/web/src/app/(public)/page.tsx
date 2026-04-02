"use client"

import { useEffect, useRef } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CheckCircle, XCircle } from "lucide-react"
import { useAuth } from "@/lib/auth"

/* ────────────────────────────────────────────
   Block 2 — Problem cards data
   ──────────────────────────────────────────── */
const PROBLEMS = [
  { emoji: "😩", text: "Son las 14:00 y no sabes que comer" },
  { emoji: "🛒", text: "Vas al super sin lista y compras de mas" },
  { emoji: "🗑️", text: "Tiras comida cada semana" },
  { emoji: "🔁", text: "Repites los mismos 5 platos siempre" },
]

/* ────────────────────────────────────────────
   Block 3 — Steps data
   ──────────────────────────────────────────── */
const STEPS = [
  {
    num: "1",
    title: "Cuentale tus gustos",
    desc: "ONA te hace 5 preguntas rapidas sobre lo que te gusta, lo que no, cuantos sois en casa y cuanto tiempo tienes para cocinar.",
  },
  {
    num: "2",
    title: "Recibe tu menu",
    desc: "ONA genera tu semana completa: desayuno, comida y cena. Con variedad, equilibrio y recetas que de verdad vas a hacer.",
  },
  {
    num: "3",
    title: "Compra y cocina",
    desc: "Tu lista de la compra sale sola, organizada por pasillo. Abre la receta y cocina paso a paso.",
  },
]

/* ────────────────────────────────────────────
   Block 4 — Comparison data
   ──────────────────────────────────────────── */
const COMPARISONS = [
  { other: "Cuentas calorias todo el dia", ona: "ONA te da un plan, no deberes" },
  { other: "Necesitas saber de nutricion", ona: "ONA ya lo sabe por ti" },
  { other: "Te sientes culpable si fallas", ona: "ONA se adapta a tu semana" },
  { other: "Pierdes 30 min decidiendo que comer", ona: "Tu menu esta listo en 2 minutos" },
  { other: "La app te juzga", ona: "ONA te ayuda sin drama" },
]

/* ════════════════════════════════════════════
   Landing page component
   ════════════════════════════════════════════ */
export default function LandingPage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()
  const problemsRef = useRef<HTMLDivElement>(null)

  /* Redirect authenticated users to their menu */
  useEffect(() => {
    if (!isLoading && user) {
      router.push(user.onboardingDone ? "/menu" : "/onboarding")
    }
  }, [user, isLoading, router])

  /* Stagger-animate problem cards on scroll */
  useEffect(() => {
    const el = problemsRef.current
    if (!el) return

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const cards = el.querySelectorAll<HTMLElement>("[data-problem-card]")
            cards.forEach((card, i) => {
              setTimeout(() => {
                card.style.opacity = "1"
                card.style.transform = "translateY(0)"
              }, i * 100)
            })
            observer.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.2 }
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  /* While checking auth, show nothing (avoids flash of landing for logged-in users) */
  if (isLoading || user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg text-[#777777]">Cargando...</p>
      </div>
    )
  }

  return (
    <>
      {/* ── Block 1: Hero ─────────────────── */}
      <section className="bg-[#D8F3DC]">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 md:grid-cols-2 md:items-center md:gap-16 md:py-24">
          {/* Left column */}
          <div>
            <h1 className="text-hero text-[#1B4332]">
              Deja de improvisar que comer. ONA te da el plan.
            </h1>
            <p className="text-body-lg mt-6 text-[#444444]">
              Tu menu semanal listo en 2 minutos. Con la lista de la compra incluida.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link href="/register" className="btn-primary btn-l inline-flex items-center">
                Crear mi primer menu &rarr;
              </Link>
              <a
                href="#como-funciona"
                className="btn-ghost text-base"
              >
                Ver como funciona &darr;
              </a>
            </div>

            <p className="mt-4 text-sm text-[#777777]">
              Sin tarjeta de credito &middot; Gratis para empezar
            </p>
          </div>

          {/* Right column — placeholder mockup */}
          <div className="flex items-center justify-center">
            <div className="flex h-[360px] w-full max-w-[400px] items-center justify-center rounded-xl bg-[#c4e8c9] text-[#2D6A4F] font-medium">
              Menu semanal preview
            </div>
          </div>
        </div>
      </section>

      {/* ── Block 2: El problema ──────────── */}
      <section className="bg-white py-16 md:py-24">
        <div className="mx-auto max-w-[720px] px-4 text-center">
          <h2 className="text-h2 text-[#2D6A4F]">Te suena esto?</h2>

          <div ref={problemsRef} className="mt-10 space-y-4 text-left">
            {PROBLEMS.map((p, i) => (
              <div
                key={i}
                data-problem-card
                className="flex items-start gap-4 rounded-lg bg-[#F7F7F7] p-5 transition-all duration-300"
                style={{ opacity: 0, transform: "translateY(16px)" }}
              >
                <span className="text-2xl leading-none">{p.emoji}</span>
                <p className="text-base text-[#1A1A1A]">{p.text}</p>
              </div>
            ))}
          </div>

          <p className="text-body-lg mt-10 font-medium text-[#2D6A4F]">
            ONA corta ese ciclo. Una sesion semanal, 2 minutos.
          </p>
        </div>
      </section>

      {/* ── Block 3: Como funciona ────────── */}
      <section id="como-funciona" className="bg-[#D8F3DC] py-16 md:py-24">
        <div className="mx-auto max-w-6xl px-4 text-center">
          <h2 className="text-h2 text-[#2D6A4F]">Tres pasos. Sin complicaciones.</h2>

          <div className="mt-12 grid gap-10 md:grid-cols-3">
            {STEPS.map((step) => (
              <div key={step.num} className="text-left">
                <span className="font-[family-name:var(--font-display)] text-[72px] leading-none text-[#2D6A4F]">
                  {step.num}
                </span>
                <h4 className="text-h4 mt-2 text-[#1A1A1A]">{step.title}</h4>
                <p className="mt-2 text-base leading-relaxed text-[#444444]">{step.desc}</p>
              </div>
            ))}
          </div>

          <div className="mt-12">
            <Link href="/register" className="btn-primary btn-m inline-flex items-center">
              Empezar gratis &rarr;
            </Link>
          </div>
        </div>
      </section>

      {/* ── Block 4: Diferencial ──────────── */}
      <section className="bg-white py-16 md:py-24">
        <div className="mx-auto max-w-4xl px-4 text-center">
          <h2 className="text-h2 text-[#2D6A4F]">ONA no es una app de tracking</h2>

          <div className="mt-12 overflow-hidden rounded-xl border border-[#DDDDDD]">
            {/* Header row */}
            <div className="grid grid-cols-2">
              <div className="bg-[#F7F7F7] px-5 py-4 text-left text-sm font-semibold text-[#777777]">
                Apps de tracking
              </div>
              <div className="bg-[#D8F3DC] px-5 py-4 text-left text-sm font-semibold text-[#2D6A4F]">
                ONA
              </div>
            </div>

            {/* Rows */}
            {COMPARISONS.map((row, i) => (
              <div
                key={i}
                className="grid grid-cols-2 border-t border-[#DDDDDD]"
              >
                <div className="flex items-start gap-3 bg-[#F7F7F7] px-5 py-4 text-left">
                  <XCircle size={18} className="mt-0.5 shrink-0 text-[#B5451B]" />
                  <span className="text-sm text-[#444444]">{row.other}</span>
                </div>
                <div className="flex items-start gap-3 bg-[#D8F3DC] px-5 py-4 text-left">
                  <CheckCircle size={18} className="mt-0.5 shrink-0 text-[#2D6A4F]" />
                  <span className="text-sm text-[#1A1A1A]">{row.ona}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Block 5: Social proof ─────────── */}
      <section className="bg-[#1B4332] py-16 md:py-24">
        <div className="mx-auto max-w-4xl px-4 text-center">
          <p className="font-[family-name:var(--font-display)] text-3xl leading-tight text-white md:text-4xl">
            127 personas ya tienen su menu de esta semana
          </p>
        </div>
      </section>

      {/* ── Block 6: CTA final ────────────── */}
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
