"use client"

/**
 * /recipes/mias — «Mis recetas» (specs/my-recipes.md): the recipes this
 * person created, with their pending pills, «Editar» and «Eliminar». It was
 * a card on /profile until PRO-1202 moved it to the Recetas tab.
 */
import Link from "next/link"
import { Plus } from "lucide-react"
import { MyRecipesSection } from "@/components/recipes/MyRecipesSection"
import { Accent, PILL_INK, SubPage } from "@/components/profile/SubPage"

export default function MyRecipesPage() {
  return (
    <SubPage
      eyebrow="Mis recetas"
      back={{ href: "/recipes", label: "Recetas" }}
      title={
        <>
          Las que has <Accent>creado tú</Accent>.
        </>
      }
      intro="Edítalas o elimínalas si ya no las usas."
      action={
        <Link href="/recipes/new" aria-label="Nueva receta" className={PILL_INK}>
          <Plus size={18} strokeWidth={2.2} aria-hidden="true" />
          <span className="hidden sm:inline">Nueva receta</span>
        </Link>
      }
    >
      <div className="lg:max-w-[720px]">
        <MyRecipesSection />
      </div>
    </SubPage>
  )
}
