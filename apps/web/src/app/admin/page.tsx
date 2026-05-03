"use client"

/**
 * Admin Dashboard (formerly Curator).
 *
 * A single page that surfaces every catalog gap an admin can fix plus
 * user management + audit log sub-tabs:
 *   1. Ingredients without USDA mapping (fdcId IS NULL)
 *   2. Ingredients in the "otros" aisle bucket
 *   3. Ingredients missing density (oils, sauces, milks…)
 *   4. Ingredients missing unitWeight (produce items that ship per-unit)
 *   5. Allergen tag suggestions (heuristic > current)
 *   6. Recipes with incomplete nutrition (kcal == 0 / null)
 *   7. Recent regen output (failed/skipped JSONL)
 *   8. Usuarios — search + suspend + reset-link generator
 *   9. Auditoría — reverse-chronological feed of admin actions
 *
 * Each row offers an inline edit (PATCH) or a "Re-mapear a USDA" modal.
 * Access is gated to `user.role === 'admin'`. The full server check is
 * `requireAdmin` middleware on the API; this client gate is just to
 * avoid wasted requests + render a 403 fallback.
 *
 * Spec: ../../../../specs/curator-dashboard.md, user-management.md,
 *       admin-audit-log.md
 */

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth"
import {
  useIngredientGaps,
  useRecipeGaps,
  useRegenOutput,
} from "@/hooks/useAdmin"
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
import { UsersSection } from "./sections/UsersSection"
import { AuditLogSection } from "./sections/AuditLogSection"

type SectionKey =
  | "fdc"
  | "aisle"
  | "density"
  | "unit"
  | "allergens"
  | "recipes"
  | "regen"
  | "users"
  | "audit"

const SECTIONS: Array<{ key: SectionKey; label: string }> = [
  { key: "fdc", label: "Ingredientes sin USDA" },
  { key: "aisle", label: "Pasillo «otros»" },
  { key: "density", label: "Sin densidad" },
  { key: "unit", label: "Sin peso por unidad" },
  { key: "allergens", label: "Alérgenos sugeridos" },
  { key: "recipes", label: "Recetas con kcal=0" },
  { key: "regen", label: "Output de regen" },
  { key: "users", label: "Usuarios" },
  { key: "audit", label: "Auditoría" },
]

export default function AdminPage() {
  const { user, isLoading: authLoading } = useAuth()
  const router = useRouter()
  const [active, setActive] = useState<SectionKey>("fdc")
  const [remapTarget, setRemapTarget] = useState<{ id: string; name: string } | null>(null)

  const isAdmin = user?.role === "admin"

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

  // 403 fallback for non-admin users.
  if (user && !isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#FAF6EE] px-6">
        <div className="max-w-sm text-center">
          <div className="text-eyebrow mb-3 text-[#7A7066]">403</div>
          <h1 className="font-display text-[2rem] leading-tight text-[#1A1612]">
            <span className="font-italic italic text-[#C65D38]">Acceso</span>{" "}
            restringido.
          </h1>
          <p className="mt-4 text-[13px] text-[#4A4239]">
            Esta sección está reservada al equipo de ONA.
          </p>
          <Link
            href="/menu"
            className="mt-6 inline-block rounded-full bg-[#1A1612] px-5 py-2.5 text-[12px] font-medium uppercase tracking-[0.12em] text-[#FAF6EE] hover:bg-[#C65D38]"
          >
            Volver al menú
          </Link>
        </div>
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
    users: 0,
    audit: 0,
  }

  const isCatalogTab =
    active === "fdc" ||
    active === "aisle" ||
    active === "density" ||
    active === "unit" ||
    active === "allergens" ||
    active === "recipes" ||
    active === "regen"
  const isLoading =
    isCatalogTab &&
    (ingredientGaps.isLoading || recipeGaps.isLoading || regen.isLoading)

  return (
    <div className="bg-[#FAF6EE] min-h-screen pb-24">
      <header className="px-5 pt-8 pb-6">
        <div className="text-eyebrow mb-2">Panel</div>
        <h1 className="font-display text-[2.4rem] leading-[0.95] text-[#1A1612]">
          <span className="font-italic italic text-[#C65D38]">Admin</span>
          <br />
          de ONA.
        </h1>
        <p className="mt-3 text-[12px] text-[#7A7066] max-w-md">
          Cura el catálogo, gestiona cuentas y revisa la auditoría. Cada acción
          queda registrada.
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
              {s.key !== "users" && s.key !== "audit" && (
                <span className="ml-1.5 text-[10px] opacity-60">
                  {counts[s.key]}
                </span>
              )}
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
        {active === "users" && <UsersSection />}
        {active === "audit" && <AuditLogSection />}
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
