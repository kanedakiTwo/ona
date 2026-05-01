"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { motion, useScroll, useTransform, useInView, animate } from "motion/react"
import { ArrowUpRight, ArrowRight } from "lucide-react"
import { useAuth } from "@/lib/auth"

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
      <Differential />
      <Manifesto />
      <Counter />
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
          ONA · Issue №01 · Spring 2026
        </div>
        <div className="absolute right-8 top-1/2 origin-right -translate-y-1/2 rotate-90 text-[10px] uppercase tracking-[0.3em] text-[#7A7066]">
          Cook with intention
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
            <span>Un asistente con criterio</span>
          </motion.div>

          <h1 className="text-editorial-xl">
            <motion.span variants={fadeUp} className="block">
              El <span className="font-italic italic">placer</span>
            </motion.span>
            <motion.span variants={fadeUp} className="block">
              de cocinar
            </motion.span>
            <motion.span variants={fadeUp} className="block text-[#2D6A4F]">
              sin pensar.
            </motion.span>
          </h1>

          <motion.p
            variants={fadeUp}
            className="mt-10 max-w-md text-base leading-relaxed text-[#4A4239] md:text-lg"
          >
            Un menu semanal hecho a tu medida, con su lista de la compra. Dos minutos a la semana, una vida sin la pregunta de las 14:00.
          </motion.p>

          <motion.div variants={fadeUp} className="mt-10 flex flex-wrap items-center gap-4">
            <MagneticButton href="/register">
              Crear mi primer menu
              <ArrowUpRight size={16} />
            </MagneticButton>
            <Link
              href="/como-funciona"
              className="link-reveal text-sm font-medium text-[#1A1612]"
            >
              Como funciona
            </Link>
          </motion.div>

          <motion.p variants={fadeUp} className="mt-10 text-xs text-[#7A7066]">
            Sin tarjeta de credito · Gratis para empezar · 2 min de onboarding
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
                alt="Food composition"
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
                <div className="text-[9px] uppercase tracking-[0.2em] text-[#7A7066]">Hoy comes</div>
                <div className="font-display text-base text-[#1A1612]">Pollo al limon con verduras</div>
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
            Lunes · Comida
          </motion.div>
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 1.2, duration: 0.6 }}
            className="absolute -right-4 bottom-32 hidden rotate-[5deg] rounded-full bg-[#2D6A4F] px-4 py-2 text-[10px] uppercase tracking-[0.18em] text-white md:block"
          >
            ✓ Antiinflamatorio
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
        <div className="text-[9px] uppercase tracking-[0.3em] text-[#7A7066]">Scroll</div>
      </motion.div>
    </section>
  )
}

/* ═══════════════════════════════════════════
   Marquee strip
   ═══════════════════════════════════════════ */
function Marquee() {
  const items = [
    "Sin diarios alimentarios",
    "Recetas de temporada",
    "Lista de la compra al instante",
    "Hecho a tu medida",
    "Antiinflamatorio",
    "Microbioma feliz",
    "Sin culpa",
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
    { num: "01", text: "Son las 14:00 y no sabes que comer.", emoji: "🥣" },
    { num: "02", text: "Vas al super sin lista y compras de mas.", emoji: "🛒" },
    { num: "03", text: "Tiras comida cada semana.", emoji: "🗑️" },
    { num: "04", text: "Repites los mismos cinco platos.", emoji: "🔁" },
  ]

  return (
    <section ref={ref} className="relative px-6 py-24 md:px-10 md:py-32">
      <div className="mx-auto max-w-7xl">
        <div className="grid grid-cols-1 gap-12 md:grid-cols-12 md:gap-8">
          <div className="md:col-span-5">
            <div className="text-eyebrow mb-6">Capitulo 01</div>
            <h2 className="text-editorial-lg">
              No es <span className="font-italic italic">falta</span> de informacion.
              <br />
              Es <span className="text-[#C65D38]">falta</span> de un sistema.
            </h2>
            <p className="mt-8 max-w-md text-base leading-relaxed text-[#4A4239]">
              La gente que quiere comer mejor no fracasa por desconocimiento. Fracasa porque cada semana repite las mismas micro-decisiones.
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
            ONA <span className="font-italic italic text-[#2D6A4F]">corta</span> ese ciclo.
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
      eyebrow: "Cinco preguntas",
      title: "Cuentale tus gustos.",
      desc: "Para cuantos cocinas, cuanto tiempo tienes, que no comes, tres platos que te encanten, que te importa mas. Eso es todo.",
      img: STEP1_IMG,
    },
    {
      num: "02",
      eyebrow: "Dos minutos",
      title: "Recibe tu menu.",
      desc: "ONA disena tu semana respetando temporada, variedad y tu nutricion. Cambias lo que no te convenza con un mensaje.",
      img: STEP2_IMG,
    },
    {
      num: "03",
      eyebrow: "Sin friccion",
      title: "Compra y cocina.",
      desc: "Tu lista de la compra sale automatica del menu. La compartes con quien va al super o la usas tu en el carrito.",
      img: STEP3_IMG,
    },
  ]

  return (
    <section className="bg-[#F2EDE0] px-6 py-24 md:px-10 md:py-32">
      <div className="mx-auto max-w-7xl">
        <div className="mb-20 grid grid-cols-1 items-end gap-6 md:grid-cols-12">
          <div className="md:col-span-6">
            <div className="text-eyebrow mb-4">Capitulo 02</div>
            <h2 className="text-editorial-lg">
              <span className="font-italic italic">Tres</span> pasos.
              <br />
              Sin complicaciones.
            </h2>
          </div>
          <div className="md:col-span-5 md:col-start-8">
            <p className="text-base leading-relaxed text-[#4A4239]">
              ONA es radical en su sencillez. Lo opuesto de las apps que te exigen registrar cada caloria, cada paso, cada vaso de agua.
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
   04 — Differential
   ═══════════════════════════════════════════ */
function Differential() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.2 })

  const rows = [
    { tracking: "Registras lo que ya comiste", ona: "Planificas lo que vas a comer" },
    { tracking: "Cuentan calorias a posteriori", ona: "Organiza tu semana a priori" },
    { tracking: "Esfuerzo diario de 21 entradas", ona: "Una sesion semanal de 2 minutos" },
    { tracking: "Sin criterio nutricional", ona: "Filosofia antiinflamatoria" },
    { tracking: "No generan la lista de la compra", ona: "La lista sale automatica del menu" },
  ]

  return (
    <section ref={ref} className="px-6 py-24 md:px-10 md:py-32">
      <div className="mx-auto max-w-7xl">
        <div className="mb-16 grid grid-cols-1 items-end gap-6 md:grid-cols-12">
          <div className="md:col-span-7">
            <div className="text-eyebrow mb-4">Capitulo 03</div>
            <h2 className="text-editorial-lg">
              ONA no es una <span className="font-italic italic">app de tracking</span>.
            </h2>
          </div>
          <div className="md:col-span-4 md:col-start-9">
            <p className="text-base leading-relaxed text-[#4A4239]">
              Las apps de calorias miden lo que pasa cuando ya es tarde. ONA opera <em className="font-italic">a priori</em>.
            </p>
          </div>
        </div>

        <div className="overflow-hidden rounded-[24px] border border-[#DDD6C5]">
          <div className="grid grid-cols-2 border-b border-[#DDD6C5] bg-[#F2EDE0]">
            <div className="p-6 md:p-8">
              <div className="text-eyebrow text-[#7A7066]">Las apps de tracking</div>
              <div className="mt-1 font-display text-2xl text-[#7A7066] line-through decoration-1">MyFitnessPal · Yazio</div>
            </div>
            <div className="border-l border-[#DDD6C5] p-6 md:p-8">
              <div className="text-eyebrow text-[#2D6A4F]">ONA</div>
              <div className="mt-1 font-display text-2xl text-[#1A1612]">Tu asistente</div>
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
          No te pedimos que registres lo que <span className="font-italic italic">ya</span> comiste.
          <br />
          Te <span className="font-italic italic text-[#52B788]">organizamos</span> lo que vas a comer.
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

  useEffect(() => {
    if (inView) {
      const controls = animate(0, 2847, {
        duration: 2.4,
        ease: [0.19, 1, 0.22, 1],
        onUpdate: (v) => setCount(Math.floor(v)),
      })
      return () => controls.stop()
    }
  }, [inView])

  return (
    <section ref={ref} className="bg-[#FAF6EE] px-6 py-24 md:px-10 md:py-32">
      <div className="mx-auto max-w-7xl text-center">
        <div className="text-eyebrow mb-8">En este momento</div>
        <div className="font-display text-[20vw] leading-[0.9] tracking-[-0.04em] text-[#1A1612] md:text-[14rem]">
          {count.toLocaleString("es-ES")}
        </div>
        <p className="mt-6 text-base text-[#4A4239] md:text-lg">
          personas tienen su menu de esta semana hecho con ONA.
        </p>
      </div>
    </section>
  )
}

/* ═══════════════════════════════════════════
   07 — Final CTA + Footer
   ═══════════════════════════════════════════ */
function FinalCTA() {
  return (
    <section className="bg-[#F2EDE0] px-6 py-32 md:px-10 md:py-48">
      <div className="mx-auto max-w-5xl text-center">
        <h2 className="text-editorial-xl">
          Tu menu de <span className="font-italic italic text-[#C65D38]">esta</span> semana
          <br />
          esta a 2 minutos.
        </h2>
        <div className="mt-12 flex flex-col items-center gap-4">
          <MagneticButton href="/register" size="lg">
            Empezar gratis
            <ArrowUpRight size={20} />
          </MagneticButton>
          <p className="text-xs text-[#7A7066]">
            Sin tarjeta · Sin compromiso · Cancela cuando quieras
          </p>
        </div>

        <div className="mt-32 flex flex-col items-center gap-6 border-t border-[#DDD6C5] pt-12 text-sm text-[#7A7066] md:flex-row md:justify-between">
          <div className="font-display text-2xl text-[#1A1612]">ONA</div>
          <nav className="flex gap-8">
            <Link href="/como-funciona" className="link-reveal hover:text-[#1A1612]">Como funciona</Link>
            <Link href="/recipes" className="link-reveal hover:text-[#1A1612]">Recetas</Link>
            <Link href="/privacidad" className="link-reveal hover:text-[#1A1612]">Privacidad</Link>
            <Link href="/terminos" className="link-reveal hover:text-[#1A1612]">Terminos</Link>
          </nav>
          <div className="text-xs">© 2026 ONA</div>
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

  return (
    <Link
      ref={ref}
      href={href}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
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
