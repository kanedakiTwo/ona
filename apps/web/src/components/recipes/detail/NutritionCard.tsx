"use client"

import type { NutritionPerServing } from "@ona/shared"

interface Props {
  nutrition: NutritionPerServing
  chapter: string
}

function fmt(v: number): string {
  return v.toFixed(1)
}

export function NutritionCard({ nutrition, chapter }: Props) {
  const { kcal, proteinG, carbsG, fatG, fiberG, saltG } = nutrition

  return (
    <section className="mt-12">
      <div className="mb-5">
        <div className="text-eyebrow text-[#7A7066]">Capítulo {chapter}</div>
        <h2 className="font-display text-[1.6rem] leading-tight text-[#1A1612]">
          <span className="font-italic italic">Nutrición</span> por ración
        </h2>
      </div>

      <div className="rounded-2xl border border-[#DDD6C5] bg-[#FAF6EE] p-5">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-[3rem] leading-none text-[#C65D38]">
            {Math.round(kcal)}
          </span>
          <span className="text-[12px] uppercase tracking-[0.15em] text-[#7A7066]">
            kcal
          </span>
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-5">
          <div>
            <dt className="text-[10px] uppercase tracking-[0.15em] text-[#7A7066]">
              Proteínas
            </dt>
            <dd className="font-mono text-[13px] text-[#1A1612]">{fmt(proteinG)} g</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-[0.15em] text-[#7A7066]">
              Carbohidratos
            </dt>
            <dd className="font-mono text-[13px] text-[#1A1612]">{fmt(carbsG)} g</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-[0.15em] text-[#7A7066]">
              Grasa
            </dt>
            <dd className="font-mono text-[13px] text-[#1A1612]">{fmt(fatG)} g</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-[0.15em] text-[#7A7066]">
              Fibra
            </dt>
            <dd className="font-mono text-[13px] text-[#1A1612]">{fmt(fiberG)} g</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-[0.15em] text-[#7A7066]">
              Sal
            </dt>
            <dd className="font-mono text-[13px] text-[#1A1612]">{fmt(saltG)} g</dd>
          </div>
        </dl>
      </div>
    </section>
  )
}
