"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import { motion, useScroll, useTransform, useInView } from "motion/react"
import { ArrowUpRight, Plus, Minus } from "lucide-react"

const STEP1_IMG = "https://images.unsplash.com/photo-1556909114-44e3e9399a2c?w=900&q=80&auto=format&fit=crop"
const STEP2_IMG = "https://images.unsplash.com/photo-1556909212-d5b604d0c90d?w=900&q=80&auto=format&fit=crop"
const STEP3_IMG = "https://images.unsplash.com/photo-1543339531-d6c87f0a6f4f?w=900&q=80&auto=format&fit=crop"

const FAQS = [
  {
    q: "Puedo anadir mis propias recetas?",
    a: "Si. Tienes un chat con el asistente de ONA donde puedes contarle la receta de tu abuela o esa que descargaste. La extrae paso a paso y la guarda en tu coleccion.",
  },
  {
    q: "Es gratis?",
    a: "El plan gratuito incluye un menu por semana, lista de la compra automatica y el catalogo de recetas. El plan premium llega cuando lo necesites.",
  },
  {
    q: "Puedo cambiar platos del menu generado?",
    a: "Claro. Con un mensaje al asistente. \"El martes no me apetece pasta, ponme algo de menos de 20 minutos\" — y se cambia. Tambien puedes fijar platos para que no se muevan en regeneraciones.",
  },
  {
    q: "Funciona para dietas especiales?",
    a: "ONA respeta tus restricciones desde el onboarding. Sin gluten, vegetariano, sin lacteos, lo que tengas. Y puedes anadir las tuyas en cualquier momento.",
  },
]

export default function ComoFuncionaPage() {
  return (
    <div className="bg-[#FAF6EE] grain-subtle">
      <Hero />
      <Steps />
      <Faq />
      <CTA />
    </div>
  )
}

function Hero() {
  return (
    <section className="relative px-6 pb-24 pt-32 md:px-10 md:pb-32 md:pt-44">
      <div className="mx-auto max-w-7xl">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, ease: [0.19, 1, 0.22, 1] }}
        >
          <div className="text-eyebrow mb-6">Manual de uso</div>
          <h1 className="text-editorial-xl max-w-4xl">
            Asi <span className="font-italic italic">funciona</span> ONA.
          </h1>
          <p className="mt-10 max-w-xl text-base leading-relaxed text-[#4A4239] md:text-lg">
            Tres pasos honestos. Lo que veras a continuacion es lo unico que pasa entre que abres ONA y tienes tu menu listo. Sin sorpresas, sin pasos ocultos.
          </p>
        </motion.div>
      </div>
    </section>
  )
}

function Steps() {
  const steps = [
    {
      num: "01",
      eyebrow: "Cinco preguntas",
      title: "Cuentale tus gustos.",
      desc: "Cinco preguntas conversacionales: para cuantos cocinas, cuanto cocinas a la semana, si tienes alguna restriccion, tres platos que te encanten, y que te importa mas (rapidez, variedad, salud, ahorro).",
      detail: "No formularios largos, no datos opcionales por todas partes. Cinco preguntas que el asistente te hace en orden. Cada una en una pantalla. Antes de minuto y medio terminas y ves tu primer menu.",
      img: STEP1_IMG,
    },
    {
      num: "02",
      eyebrow: "Dos minutos",
      title: "Recibe tu menu.",
      desc: "ONA disena tu semana. Lunes a domingo, las comidas que tu hayas configurado. Todo respeta temporada, evita repeticiones y se ajusta a tu balance nutricional. Si algo no te convence, lo cambias hablando.",
      detail: "El motor evalua hasta 200 combinaciones para encontrar la que mejor encaja con tu perfil. Calcula calorias, macronutrientes y variedad. Luego puedes fijar platos para que no se muevan en proximas regeneraciones.",
      img: STEP2_IMG,
    },
    {
      num: "03",
      eyebrow: "Sin friccion",
      title: "Compra y cocina.",
      desc: "Tu lista de la compra sale automatica del menu. Ingredientes consolidados (si dos recetas llevan tomate, una sola entrada), agrupados por seccion del super, ajustados a tus comensales.",
      detail: "Comparte la lista con tu pareja o quien va al super. Marca lo que ya tienes en casa y desaparece. Marca lo comprado y se queda atravesado. Cuando cocinas, marca el plato como hecho y ONA aprende para futuras semanas.",
      img: STEP3_IMG,
    },
  ]

  return (
    <section className="bg-[#F2EDE0] px-6 py-24 md:px-10 md:py-32">
      <div className="mx-auto max-w-7xl space-y-32">
        {steps.map((step, i) => (
          <StepRow key={step.num} step={step} reverse={i % 2 === 1} />
        ))}
      </div>
    </section>
  )
}

function StepRow({
  step,
  reverse,
}: {
  step: { num: string; eyebrow: string; title: string; desc: string; detail: string; img: string }
  reverse: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, amount: 0.25 })
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  })
  const imgY = useTransform(scrollYProgress, [0, 1], [40, -40])

  return (
    <div
      ref={ref}
      className={`grid grid-cols-1 items-center gap-12 md:grid-cols-12 md:gap-16 ${
        reverse ? "md:[direction:rtl]" : ""
      }`}
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
        <div className="font-display text-[9rem] leading-none text-[#C65D38]/15 md:text-[11rem]">
          {step.num}
        </div>
        <div className="-mt-12 md:-mt-16">
          <div className="text-eyebrow mb-3 text-[#C65D38]">{step.eyebrow}</div>
          <h3 className="text-editorial-md">{step.title}</h3>
          <p className="mt-6 max-w-md text-base leading-relaxed text-[#4A4239]">{step.desc}</p>
          <hr className="divider-dotted my-8 max-w-md" />
          <p className="max-w-md text-sm leading-relaxed text-[#7A7066]">{step.detail}</p>
        </div>
      </motion.div>
    </div>
  )
}

function Faq() {
  const [open, setOpen] = useState<number | null>(0)

  return (
    <section className="bg-[#FAF6EE] px-6 py-24 md:px-10 md:py-32">
      <div className="mx-auto max-w-4xl">
        <div className="text-eyebrow mb-4">Preguntas frecuentes</div>
        <h2 className="text-editorial-lg mb-16">
          Lo que <span className="font-italic italic">la gente</span> pregunta.
        </h2>

        <div className="border-t border-[#DDD6C5]">
          {FAQS.map((faq, i) => {
            const isOpen = open === i
            return (
              <div key={i} className="border-b border-[#DDD6C5]">
                <button
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="group flex w-full items-center justify-between gap-6 py-6 text-left transition-colors hover:text-[#2D6A4F] md:py-8"
                >
                  <span className="font-display text-xl text-[#1A1612] md:text-2xl">{faq.q}</span>
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[#DDD6C5] transition-all ${
                      isOpen ? "rotate-180 border-[#2D6A4F] bg-[#2D6A4F] text-[#FAF6EE]" : "text-[#1A1612]"
                    }`}
                  >
                    {isOpen ? <Minus size={16} /> : <Plus size={16} />}
                  </div>
                </button>
                <motion.div
                  initial={false}
                  animate={{
                    height: isOpen ? "auto" : 0,
                    opacity: isOpen ? 1 : 0,
                  }}
                  transition={{ duration: 0.4, ease: [0.19, 1, 0.22, 1] }}
                  className="overflow-hidden"
                >
                  <p className="pb-8 text-base leading-relaxed text-[#4A4239]">{faq.a}</p>
                </motion.div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function CTA() {
  return (
    <section className="bg-[#F2EDE0] px-6 py-24 md:px-10 md:py-40">
      <div className="mx-auto max-w-4xl text-center">
        <h2 className="text-editorial-xl">
          <span className="font-italic italic text-[#C65D38]">Listo</span> para empezar.
        </h2>
        <p className="mt-8 max-w-xl mx-auto text-base text-[#4A4239] md:text-lg">
          Dos minutos. Sin tarjeta. Sin compromiso. Acabas con el menu en pantalla.
        </p>
        <Link
          href="/register"
          className="mt-10 inline-flex items-center gap-2.5 rounded-full bg-[#1A1612] px-7 py-4 text-base font-medium text-[#FAF6EE] transition-all hover:gap-3.5 hover:bg-[#2D6A4F]"
        >
          Empezar gratis
          <ArrowUpRight size={18} />
        </Link>
      </div>
    </section>
  )
}
