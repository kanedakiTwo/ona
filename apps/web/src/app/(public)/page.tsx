"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { motion, useScroll, useTransform, useInView, animate } from "motion/react"
import { ArrowUpRight, ArrowRight } from "lucide-react"
import { useAuth } from "@/lib/auth"
import WaitlistSection, { WAITLIST_ANCHOR } from "@/components/waitlist/WaitlistSection"

/* ═══════════════════════════════════════════
   Premium Unsplash food photography
   ═══════════════════════════════════════════ */
const HERO_IMG = "https://images.unsplash.com/photo-1490645935967-10de6ba17061?w=1600&q=85&auto=format&fit=crop"
const STEP1_IMG = "https://images.unsplash.com/photo-1466637574441-749b8f19452f?w=900&q=80&auto=format&fit=crop"
const STEP2_IMG = "https://images.unsplash.com/photo-1547592180-85f173990554?w=900&q=80&auto=format&fit=crop"
const STEP3_IMG = "https://images.unsplash.com/photo-1542838132-92c53300491e?w=900&q=80&auto=format&fit=crop"

/* ═══════════════════════════════════════════
   The Page
   ═══════════════════════════════════════════ */
export default function LandingPage() {
  const { user, isLoading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading && user) {
      router.push(user.onboardingDone ? "/menu" : "/onboarding")
    }
  }, [user, isLoading, router])

  return (
    <div className="bg-[#FAF6EE] text-[#1A1612] grain-subtle">
      <Hero />
      <Marquee />
      <Problem />
      <Steps />
      <Opinionated />
      <Differential />
      <Manifesto />
      <Counter />
      <WaitlistSection />
      <FinalCTA />
    </div>
  )
}

/* ═══════════════════════════════════════════
   01 — Hero (editorial, cinematic)
   ═══════════════════════════════════════════ */
function Hero() {
  const containerRef = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end start"],
  })
  const y = useTransform(scrollYProgress, [0, 1], [0, 200])
  const scale = useTransform(scrollYProgress, [0, 1], [1, 1.08])
  const opacity = useTransform(scrollYProgress, [0, 0.7], [1, 0])

  return (
    <section
      ref={containerRef}
      className="relative min-h-[100svh] overflow-hidden pt-20"
    >
      {/* Side metadata */}
      <div className="pointer-events-none absolute inset-0 z-30 hidden md:block">
        <div className="absolute left-8 top-1/2 origin-left -translate-y-1/2 -rotate-90 text-[10px] uppercase tracking-[0.3em] text-[#7A7066]">
          Mimoia · Nº 01 · Otoño 2026
        </div>
        <div className="absolute right-8 top-1/2 origin-right -translate-y-1/2 rotate-90 text-[10px] uppercase tracking-[0.3em] text-[#7A7066]">
          Cocina de casa, sin pensarla
        </div>
      </div>

      {/* Hero content grid */}
      <div className="relative z-10 mx-auto grid max-w-7xl grid-cols-1 gap-y-12 px-6 pb-16 pt-12 md:grid-cols-12 md:gap-x-8 md:px-10 md:pb-24 md:pt-16">
        {/* Left column — text */}
        <motion.div
          className="md:col-span-7"
          initial="hidden"
          animate="visible"
          variants={{
            hidden: {},
            visible: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
          }}
        >
          <motion.div
            className="mb-8 flex items-center gap-3 text-[10px] uppercase tracking-[0.25em] text-[#7A7066]"
            variants={fadeUp}
          >
            <span className="h-[1px] w-8 bg-[#7A7066]" />
            <span>Para quien piensa la comida de toda la casa</span>
          </motion.div>

          <h1 className="text-editorial-xl">
            <motion.span variants={fadeUp} className="block">
              Lo cansado
            </motion.span>
            <motion.span variants={fadeUp} className="block">
              no es <span className="font-italic italic">cocinar.</span>
            </motion.span>
            <motion.span variants={fadeUp} className="block text-[#2D6A4F]">
              Es decidir.
            </motion.span>
          </h1>

          <motion.p
            variants={fadeUp}
            className="mt-10 max-w-md text-base leading-relaxed text-[#4A4239] md:text-lg"
          >
            Mimoia piensa vuestra semana: un menú de temporada a vuestro gusto, la lista de la compra hecha y un mensaje por WhatsApp cuando toca descongelar o ir a comprar. Tú solo dices «vale» o «cámbiame el jueves».
          </motion.p>

          <motion.div variants={fadeUp} className="mt-10 flex flex-wrap items-center gap-4">
            <MagneticButton href={`#${WAITLIST_ANCHOR}`}>
              Quiero mi semana pensada
              <ArrowUpRight size={16} />
            </MagneticButton>
            <Link
              href="/como-funciona"
              className="link-reveal text-sm font-medium text-[#1A1612]"
            >
              Cómo funciona
            </Link>
          </motion.div>

          <motion.p variants={fadeUp} className="mt-10 text-xs text-[#7A7066]">
            Gratis durante la beta · Entramos por tandas · Te borras con un clic
          </motion.p>
        </motion.div>

        {/* Right column — image */}
        <motion.div
          className="relative md:col-span-5"
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1.2, ease: [0.19, 1, 0.22, 1] }}
        >
          <div className="relative aspect-[4/5] overflow-hidden rounded-[28px]">
            <motion.div
              className="absolute inset-0"
              style={{ y, scale }}
            >
              <img
                src={HERO_IMG}
                alt="Una cena de casa preparada"
                className="h-full w-full object-cover"
              />
            </motion.div>
            <div className="absolute inset-0 bg-gradient-to-t from-[#1A1612]/30 via-transparent to-transparent" />
            <motion.div
              className="absolute bottom-6 left-6 right-6 flex items-center justify-between rounded-2xl bg-[#FAF6EE]/95 px-4 py-3 backdrop-blur-sm"
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.8, duration: 0.8, ease: [0.19, 1, 0.22, 1] }}
            >
              <div>
                <div className="text-[9px] uppercase tracking-[0.2em] text-[#7A7066]">Esta noche cenáis</div>
                <div className="font-display text-base text-[#1A1612]">Crema de calabaza y tortilla</div>
              </div>
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#2D6A4F] text-white">
                <ArrowRight size={14} />
              </div>
            </motion.div>
          </div>

          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 1.1, duration: 0.6 }}
            className="absolute -left-4 top-12 hidden rotate-[-6deg] rounded-full bg-[#FAF6EE] px-4 py-2 text-[10px] uppercase tracking-[0.18em] shadow-[0_8px_24px_-8px_rgba(26,22,18,0.18)] md:block"
          >
            Mimoia · 19:02 · WhatsApp
          </motion.div>
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 1.2, duration: 0.6 }}
            className="absolute -right-4 bottom-32 hidden rotate-[5deg] rounded-full bg-[#2D6A4F] px-4 py-2 text-[10px] uppercase tracking-[0.18em] text-white md:block"
          >
            ✓ Sin cebolla para Lucas
          </motion.div>
        </motion.div>
      </div>

      <motion.div
        className="absolute bottom-8 left-1/2 z-10 -translate-x-1/2"
        style={{ opacity }}
        initial={{ y: 0 }}
        animate={{ y: [0, 8, 0] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
      >
        <div className="text-[9px] uppercase tracking-[0.3em] text-[#7A7066]">Sigue</div>
      </motion.div>
    </section>
  )
}

/* ═══════════════════════════════════════════
   Marquee strip
   ═══════════════════════════════════════════ */
function Marquee() {
  const items = [
    "Sin contar calorías",
    "Menús de temporada",
    "La lista sale sola",
    "Te escribe por WhatsApp",
    "Pensado para toda la casa",
    "Se acuerda de quién no come qué",
    "Pide a tus tiendas de siempre",
  ]
  return (
    <section className="overflow-hidden border-y border-[#E8E2D3] bg-[#FAF6EE] py-6">
      <div className="marquee">
        {[...items, ...items].map((item, i) => (
          <div key={i} className="flex items-center gap-8 px-6 text-sm">
            <span className="font-italic italic text-[#1A1612]">{item}</span>
            <span className="text-[#C65D38]">✦</span>
          </div>
        ))}
      </div>
    </section>
  )
}

/* ═══════════════════════════════════════════
   02 — The problem (editorial cards)
   ═══════════════════════════════════════════ */
function Problem() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.2 })

  const problems = [
    { num: "01", text: "Las 19:30, la nevera abierta y la misma pregunta: «¿qué cenamos?»", emoji: "🌙" },
    { num: "02", text: "Doscientas recetas guardadas en Instagram. Cocinadas: tres.", emoji: "📱" },
    { num: "03", text: "Cuatro visitas al súper esta semana. Y aun así falta algo.", emoji: "🛒" },
    { num: "04", text: "El calabacín que se pone pocho en el cajón. Otra vez.", emoji: "🥒" },
  ]

  return (
    <section ref={ref} className="relative px-6 py-24 md:px-10 md:py-32">
      <div className="mx-auto max-w-7xl">
        <div className="grid grid-cols-1 gap-12 md:grid-cols-12 md:gap-8">
          <div className="md:col-span-5">
            <div className="text-eyebrow mb-6">Capítulo 01</div>
            <h2 className="text-editorial-lg">
              No te faltan <span className="font-italic italic">recetas</span>.
              <br />
              Te falta <span className="text-[#C65D38]">alguien</span> que se acuerde.
            </h2>
            <p className="mt-8 max-w-md text-base leading-relaxed text-[#4A4239]">
              Recetas tienes de sobra. Lo que agota es ser quien siempre decide: qué se cena, quién no come qué, qué falta en la despensa y qué se va a estropear si no lo usas hoy. Todos los días. Sin que nadie lo vea.
            </p>
          </div>

          <div className="md:col-span-7">
            <div className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl bg-[#E8E2D3] sm:grid-cols-2">
              {problems.map((p, i) => (
                <motion.div
                  key={p.num}
                  initial={{ opacity: 0, y: 24 }}
                  animate={inView ? { opacity: 1, y: 0 } : {}}
                  transition={{ delay: i * 0.1, duration: 0.7, ease: [0.19, 1, 0.22, 1] }}
                  className="group relative bg-[#FAF6EE] p-8 transition-colors hover:bg-white"
                >
                  <div className="flex items-start justify-between">
                    <span className="font-display text-3xl text-[#C65D38]/70">{p.num}</span>
                    <span className="text-2xl transition-transform group-hover:rotate-12 group-hover:scale-110">{p.emoji}</span>
                  </div>
                  <p className="mt-8 text-lg leading-snug text-[#1A1612]">{p.text}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: 1 } : {}}
          transition={{ delay: 0.6, duration: 0.8 }}
          className="mt-16 border-t border-[#DDD6C5] pt-8 text-center"
        >
          <p className="font-display text-2xl text-[#1A1612] md:text-3xl">
            Mimoia <span className="font-italic italic text-[#2D6A4F]">se acuerda</span> por ti. Y te escribe cuando toca.
          </p>
        </motion.div>
      </div>
    </section>
  )
}

/* ═══════════════════════════════════════════
   03 — How it works (alternating)
   ═══════════════════════════════════════════ */
function Steps() {
  const steps = [
    {
      num: "01",
      eyebrow: "Una vez",
      title: "Cuéntale cómo sois en casa.",
      desc: "Cuántos sois, quién no come qué, cuánto tiempo tenéis entre semana y tres platos que os encantan. Por la app o por WhatsApp, como te sea más cómodo.",
      img: STEP1_IMG,
    },
    {
      num: "02",
      eyebrow: "Cada semana",
      title: "Recibe la semana pensada.",
      desc: "Un menú de temporada y variado, que aprovecha lo que ya tienes en la despensa. ¿El jueves no te apetece? Escríbele «cámbiame el jueves» y listo.",
      img: STEP2_IMG,
    },
    {
      num: "03",
      eyebrow: "Sin vueltas",
      title: "Compra y cocina.",
      desc: "La lista sale sola, por pasillos y sin lo que ya tienes en casa. Compártela con quien va al súper, o mándasela a tu frutería y a tu carnicería por WhatsApp.",
      img: STEP3_IMG,
    },
  ]

  return (
    <section className="bg-[#F2EDE0] px-6 py-24 md:px-10 md:py-32">
      <div className="mx-auto max-w-7xl">
        <div className="mb-20 grid grid-cols-1 items-end gap-6 md:grid-cols-12">
          <div className="md:col-span-6">
            <div className="text-eyebrow mb-4">Capítulo 02</div>
            <h2 className="text-editorial-lg">
              <span className="font-italic italic">Tres</span> pasos.
              <br />
              Y luego, casi nada.
            </h2>
            {/* Subtitle is rendered to the right (md:col-start-8). */}
          </div>
          <div className="md:col-span-5 md:col-start-8">
            <p className="text-base leading-relaxed text-[#4A4239]">
              Lo contrario de esas apps que te piden apuntar cada caloría y cada vaso de agua. Aquí le cuentas a Mimoia cómo sois en casa una vez, y ella se encarga del resto.
            </p>
          </div>
        </div>

        <div className="space-y-32">
          {steps.map((step, i) => (
            <StepRow key={step.num} step={step} reverse={i % 2 === 1} />
          ))}
        </div>
      </div>
    </section>
  )
}

function StepRow({
  step,
  reverse,
}: {
  step: { num: string; eyebrow: string; title: string; desc: string; img: string }
  reverse: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.3 })
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  })
  const imgY = useTransform(scrollYProgress, [0, 1], [40, -40])

  return (
    <div
      ref={ref}
      className={`grid grid-cols-1 items-center gap-8 md:grid-cols-12 md:gap-16 ${reverse ? "md:[direction:rtl]" : ""}`}
    >
      <motion.div
        className="md:col-span-6 md:[direction:ltr]"
        initial={{ opacity: 0, y: 32 }}
        animate={inView ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.9, ease: [0.19, 1, 0.22, 1] }}
      >
        <div className="relative aspect-[4/5] overflow-hidden rounded-[24px]">
          <motion.img
            src={step.img}
            alt={step.title}
            className="h-full w-full object-cover"
            style={{ y: imgY, scale: 1.15 }}
          />
          <div className="absolute left-6 top-6 rounded-full bg-[#FAF6EE]/90 px-3 py-1 text-[10px] uppercase tracking-[0.2em] backdrop-blur-sm">
            Paso {step.num}
          </div>
        </div>
      </motion.div>

      <motion.div
        className="md:col-span-6 md:[direction:ltr]"
        initial={{ opacity: 0, y: 24 }}
        animate={inView ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.9, delay: 0.15, ease: [0.19, 1, 0.22, 1] }}
      >
        <div className="font-display text-[9rem] leading-none text-[#C65D38]/15 md:text-[12rem]">
          {step.num}
        </div>
        <div className="-mt-12 md:-mt-16">
          <div className="text-eyebrow mb-3 text-[#C65D38]">{step.eyebrow}</div>
          <h3 className="text-editorial-md">{step.title}</h3>
          <p className="mt-6 max-w-md text-base leading-relaxed text-[#4A4239]">{step.desc}</p>
        </div>
      </motion.div>
    </div>
  )
}

/* ═══════════════════════════════════════════
   03b — Criterio + memoria
   ═══════════════════════════════════════════ */
function Opinionated() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.2 })

  const exchanges = [
    {
      day: "domingo 10:14",
      user: "Los domingos comemos en casa de mi madre. No me pongas nada ese día.",
      ona: "Hecho. Los domingos a mediodía quedan libres.",
    },
    {
      day: "martes 18:02",
      user: "Lucas ha decidido que odia la cebolla. Otra vez.",
      ona: "Anotado: nada de cebolla a la vista en sus platos. No se va a enterar.",
    },
    {
      day: "jueves 19:40",
      user: "Te mando por foto las lentejas de mi abuela.",
      ona: "Guardadas. ¿Te las pongo el lunes, que viene frío?",
    },
  ]

  return (
    <section ref={ref} className="relative px-6 py-24 md:px-10 md:py-32">
      <div className="mx-auto max-w-7xl">
        <div className="grid grid-cols-1 gap-12 md:grid-cols-12 md:gap-16">
          {/* Left column — title + manifesto */}
          <div className="md:col-span-5">
            <div className="text-eyebrow mb-6">Capítulo 03 · La memoria</div>
            <h2 className="text-editorial-lg">
              Mimoia tiene <span className="font-italic italic">criterio</span>.
              <br />
              Y aprende el <span className="text-[#C65D38]">vuestro</span>.
            </h2>
            <p className="mt-8 max-w-md text-base leading-relaxed text-[#4A4239]">
              Mimoia arranca con una forma de cocinar clara: casera, variada, de temporada y con buen aceite de oliva. Pero no es un dictado: lo que le cuentas, lo recuerda y lo aplica la semana siguiente.
            </p>
            <p className="mt-8 font-display text-xl italic text-[#1A1612] md:text-2xl">
              Cuanto más le cuentas, menos tienes que pensar.
            </p>
          </div>

          {/* Right column — three chat-style exchanges */}
          <div className="md:col-span-7">
            <div className="space-y-4">
              {exchanges.map((ex, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 24 }}
                  animate={inView ? { opacity: 1, y: 0 } : {}}
                  transition={{ delay: i * 0.15, duration: 0.7, ease: [0.19, 1, 0.22, 1] }}
                  className="rounded-2xl border border-[#DDD6C5] bg-[#FFFEFA] p-5 md:p-6"
                >
                  <div className="text-[10px] uppercase tracking-[0.2em] text-[#7A7066]">
                    Tú · {ex.day}
                  </div>
                  <p className="mt-2 text-base leading-snug text-[#1A1612] md:text-lg">
                    “{ex.user}”
                  </p>
                  <div className="mt-4 ml-6 rounded-xl bg-[#F2EDE0] px-4 py-3">
                    <div className="text-[10px] uppercase tracking-[0.2em] text-[#2D6A4F]">
                      Mimoia
                    </div>
                    <p className="mt-1 text-sm leading-snug text-[#1A1612] md:text-base">
                      {ex.ona}
                    </p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ═══════════════════════════════════════════
   04 — Differential
   ═══════════════════════════════════════════ */
function Differential() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.2 })

  const rows = [
    { tracking: "Apuntas lo que ya comiste", ona: "Piensa lo que vais a comer" },
    { tracking: "Cuentan las calorías de una persona", ona: "Piensa en toda la casa" },
    { tracking: "Te piden algo cada día", ona: "Dos minutos a la semana" },
    { tracking: "Tienes que acordarte de abrir la app", ona: "Te escribe por WhatsApp cuando toca" },
    { tracking: "La lista de la compra la haces tú", ona: "La lista sale sola, y se la puedes mandar a tus tiendas" },
    { tracking: "Empiezan de cero cada vez", ona: "Recuerda lo que le vas contando" },
  ]

  return (
    <section ref={ref} className="px-6 py-24 md:px-10 md:py-32">
      <div className="mx-auto max-w-7xl">
        <div className="mb-16 grid grid-cols-1 items-end gap-6 md:grid-cols-12">
          <div className="md:col-span-7">
            <div className="text-eyebrow mb-4">Capítulo 04</div>
            <h2 className="text-editorial-lg">
              Mimoia no es una app de <span className="font-italic italic">dietas</span>.
            </h2>
          </div>
          <div className="md:col-span-4 md:col-start-9">
            <p className="text-base leading-relaxed text-[#4A4239]">
              Las apps de calorías miden lo que ya comiste. Mimoia piensa <em className="font-italic">lo que vais a comer</em>.
            </p>
          </div>
        </div>

        <div className="overflow-hidden rounded-[24px] border border-[#DDD6C5]">
          <div className="grid grid-cols-2 border-b border-[#DDD6C5] bg-[#F2EDE0]">
            <div className="p-6 md:p-8">
              <div className="text-eyebrow text-[#7A7066]">Las apps de calorías</div>
              <div className="mt-1 font-display text-2xl text-[#7A7066] line-through decoration-1">MyFitnessPal · Yazio</div>
            </div>
            <div className="border-l border-[#DDD6C5] p-6 md:p-8">
              <div className="text-eyebrow text-[#2D6A4F]">Mimoia</div>
              <div className="mt-1 font-display text-2xl text-[#1A1612]">Tu semana pensada</div>
            </div>
          </div>
          {rows.map((row, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -20 }}
              animate={inView ? { opacity: 1, x: 0 } : {}}
              transition={{ delay: i * 0.08, duration: 0.6 }}
              className="grid grid-cols-2 border-b border-[#DDD6C5] last:border-0"
            >
              <div className="flex items-start gap-3 p-6 text-[#7A7066] md:p-8">
                <span className="mt-1 text-base">✕</span>
                <span className="text-sm leading-snug md:text-base">{row.tracking}</span>
              </div>
              <div className="flex items-start gap-3 border-l border-[#DDD6C5] bg-[#FAF6EE] p-6 md:p-8">
                <span className="mt-1 text-base text-[#2D6A4F]">✓</span>
                <span className="text-sm font-medium leading-snug text-[#1A1612] md:text-base">{row.ona}</span>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ═══════════════════════════════════════════
   05 — Manifesto
   ═══════════════════════════════════════════ */
function Manifesto() {
  const ref = useRef<HTMLDivElement>(null)
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  })
  const y1 = useTransform(scrollYProgress, [0, 1], [60, -60])
  const y2 = useTransform(scrollYProgress, [0, 1], [-30, 30])

  return (
    <section ref={ref} className="relative overflow-hidden bg-[#1B4332] px-6 py-32 text-[#FAF6EE] md:px-10 md:py-40">
      <motion.div
        className="animate-blob absolute -right-32 top-1/2 h-96 w-96 -translate-y-1/2 bg-[#2D6A4F] opacity-30"
        style={{ y: y1 }}
      />
      <motion.div
        className="animate-blob absolute -left-24 bottom-0 h-72 w-72 bg-[#52B788] opacity-20"
        style={{ animationDelay: "-4s", y: y2 }}
      />

      <div className="relative mx-auto max-w-5xl text-center">
        <div className="text-eyebrow mb-8 text-[#95D5B2]">Manifiesto</div>
        <p className="text-editorial-lg text-[#FAF6EE]">
          No te pedimos que apuntes
          <br />
          lo que <span className="font-italic italic">ya</span> comiste.
          <br />
          Te pensamos lo que vais a comer
          <br />
          con <span className="font-italic italic text-[#52B788]">lo que ya nos contaste</span>.
        </p>
      </div>
    </section>
  )
}

/* ═══════════════════════════════════════════
   06 — Counter
   ═══════════════════════════════════════════ */
function Counter() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.4 })
  const [count, setCount] = useState(0)
  // A real number: the size of Mimoia's public catalogue (X-Total-Count of the
  // anonymous /recipes listing). The section used to animate to a made-up
  // "2.847 personas"; it now hides itself if the number can't be read.
  const [total, setTotal] = useState<number | null>(null)

  useEffect(() => {
    const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"
    fetch(`${base}/recipes?perPage=1`)
      .then((r) => (r.ok ? Number(r.headers.get("X-Total-Count")) : NaN))
      .then((n) => setTotal(Number.isFinite(n) && n > 0 ? n : null))
      .catch(() => setTotal(null))
  }, [])

  useEffect(() => {
    if (inView && total) {
      const controls = animate(0, total, {
        duration: 2.4,
        ease: [0.19, 1, 0.22, 1],
        onUpdate: (v) => setCount(Math.floor(v)),
      })
      return () => controls.stop()
    }
  }, [inView, total])

  // The observed wrapper is always mounted: swapping the ref'd element when
  // `total` arrives would leave useInView watching a detached node.
  return (
    <div ref={ref}>
      {total !== null && (
    <section className="bg-[#FAF6EE] px-6 py-24 md:px-10 md:py-32">
      <div className="mx-auto max-w-7xl text-center">
        <div className="text-eyebrow mb-8">El recetario</div>
        <div className="font-display text-[20vw] leading-[0.9] tracking-[-0.04em] text-[#1A1612] md:text-[14rem]">
          {count.toLocaleString("es-ES")}
        </div>
        <p className="mt-6 text-base text-[#4A4239] md:text-lg">
          recetas en el catálogo de Mimoia. Más las que tú guardes de Instagram, de TikTok o de tu abuela.
        </p>
      </div>
    </section>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════
   07 — Final CTA (the footer below it is the shared
   components/shared/Footer.tsx, rendered by the public layout)
   ═══════════════════════════════════════════ */
function FinalCTA() {
  return (
    <section className="bg-[#F2EDE0] px-6 pb-16 pt-32 md:px-10 md:pb-12 md:pt-48">
      <div className="mx-auto max-w-5xl text-center">
        <h2 className="text-editorial-xl">
          La cena de <span className="font-italic italic text-[#C65D38]">esta</span> noche,
          <br />
          ya pensada.
          <br />
          Las <span className="font-italic italic">siguientes</span>,
          <br />
          <span className="text-[#C65D38]">también</span>.
        </h2>
        <div className="mt-12 flex flex-col items-center gap-4">
          <MagneticButton href={`#${WAITLIST_ANCHOR}`} size="lg">
            Quiero mi semana pensada
            <ArrowUpRight size={20} />
          </MagneticButton>
          <p className="text-xs text-[#7A7066]">
            Gratis durante la beta · Sin tarjeta · Te borras con un clic
          </p>
        </div>
      </div>
    </section>
  )
}

/* ═══════════════════════════════════════════
   Magnetic button
   ═══════════════════════════════════════════ */
function MagneticButton({
  children,
  href,
  size = "md",
}: {
  children: React.ReactNode
  href: string
  size?: "md" | "lg"
}) {
  const ref = useRef<HTMLAnchorElement>(null)

  function handleMouseMove(e: React.MouseEvent<HTMLAnchorElement>) {
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    ref.current.style.setProperty("--mouse-x", `${(x / rect.width) * 100}%`)
    ref.current.style.setProperty("--mouse-y", `${(y / rect.height) * 100}%`)
    const dx = (x - rect.width / 2) * 0.15
    const dy = (y - rect.height / 2) * 0.15
    ref.current.style.transform = `translate(${dx}px, ${dy}px)`
  }

  function handleMouseLeave() {
    if (!ref.current) return
    ref.current.style.transform = "translate(0, 0)"
  }

  // In-page anchors (the waitlist) scroll smoothly and keep the URL as is, so
  // `?invita=` / `?ref=` / `?utm_*` stay there for the form to read.
  function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (!href.startsWith("#")) return
    const target = document.getElementById(href.slice(1))
    if (!target) return
    e.preventDefault()
    target.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  return (
    <Link
      ref={ref}
      href={href}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
      className={`btn-magnetic group inline-flex items-center gap-2.5 rounded-full bg-[#1A1612] font-medium text-[#FAF6EE] transition-transform duration-300 ease-out hover:bg-[#2D6A4F] ${
        size === "lg" ? "px-7 py-4 text-base" : "px-6 py-3.5 text-sm"
      }`}
    >
      {children}
    </Link>
  )
}

/* ═══════════════════════════════════════════
   Animation variants
   ═══════════════════════════════════════════ */
const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.9, ease: [0.19, 1, 0.22, 1] as [number, number, number, number] } },
}
