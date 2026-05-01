"use client"

import { allergenLabel } from "@/lib/recipeView"

interface Props {
  allergens: string[]
  chapter: string
}

export function AllergensBadges({ allergens, chapter }: Props) {
  return (
    <section className="mt-12">
      <div className="mb-4">
        <div className="text-eyebrow text-[#7A7066]">Capítulo {chapter}</div>
        <h2 className="font-display text-[1.6rem] leading-tight text-[#1A1612]">
          <span className="font-italic italic">Alérgenos</span>
        </h2>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {allergens.map((a) => (
          <span
            key={a}
            className="rounded-full bg-[#FDEEE8] px-2.5 py-1 text-[11px] font-medium text-[#B5451B]"
          >
            {allergenLabel(a)}
          </span>
        ))}
      </div>
    </section>
  )
}
