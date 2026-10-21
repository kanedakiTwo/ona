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
 *  10. Deseos del catálogo — dishes households want that we lack (PRO-154)
 *  11. Lista de espera — suggested batch with names, «Invitar a estas N
 *      personas» (one-time link by email), per-batch results (PRO-97)
 *  12. Recetas pendientes — catalogue drafts by batch, «Publicar» /
 *      «Descartar» each one, and the import of a Cocina batch file
 *      (specs/catalog-import.md)
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
import { useParams, useRouter } from "next/navigation"
import { adminAreaFromSlug, type AdminArea } from "@/lib/adminNav"
import { useAuth } from "@/lib/auth"
import {
  useIngredientGaps,
  useRecipeGaps,
  useRegenOutput,
} from "@/hooks/useAdmin"
import { Tile } from "../sections/shared"
import {
  FdcSection,
  AisleSection,
  DensitySection,
  UnitWeightSection,
  AllergenSection,
} from "../sections/IngredientSections"
import { RecipesSection, RegenSection } from "../sections/RecipeSections"
import { RemapModal } from "../sections/RemapModal"
import { UsersSection } from "../sections/UsersSection"
import { AuditLogSection } from "../sections/AuditLogSection"
import { VoiceTranscriptsSection } from "../sections/VoiceTranscriptsSection"
import { InvitationsSection } from "../sections/InvitationsSection"
import { FeedbackSection } from "../sections/FeedbackSection"
import { CatalogWishesSection } from "../sections/CatalogWishesSection"
import { WaitlistAdminSection } from "../sections/WaitlistAdminSection"
import { PendingRecipesSection } from "../sections/PendingRecipesSection"
import { DISPLAY_UI } from "@/components/recipes/RecipeCard"

type SectionKey =
  | "fdc"
  | "aisle"
  | "density"
  | "unit"
  | "allergens"
  | "recipes"
  | "regen"
  | "wishes"
  | "users"
  | "audit"
  | "voice"
  | "invites"
  | "waitlist"
  | "feedback"
  | "drafts"

const SECTIONS: Array<{ key: SectionKey; label: string }> = [
  { key: "fdc", label: "Ingredientes sin USDA" },
  { key: "aisle", label: "Pasillo «otros»" },
  { key: "density", label: "Sin densidad" },
  { key: "unit", label: "Sin peso por unidad" },
  { key: "allergens", label: "Alérgenos sugeridos" },
  { key: "recipes", label: "Recetas con kcal=0" },
  { key: "regen", label: "Output de regen" },
  { key: "wishes", label: "Deseos del catálogo" },
  { key: "drafts", label: "Recetas pendientes" },
  { key: "users", label: "Usuarios" },
  { key: "audit", label: "Auditoría" },
  { key: "voice", label: "Voz" },
  { key: "invites", label: "Invitaciones" },
  { key: "waitlist", label: "Lista de espera" },
  { key: "feedback", label: "Opiniones" },
]

const AREA_SECTION: Record<Exclude<AdminArea, "catalogo">, SectionKey> = {
  recetas: "drafts",
  usuarios: "users",
  invitaciones: "invites",
  "lista-espera": "waitlist",
  opiniones: "feedback",
  auditoria: "audit",
  voz: "voice",
}
/** Each admin area has its own heading; the catalogue's counts only show there. */
const AREA_HEADER: Record<AdminArea, { title: string; intro: string }> = {
  catalogo: { title: "Catálogo", intro: "Huecos del catálogo: ingredientes sin datos, alérgenos y recetas por revisar." },
  recetas: { title: "Recetas pendientes", intro: "Los borradores del catálogo, por tanda: ábrelos y publica o descarta cada uno. Nada sale sin tu clic." },
  usuarios: { title: "Usuarios", intro: "Busca cuentas, suspéndelas o genera un enlace para cambiar la contraseña." },
  invitaciones: { title: "Invitaciones", intro: "Enlaces de invitación por campaña para entrar en la beta cerrada, con sus altas y su uso." },
  "lista-espera": { title: "Lista de espera", intro: "Quién se ha apuntado, de qué canal viene y la siguiente tanda para invitar por correo." },
  opiniones: { title: "Opiniones", intro: "Lo que nos cuentan los hogares de la beta, desde el botón «Opinión», el chat o WhatsApp." },
  auditoria: { title: "Auditoría", intro: "Lo que ha hecho cada admin y cuándo. Cada acción queda registrada." },
  voz: { title: "Voz", intro: "Histórico del antiguo modo de voz (retirado el 2026-10-09). Ya no entran conversaciones nuevas." },
}

const SECTION_AREA_HREF: Partial<Record<SectionKey, string>> = {
  drafts: "/admin/recetas",
  users: "/admin/usuarios",
  invites: "/admin/invitaciones",
  waitlist: "/admin/lista-espera",
  feedback: "/admin/opiniones",
  audit: "/admin/auditoria",
  voice: "/admin/voz",
}

export default function AdminPage() {
  const { user, isLoading: authLoading } = useAuth()
  const router = useRouter()
  // Each area has its own URL (/admin/invitaciones…) so the desktop sidebar
  // can link to it; the catalogue's seven gap lists stay as in-page tabs.
  const params = useParams<{ seccion?: string[] }>()
  const area = adminAreaFromSlug(params?.seccion?.[0])
  const [catalogTab, setCatalogTab] = useState<SectionKey>("fdc")
  const active: SectionKey = area === "catalogo" ? catalogTab : AREA_SECTION[area]
  function goCatalog(k: SectionKey) {
    setCatalogTab(k)
    if (area !== "catalogo") router.push("/admin")
  }
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
      <div className="flex min-h-screen items-center justify-center bg-cream">
        <div className="text-eyebrow">Cargando...</div>
      </div>
    )
  }

  // 403 fallback for non-admin users.
  if (user && !isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream px-6">
        <div className="max-w-sm text-center">
          <div className="text-eyebrow mb-3 text-ink-muted">403</div>
          <h1 className={`${DISPLAY_UI} text-[2rem] leading-tight text-ink`}>
            <span className="font-italic italic text-terracotta-deep">Acceso</span>{" "}
            restringido.
          </h1>
          <p className="mt-4 text-[13px] text-ink-mid">
            Esta sección está reservada al equipo de Mimoia.
          </p>
          <Link
            href="/menu"
            className="mt-6 inline-block rounded-full bg-ink px-5 py-2.5 text-[12px] font-medium uppercase tracking-[0.12em] text-cream hover:bg-terracotta-deep"
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
    wishes: 0,
    users: 0,
    audit: 0,
    voice: 0,
    invites: 0,
    waitlist: 0,
    feedback: 0,
    drafts: 0,
  }

  const isCatalogTab =
    active === "fdc" ||
    active === "aisle" ||
    active === "density" ||
    active === "unit" ||
    active === "allergens" ||
    active === "recipes" ||
    active === "regen" ||
    active === "wishes"
  const isLoading =
    isCatalogTab &&
    (ingredientGaps.isLoading || recipeGaps.isLoading || regen.isLoading)

  return (
    <div className="bg-cream min-h-screen pb-24 lg:mx-auto lg:max-w-[var(--page-max)]">
      <header className="px-5 pt-8 pb-6">
        <div className="text-eyebrow mb-2">Admin</div>
        <h1 className={`${DISPLAY_UI} text-[2.4rem] leading-[0.95] text-ink`}>
          <span className="font-italic italic text-terracotta-deep">{AREA_HEADER[area].title}</span>
        </h1>
        <p className="mt-3 text-[12px] text-ink-muted max-w-md">{AREA_HEADER[area].intro}</p>
      </header>

      {/* Counts — catalogue only */}
      {area === "catalogo" && (
      <section className="px-5">
        <div className="grid grid-cols-2 gap-2">
          <Tile
            label="ingredientes sin USDA"
            value={counts.fdc}
            tone="terracotta"
            onClick={() => goCatalog("fdc")}
          />
          <Tile
            label="recetas con kcal=0"
            value={counts.recipes}
            tone="ink"
            onClick={() => goCatalog("recipes")}
          />
          <Tile
            label="alérgenos sugeridos"
            value={counts.allergens}
            tone="cream"
            onClick={() => goCatalog("allergens")}
          />
          <Tile
            label="archivos en regen"
            value={counts.regen}
            tone="cream"
            onClick={() => goCatalog("regen")}
          />
        </div>
      </section>
      )}

      {/* Tabs */}
      {/* Tabs. On md+ the sidebar lists the admin areas, so only the
          catalogue's tabs stay here (wrapped, never hidden off-screen); on
          mobile every tab scrolls sideways. */}
      <nav className={`px-5 mt-8 ${isCatalogTab ? "" : "md:hidden"}`} aria-label="Secciones del admin">
        <div className="flex gap-1.5 overflow-x-auto pb-2 -mx-5 px-5 scrollbar-none md:flex-wrap md:overflow-visible">
          {SECTIONS.filter((s) => s.key !== "voice").map((s) => (
            <button
              key={s.key}
              onClick={() => {
                const href = SECTION_AREA_HREF[s.key]
                if (href) {
                  router.push(href)
                } else {
                  goCatalog(s.key)
                }
              }}
              className={`inline-flex min-h-[44px] shrink-0 items-center rounded-full border px-4 text-[13px] font-medium transition-all active:scale-95 ${SECTION_AREA_HREF[s.key] ? "md:hidden" : ""} ${
                active === s.key
                  ? "border-ink bg-ink text-cream"
                  : "border-border-soft bg-paper text-ink-mid hover:border-ink"
              }`}
            >
              {s.label}
              {s.key !== "users" && s.key !== "audit" && s.key !== "voice" && s.key !== "waitlist" && s.key !== "wishes" && s.key !== "drafts" && (
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
          <p className="text-[12px] italic text-ink-muted">Cargando huecos…</p>
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
        {active === "voice" && <VoiceTranscriptsSection />}
        {active === "invites" && <InvitationsSection />}
        {active === "waitlist" && <WaitlistAdminSection />}
        {active === "feedback" && <FeedbackSection />}
        {active === "wishes" && <CatalogWishesSection />}
        {active === "drafts" && <PendingRecipesSection />}
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
