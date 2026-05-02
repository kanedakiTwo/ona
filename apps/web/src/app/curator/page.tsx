"use client"

/**
 * Curator Dashboard.
 *
 * A single page that surfaces every catalog gap a curator can fix:
 *   1. Ingredients without USDA mapping (fdcId IS NULL)
 *   2. Ingredients in the "otros" aisle bucket
 *   3. Ingredients missing density (oils, sauces, milks…)
 *   4. Ingredients missing unitWeight (produce items that ship per-unit)
 *   5. Allergen tag suggestions (heuristic > current)
 *   6. Recipes with incomplete nutrition (kcal == 0 / null) + which ingredients block them
 *   7. Recent regen output (failed/skipped JSONL from `apps/api/scripts/output/`)
 *
 * Each row offers an inline edit (PATCH) or a "Re-mapear a USDA" modal that
 * reuses Task B's auto-create plumbing.
 *
 * Spec: ../../../../specs/curator-dashboard.md
 */

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth"
import {
  useIngredientGaps,
  useRecipeGaps,
  useRegenOutput,
} from "@/hooks/useCurator"
import { Tile } from "./sections/shared"
import {
  FdcSection,
  AisleSection,
  DensitySection,
  UnitWeightSection,
  AllergenSection,
} from "./sections/IngredientSections"
import { RecipesSection, RegenSection } from "./sections/RecipeSections"
import { RemapModal } from "./sections/RemapModal"

type SectionKey =
  | "fdc"
  | "aisle"
  | "density"
  | "unit"
  | "allergens"
  | "recipes"
  | "regen"

const SECTIONS: Array<{ key: SectionKey; label: string }> = [
  { key: "fdc", label: "Ingredientes sin USDA" },
  { key: "aisle", label: "Pasillo «otros»" },
  { key: "density", label: "Sin densidad" },
  { key: "unit", label: "Sin peso por unidad" },
  { key: "allergens", label: "Alérgenos sugeridos" },
  { key: "recipes", label: "Recetas con kcal=0" },
  { key: "regen", label: "Output de regen" },
]

export default function CuratorPage() {
  const { user, isLoading: authLoading } = useAuth()
  const router = useRouter()
  const [active, setActive] = useState<SectionKey>("fdc")
  const [remapTarget, setRemapTarget] = useState<{ id: string; name: string } | null>(null)

  const ingredientGaps = useIngredientGaps()
  const recipeGaps = useRecipeGaps()
  const regen = useRegenOutput()

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login")
  }, [authLoading, user, router])

  if (authLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#FAF6EE]">
        <div className="text-eyebrow">Cargando...</div>
      </div>
    )
  }

  const counts: Record<SectionKey, number> = {
    fdc: ingredientGaps.data?.missingFdcId.length ?? 0,
    aisle: ingredientGaps.data?.aisleOtros.length ?? 0,
    density: ingredientGaps.data?.missingDensity.length ?? 0,
    unit: ingredientGaps.data?.missingUnitWeight.length ?? 0,
    allergens: ingredientGaps.data?.allergenSuggestions.length ?? 0,
    recipes: recipeGaps.data?.missingNutrition.length ?? 0,
    regen: regen.data?.length ?? 0,
  }

  const isLoading = ingredientGaps.isLoading || recipeGaps.isLoading || regen.isLoading

  return (
    <div className="bg-[#FAF6EE] min-h-screen pb-24">
      <header className="px-5 pt-8 pb-6">
        <div className="text-eyebrow mb-2">Panel</div>
        <h1 className="font-display text-[2.4rem] leading-[0.95] text-[#1A1612]">
          <span className="font-italic italic text-[#C65D38]">Cura</span>
          <br />
          el catálogo.
        </h1>
        <p className="mt-3 text-[12px] text-[#7A7066] max-w-md">
          Cada fila es un hueco de datos que un humano tiene que cerrar. Las
          acciones actualizan la base al instante.
        </p>
      </header>

      {/* Counts */}
      <section className="px-5">
        <div className="grid grid-cols-2 gap-2">
          <Tile
            label="ingredientes sin USDA"
            value={counts.fdc}
            tone="terracotta"
            onClick={() => setActive("fdc")}
          />
          <Tile
            label="recetas con kcal=0"
            value={counts.recipes}
            tone="ink"
            onClick={() => setActive("recipes")}
          />
          <Tile
            label="alérgenos sugeridos"
            value={counts.allergens}
            tone="cream"
            onClick={() => setActive("allergens")}
          />
          <Tile
            label="archivos en regen"
            value={counts.regen}
            tone="cream"
            onClick={() => setActive("regen")}
          />
        </div>
      </section>

      {/* Tabs */}
      <nav className="px-5 mt-8">
        <div className="flex gap-1.5 overflow-x-auto pb-2 -mx-5 px-5 scrollbar-none">
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              onClick={() => setActive(s.key)}
              className={`shrink-0 rounded-full border px-3.5 py-1.5 text-[12px] font-medium transition-all active:scale-95 ${
                active === s.key
                  ? "border-[#1A1612] bg-[#1A1612] text-[#FAF6EE]"
                  : "border-[#DDD6C5] bg-[#FFFEFA] text-[#4A4239] hover:border-[#1A1612]"
              }`}
            >
              {s.label}
              <span className="ml-1.5 text-[10px] opacity-60">
                {counts[s.key]}
              </span>
            </button>
          ))}
        </div>
      </nav>

      <main className="px-5 mt-6">
        {isLoading && (
          <p className="text-[12px] italic text-[#7A7066]">Cargando huecos…</p>
        )}

        {!isLoading && active === "fdc" && (
          <FdcSection
            rows={ingredientGaps.data?.missingFdcId ?? []}
            onRemap={(row) => setRemapTarget({ id: row.id, name: row.name })}
          />
        )}
        {!isLoading && active === "aisle" && (
          <AisleSection rows={ingredientGaps.data?.aisleOtros ?? []} />
        )}
        {!isLoading && active === "density" && (
          <DensitySection rows={ingredientGaps.data?.missingDensity ?? []} />
        )}
        {!isLoading && active === "unit" && (
          <UnitWeightSection rows={ingredientGaps.data?.missingUnitWeight ?? []} />
        )}
        {!isLoading && active === "allergens" && (
          <AllergenSection rows={ingredientGaps.data?.allergenSuggestions ?? []} />
        )}
        {!isLoading && active === "recipes" && (
          <RecipesSection rows={recipeGaps.data?.missingNutrition ?? []} />
        )}
        {!isLoading && active === "regen" && (
          <RegenSection rows={regen.data ?? []} />
        )}
      </main>

      {remapTarget && (
        <RemapModal
          id={remapTarget.id}
          name={remapTarget.name}
          onClose={() => setRemapTarget(null)}
        />
      )}
    </div>
  )
}
