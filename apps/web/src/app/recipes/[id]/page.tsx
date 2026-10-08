"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useParams, useRouter } from "next/navigation"
import { motion } from "motion/react"
import {
  useCopyRecipe,
  useRecipe,
  useRegenerateRecipeImage,
} from "@/hooks/useRecipes"
import { useUser } from "@/hooks/useUser"
import { useIsDesktop } from "@/hooks/useMediaQuery"
import { useAuth } from "@/lib/auth"
import { FavoriteButton } from "@/components/recipes/FavoriteButton"
import { CookedBadge } from "@/components/recipes/CookedBadge"
import { RecipeNotesSection } from "@/components/recipes/RecipeNotesSection"
import { AddToCookbookButton } from "@/components/recipes/AddToCookbookButton"
import { RecipePhotoGallery } from "@/components/recipes/RecipePhotoGallery"
import { ServingsScaler } from "@/components/recipes/ServingsScaler"
import { IngredientsSection } from "@/components/recipes/detail/IngredientsSection"
import { useRecipeNotes, useSaveRecipeNotes } from "@/hooks/useRecipeNotes"
import type { IngredientOverride, Recipe } from "@ona/shared"
import { StepsSection } from "@/components/recipes/detail/StepsSection"
import { NutritionCard } from "@/components/recipes/detail/NutritionCard"
import {
  RecipeTabs,
  recipePanelId,
  recipeTabId,
  type RecipeTab,
} from "@/components/recipes/detail/RecipeTabs"
import { RecipeActionBar } from "@/components/recipes/detail/RecipeActionBar"
import { haptic } from "@/lib/pwa/haptics"
import { share } from "@/lib/pwa/share"
import {
  BookmarkPlus,
  ChevronLeft,
  Clock,
  ExternalLink,
  Pencil,
  Play,
  Share2,
  Sparkles,
  Wrench,
  Youtube,
} from "lucide-react"
import Link from "next/link"
import {
  allergenLabel,
  householdToDinersOrNull,
  minutesLabel,
  publicTagsOf,
  recipeEyebrow,
  recipeTotalMinutes,
  timelineString,
} from "@/lib/recipeView"
import { DIFFICULTY_LABELS, SEASON_LABELS } from "@/lib/labels"
import { recipeSharePayload } from "@ona/shared"

/**
 * Recipe detail — "D · Luz y foto" (2026-10-08).
 *
 * Mobile (< lg): 390 px hero photo, cream sheet with eyebrow + title, a
 * tablist (Ingredientes · Pasos · Nutrición · Notas) and a sticky bottom
 * action bar with "Empezar a cocinar" (the bottom tab bar hides on this
 * route). Desktop (lg+): two columns — sticky rounded photo on the left,
 * long-scroll column on the right with every section in order.
 *
 * Both layouts render the same section blocks; only the chrome differs.
 */

type TabKey = "ingredientes" | "pasos" | "nutricion" | "notas"
const TAB_KEYS: TabKey[] = ["ingredientes", "pasos", "nutricion", "notas"]
const TAB_ID_PREFIX = "receta"

export default function RecipeDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const { user } = useAuth()
  const isDesktop = useIsDesktop()

  const [servings, setServings] = useState<number | null>(null)
  // Once we know the recipe's authored servings, the scaler "seeds" itself.
  const seededRef = useRef(false)

  const { data: recipe, isLoading, error } = useRecipe(
    params.id,
    servings ?? undefined,
  )

  // Seed the scaler once the recipe loads. Prefer the user's household
  // size (clamped to the [1, recipe.servings × 6] range the API accepts);
  // fall back to the recipe's authored servings.
  useEffect(() => {
    if (seededRef.current) return
    if (!recipe) return
    const userDiners = householdToDinersOrNull({
      adults: user?.adults,
      kidsCount: user?.kidsCount,
      householdSize: user?.householdSize,
    })
    const initial = userDiners ?? recipe.servings ?? 2
    setServings(initial)
    seededRef.current = true
  }, [recipe, user?.householdSize])

  // Per-household ingredient overrides (struck-through / highlighted in the
  // section). The hook short-circuits when unauthed.
  const { data: notes } = useRecipeNotes(user ? params.id : undefined)
  const saveNotes = useSaveRecipeNotes(params.id)
  // "Siempre la cocino para al menos N": start the scaler there (until the
  // user moves it), since that's what they'll actually cook.
  const scalerTouchedRef = useRef(false)
  useEffect(() => {
    const min = notes?.minServings
    if (!min || scalerTouchedRef.current || servings == null) return
    if (servings < min) setServings(Math.min(min, 12))
  }, [notes?.minServings, servings])
  const overrides: IngredientOverride[] = notes?.ingredientOverrides ?? []

  // ─── Tabs (mobile). The active tab mirrors the URL hash (#pasos, #notas…)
  // so a reload or a shared link reopens the same section. ───
  const [tab, setTab] = useState<TabKey>("ingredientes")
  const tabsAnchorRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const fromHash = window.location.hash.slice(1) as TabKey
    if (TAB_KEYS.includes(fromHash)) setTab(fromHash)
  }, [])
  const selectTab = (key: TabKey) => {
    setTab(key)
    const url = `${window.location.pathname}${window.location.search}${key === "ingredientes" ? "" : `#${key}`}`
    window.history.replaceState(window.history.state, "", url)
    // If the (sticky) tablist is stuck at the top, jump back to where the
    // panels start so the new tab is read from its beginning.
    const anchor = tabsAnchorRef.current
    if (anchor) {
      const top = anchor.getBoundingClientRect().top
      if (top < 0) window.scrollTo({ top: window.scrollY + top })
    }
  }

  // ─── Derived state (must be declared before any early return so hook order is stable) ───
  const tags = useMemo(() => (recipe ? publicTagsOf(recipe) : []), [recipe])
  const timeLine = useMemo(() => {
    if (!recipe) return ""
    return timelineString({
      prepTime: recipe.prepTime,
      cookTime: recipe.cookTime,
      activeTime: recipe.activeTime,
      totalTime: recipe.totalTime,
    })
  }, [recipe])

  if (isLoading || !recipe) {
    if (error) {
      return (
        <div className="min-h-screen bg-[#FAF6EE] px-5 pt-12 text-center">
          <p className="font-display text-2xl text-[#1A1612]">Receta no encontrada.</p>
          <button
            onClick={() => router.back()}
            className="mt-4 text-sm text-[#2D6A4F] underline"
          >
            Volver
          </button>
        </div>
      )
    }
    return (
      <div className="min-h-screen bg-[#FAF6EE] lg:mx-auto lg:grid lg:max-w-[1280px] lg:grid-cols-2 lg:gap-10 lg:px-8 lg:pr-12 lg:pt-7">
        <div className="h-[390px] w-full animate-pulse bg-[#EFE8D8] lg:h-[calc(100dvh-56px)] lg:rounded-[24px]" />
        <div className="space-y-4 px-5 pt-6 lg:px-0 lg:pt-2">
          <div className="h-3 w-1/3 animate-pulse rounded bg-[#EFE8D8]" />
          <div className="h-8 w-3/4 animate-pulse rounded bg-[#EFE8D8] lg:h-12" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-[#EFE8D8]" />
        </div>
      </div>
    )
  }

  const fallbackImg =
    "https://images.unsplash.com/photo-1490645935967-10de6ba17061?w=1200&q=85&auto=format&fit=crop"
  // Append `?v=<updatedAt>` ONLY for images we serve ourselves (the Railway
  // volume under `IMAGE_PUBLIC_URL_BASE`). Adding a query to third-party
  // hosts like `i.ytimg.com` makes them serve a generic placeholder instead
  // of the real frame — that was the "import desde YouTube no muestra foto"
  // bug. Same-URL-new-bytes only matters for our own regenerated heroes
  // anyway; external URLs are immutable so the cache is fine as-is.
  const isOwnImage = recipe.imageUrl?.includes("ona-api") ?? false
  const cacheBust = recipe.imageUrl
    ? isOwnImage
      ? `${recipe.imageUrl}${recipe.imageUrl.includes("?") ? "&" : "?"}v=${new Date(recipe.updatedAt).getTime()}`
      : recipe.imageUrl
    : null
  const img = cacheBust ?? fallbackImg

  // The live scaler value when seeded, falling back to the recipe's own value.
  const displayServings = servings ?? recipe.servings
  const cookHref = `/recipes/${recipe.id}/cook?servings=${displayServings}`
  const onServingsChange = (n: number) => {
    scalerTouchedRef.current = true
    setServings(n)
  }

  const handleShare = async () => {
    haptic.light()
    // "Pásalo": catalogue recipes share their public page (opens without an
    // account, with a sign-up CTA); private ones go as text + a link to Mimoia.
    await share(recipeSharePayload(recipe, typeof window !== "undefined" ? window.location.origin : ""))
  }

  const stepCount = recipe.steps?.length ?? 0
  const hasNutrition = recipe.nutritionPerServing != null
  const tabs: RecipeTab<TabKey>[] = [
    { key: "ingredientes", label: "Ingredientes" },
    { key: "pasos", label: stepCount > 0 ? `Pasos · ${stepCount}` : "Pasos" },
    ...(hasNutrition ? [{ key: "nutricion" as const, label: "Nutrición" }] : []),
    { key: "notas", label: "Notas" },
  ]
  const activeTab: TabKey = tab === "nutricion" && !hasNutrition ? "ingredientes" : tab

  // ─── Section blocks (shared by the mobile panels and the desktop column) ───

  const servingsStepper = (
    <ServingsScaler
      variant="pill"
      value={displayServings}
      onChange={onServingsChange}
      min={1}
      max={12}
    />
  )

  const ingredientsList =
    recipe.ingredients?.length > 0 ? (
      <IngredientsSection
        variant="plain"
        columns={isDesktop ? 2 : 1}
        ingredients={recipe.ingredients as any}
        targetServings={displayServings}
        overrides={overrides}
        onOverridesChange={
          user
            ? (next) => saveNotes.mutate({ ingredientOverrides: next })
            : undefined
        }
        saving={saveNotes.isPending}
      />
    ) : (
      <EmptyLine>Esta receta aún no tiene ingredientes.</EmptyLine>
    )

  const stepsBlock = (
    <>
      {timeLine && (
        <p className="mb-5 flex items-center gap-1.5 text-[13px] text-[#4A4239]">
          <Clock size={14} className="text-[#7A7066]" aria-hidden />
          {timeLine}
        </p>
      )}
      {stepCount > 0 ? (
        <StepsSection
          variant="plain"
          steps={recipe.steps}
          ingredients={recipe.ingredients ?? []}
        />
      ) : (
        <EmptyLine>Esta receta aún no tiene pasos.</EmptyLine>
      )}
    </>
  )

  const extras = (
    <RecipeExtras
      recipe={recipe}
      tags={tags}
      headingAs={isDesktop ? "h2" : "h3"}
    />
  )
  const hasExtras =
    (recipe.equipment?.length ?? 0) > 0 ||
    (recipe.allergens?.length ?? 0) > 0 ||
    (recipe.seasons?.length ?? 0) > 0 ||
    tags.length > 0

  const nutritionBlock = recipe.nutritionPerServing ? (
    <NutritionCard nutrition={recipe.nutritionPerServing} />
  ) : null

  const canEdit = !!user && (recipe.authorId === user.id || user.role === "admin")
  const notesBlock = (
    <div>
      {/* Quick personal actions: log a cook, file it in a cookbook. */}
      {user && (
        <div className="flex flex-wrap items-center gap-2">
          <CookedBadge recipeId={recipe.id} variant="button" className="min-h-11 px-4" />
          <AddToCookbookButton recipeId={recipe.id} className="min-h-11 px-4" />
        </div>
      )}

      {/* The recipe's own notes / tips / substitutions / storage. Notes are
          persisted as a single text blob with paragraph breaks (`\n\n`);
          legacy `tips` content is merged in beneath so nothing the author
          typed disappears. */}
      {(recipe.notes || recipe.tips || recipe.substitutions || recipe.storage) && (
        <section className={`${user ? "mt-8" : ""} space-y-5`} aria-label="Notas de la receta">
          {(recipe.notes || recipe.tips) && (
            <div>
              <div className="text-eyebrow mb-2 text-[#7A7066]">Notas de la receta</div>
              <div className="space-y-2 text-[15px] leading-relaxed text-[#1A1612]">
                {[recipe.notes, recipe.tips]
                  .filter((v): v is string => !!v)
                  .flatMap((blob) => blob.split(/\n{2,}/))
                  .map((p) => p.trim())
                  .filter((p) => p.length > 0)
                  .map((p, i) => (
                    <p key={i}>{p}</p>
                  ))}
              </div>
            </div>
          )}
          {recipe.substitutions && (
            <div>
              <div className="text-eyebrow mb-2 text-[#7A7066]">Sustituciones</div>
              <p className="text-[15px] leading-relaxed text-[#1A1612]">{recipe.substitutions}</p>
            </div>
          )}
          {recipe.storage && (
            <div>
              <div className="text-eyebrow mb-2 text-[#7A7066]">Conservación</div>
              <p className="text-[15px] leading-relaxed text-[#1A1612]">{recipe.storage}</p>
            </div>
          )}
        </section>
      )}

      {/* Tus notas: valoración, raciones mínimas, notas, sustituciones,
          etiquetas propias — household-shared. */}
      {user && <RecipeNotesSection recipeId={recipe.id} />}

      {/* Household photo gallery — distinct from the hero shot. */}
      {user && <RecipePhotoGallery recipeId={recipe.id} />}

      {/* Author + admin: edit + regenerate-image affordances. Admins can
          curate the whole catalogue so they see the same controls. */}
      {user && canEdit && (
        <section className="mt-10 flex flex-wrap items-center gap-3" aria-label="Tu receta">
          <Link
            href={`/recipes/${recipe.id}/edit`}
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[#DDD6C5] bg-[#F2EDE0] px-5 text-[12px] uppercase tracking-[0.12em] text-[#1A1612] transition-all hover:border-[#1A1612]"
          >
            <Pencil size={14} />
            Editar receta
          </Link>
          {recipe.authorId === user.id && (
            <RegenerateImageButton recipeId={recipe.id} userId={user.id} />
          )}
          {recipe.authorId !== user.id && user.role === "admin" && (
            <span className="rounded-full bg-[#C65D38]/15 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-[#C65D38]">
              Admin
            </span>
          )}
        </section>
      )}

      {/* Non-author + non-admin: copy into "Mis recetas" to get an editable version. */}
      {user && recipe.authorId !== user.id && user.role !== "admin" && (
        <CopyToMineButton recipeId={recipe.id} />
      )}

      {!user && !(recipe.notes || recipe.tips || recipe.substitutions || recipe.storage) && (
        <EmptyLine>Esta receta no tiene notas.</EmptyLine>
      )}
    </div>
  )

  const header = (
    <RecipeHeader recipe={recipe} tags={tags} isDesktop={isDesktop} />
  )

  // ─── Desktop (lg+): sticky photo left, long-scroll column right ───
  if (isDesktop) {
    return (
      <div className="mx-auto grid min-h-screen max-w-[1280px] grid-cols-2 items-start gap-10 bg-[#FAF6EE] pb-10 pl-8 pr-12 pt-7">
        <div className="sticky top-7 h-[calc(100dvh-56px)] max-h-[960px] min-h-[480px] overflow-hidden rounded-[24px] bg-[#EFE8D8]">
          <motion.img
            initial={{ scale: 1.04 }}
            animate={{ scale: 1 }}
            transition={{ duration: 1.2, ease: [0.19, 1, 0.22, 1] }}
            src={img}
            alt={recipe.name}
            className="h-full w-full object-cover"
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-[#1A1612]/40 to-transparent" />
          <Link
            href="/recipes"
            className="absolute left-4 top-4 flex h-11 items-center gap-1 rounded-full bg-[#FFFEFA] pl-2.5 pr-4 text-[14px] font-semibold text-[#1A1612] shadow-sm transition-transform active:scale-95"
          >
            <ChevronLeft size={20} aria-hidden />
            Recetas
          </Link>
          <div className="pointer-events-none absolute bottom-5 left-5 text-[10px] uppercase tracking-[0.25em] text-[#FAF6EE]/85">
            Mimoia · Receta
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.6 }}
          className="flex min-w-0 flex-col gap-[18px] pt-2"
        >
          {header}

          <div className="flex flex-wrap items-center gap-2.5">
            <Link
              href={cookHref}
              className="flex h-[50px] items-center gap-2 rounded-full bg-[#1A1612] px-6 text-[16px] font-semibold text-[#FAF6EE] transition-colors hover:bg-[#2D6A4F]"
            >
              <Play size={16} fill="currentColor" strokeWidth={0} aria-hidden />
              Empezar a cocinar
            </Link>
            <button
              type="button"
              onClick={handleShare}
              aria-label="Compartir receta"
              className="flex h-[50px] w-[50px] items-center justify-center rounded-full border border-[#DDD6C5] bg-[#FFFEFA] text-[#1A1612] transition-colors hover:border-[#1A1612]"
            >
              <Share2 size={18} />
            </button>
            {user && (
              <FavoriteButton
                recipeId={recipe.id}
                userId={user.id}
                isFavorite={recipe.is_favorite ?? false}
                tone="ink"
                className="relative flex h-[50px] w-[50px] items-center justify-center rounded-full border border-[#DDD6C5] bg-[#FFFEFA] transition-colors hover:border-[#1A1612]"
              />
            )}
          </div>

          <DesktopSection title="Ingredientes" aside={servingsStepper}>
            {ingredientsList}
          </DesktopSection>

          <DesktopSection title="Preparación">{stepsBlock}</DesktopSection>

          {hasExtras && <section className="border-t border-[#DDD6C5] pt-[18px]">{extras}</section>}

          {nutritionBlock && (
            <section className="border-t border-[#DDD6C5] pt-[18px]">{nutritionBlock}</section>
          )}

          <DesktopSection title="Notas">{notesBlock}</DesktopSection>
        </motion.div>
      </div>
    )
  }

  // ─── Mobile / tablet (< lg): hero, tabs, sticky action bar ───
  const panel = (key: TabKey, title: string, children: ReactNode) => (
    <div
      role="tabpanel"
      id={recipePanelId(TAB_ID_PREFIX, key)}
      aria-labelledby={recipeTabId(TAB_ID_PREFIX, key)}
      hidden={activeTab !== key}
      tabIndex={0}
      className="pt-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1A1612]/20"
    >
      <h2 className="sr-only">{title}</h2>
      {children}
    </div>
  )

  return (
    // Bottom room for the action bar: <main> already pads 80 px (pb-20, sized
    // for the tab bar this route hides); 24 px more + the home-indicator
    // inset clears the 84 px bar with a little air.
    <div className="min-h-screen bg-[#FAF6EE] pb-[calc(var(--safe-bottom)+24px)] md:mx-auto md:max-w-[640px]">
      {/* Hero photo */}
      <div className="relative h-[390px] overflow-hidden bg-[#EFE8D8]">
        <motion.img
          initial={{ scale: 1.05 }}
          animate={{ scale: 1 }}
          transition={{ duration: 1.2, ease: [0.19, 1, 0.22, 1] }}
          src={img}
          alt={recipe.name}
          className="h-full w-full object-cover"
        />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[#1A1612]/45 to-transparent" />

        <div className="absolute inset-x-0 top-0 flex items-center justify-between px-4 pt-4">
          <BackButton />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleShare}
              aria-label="Compartir receta"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-[#FFFEFA] text-[#1A1612] shadow-sm transition-transform active:scale-95"
            >
              <Share2 size={18} />
            </button>
            {user && (
              <FavoriteButton
                recipeId={recipe.id}
                userId={user.id}
                isFavorite={recipe.is_favorite ?? false}
                tone="ink"
                className="relative flex h-11 w-11 items-center justify-center rounded-full bg-[#FFFEFA] shadow-sm transition-transform active:scale-95"
              />
            )}
          </div>
        </div>

        <div className="pointer-events-none absolute bottom-[44px] left-5 text-[10px] uppercase tracking-[0.25em] text-[#FAF6EE]/85">
          Mimoia · Receta
        </div>
      </div>

      {/* Cream sheet */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.6 }}
        className="relative -mt-7 rounded-t-[24px] bg-[#FAF6EE] px-5 pt-5"
      >
        {header}

        <div ref={tabsAnchorRef} aria-hidden className="h-0" />
        <RecipeTabs
          tabs={tabs}
          active={activeTab}
          onChange={selectTab}
          idPrefix={TAB_ID_PREFIX}
          className="sticky top-[var(--safe-top)] z-20 -mx-5 mt-3 bg-[#FAF6EE] px-5"
        />

        {panel(
          "ingredientes",
          "Ingredientes",
          <>
            <div className="mb-1 flex items-center justify-between gap-3">
              <span className="text-[14px] text-[#4A4239]">Para</span>
              {servingsStepper}
            </div>
            {ingredientsList}
            {hasExtras && <div className="mt-8">{extras}</div>}
          </>,
        )}
        {panel("pasos", "Preparación", stepsBlock)}
        {hasNutrition && panel("nutricion", "Nutrición", nutritionBlock)}
        {panel("notas", "Notas", notesBlock)}
      </motion.div>

      <RecipeActionBar cookHref={cookHref} />
    </div>
  )
}

/* ─────────────────────────────────────────────
   Header: eyebrow · title · meta / source / cook history
   ───────────────────────────────────────────── */
function RecipeHeader({
  recipe,
  tags,
  isDesktop,
}: {
  recipe: Recipe
  tags: string[]
  isDesktop: boolean
}) {
  const eyebrow = recipeEyebrow(
    { ...recipe, tags },
    { withTimeAndDifficulty: !isDesktop },
  )
  const total = minutesLabel(recipeTotalMinutes(recipe))
  const difficulty = recipe.difficulty ? DIFFICULTY_LABELS[recipe.difficulty] : ""
  const kcal = recipe.nutritionPerServing?.kcal
  const metaParts = [
    total,
    difficulty,
    kcal != null && kcal > 0 ? `${Math.round(kcal)} kcal por ración` : "",
  ].filter(Boolean)

  return (
    <div className={`flex flex-col ${isDesktop ? "gap-1.5" : "gap-1"}`}>
      {eyebrow && (
        <div
          className={`${isDesktop ? "text-[12px]" : "text-[11px]"} font-semibold uppercase tracking-[0.16em] text-[#6E655B]`}
          data-testid="recipe-eyebrow"
        >
          {eyebrow}
        </div>
      )}
      <h1
        className={`font-display font-semibold! text-[#1A1612] ${
          isDesktop ? "text-[48px] leading-[1.02]" : "text-[30px] leading-[1.1]"
        }`}
      >
        {recipe.name}
      </h1>
      {isDesktop && metaParts.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-x-[18px] gap-y-1 text-[15px] text-[#4A4239]">
          {metaParts.map((p) => (
            <span key={p}>{p}</span>
          ))}
        </div>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 empty:hidden">
        {recipe.yieldText && (
          <span className="font-italic text-[14px] italic text-[#7A7066]">Rinde {recipe.yieldText}</span>
        )}
        {recipe.sourceUrl && (
          <a
            href={recipe.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-8 items-center gap-1.5 text-[11px] uppercase tracking-[0.12em] text-[#7A7066] transition-colors hover:text-[#C65D38]"
          >
            {recipe.sourceType === "youtube" ? <Youtube size={12} /> : <ExternalLink size={12} />}
            Ver fuente
            {recipe.sourceType === "youtube" ? " (vídeo)" : ""}
          </a>
        )}
        <CookedBadge recipeId={recipe.id} />
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────
   Equipo · Alérgenos · Temporada · Etiquetas
   ───────────────────────────────────────────── */
function RecipeExtras({
  recipe,
  tags,
  headingAs,
}: {
  recipe: Recipe
  tags: string[]
  headingAs: "h2" | "h3"
}) {
  const H = headingAs
  const headingCls = "mb-2.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6E655B]"
  const chip = "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px]"
  const blocks: ReactNode[] = []

  if (recipe.equipment?.length > 0) {
    blocks.push(
      <div key="equipo">
        <H className={headingCls}>Equipo</H>
        <div className="flex flex-wrap gap-1.5">
          {recipe.equipment.map((tool) => (
            <span key={tool} className={`${chip} border border-[#DDD6C5] bg-[#FFFEFA] text-[#4A4239]`}>
              <Wrench size={11} className="text-[#7A7066]" aria-hidden />
              {tool}
            </span>
          ))}
        </div>
      </div>,
    )
  }
  if (recipe.allergens?.length > 0) {
    blocks.push(
      <div key="alergenos">
        <H className={headingCls}>Alérgenos</H>
        <div className="flex flex-wrap gap-1.5">
          {recipe.allergens.map((a) => (
            <span key={a} className={`${chip} bg-[#FDEEE8] font-medium text-[#B5451B]`}>
              {allergenLabel(a)}
            </span>
          ))}
        </div>
      </div>,
    )
  }
  if (recipe.seasons?.length > 0) {
    blocks.push(
      <div key="temporada">
        <H className={headingCls}>Temporada</H>
        <p className="flex items-center gap-1.5 text-[14px] text-[#4A4239]">
          <Sparkles size={13} className="text-[#7A7066]" aria-hidden />
          {recipe.seasons
            .map((s: string) => SEASON_LABELS[s as keyof typeof SEASON_LABELS] ?? s)
            .join(" · ")}
        </p>
      </div>,
    )
  }
  if (tags.length > 0) {
    blocks.push(
      <div key="etiquetas">
        <H className={headingCls}>Etiquetas</H>
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-[#F2EDE0] px-2.5 py-1 text-[11px] uppercase tracking-[0.1em] text-[#4A4239]"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>,
    )
  }
  if (blocks.length === 0) return null
  return <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-x-8">{blocks}</div>
}

function DesktopSection({
  title,
  aside,
  children,
}: {
  title: string
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="border-t border-[#DDD6C5] pt-[18px]">
      <div className="mb-3 flex items-center justify-between gap-4">
        <h2 className="font-display text-[1.75rem] leading-tight text-[#1A1612]">
          <span className="font-italic italic">{title}</span>
        </h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="py-4 text-[14px] italic text-[#7A7066]">{children}</p>
}

/**
 * Hero back button. Goes back in history when the user arrived from inside
 * the app (menu, catalogue, cookbook…); a link opened cold (WhatsApp, a new
 * tab) has nothing to go back to, so it falls through to the catalogue.
 */
function BackButton() {
  const router = useRouter()
  return (
    <Link
      href="/recipes"
      onClick={(e) => {
        if (window.history.length > 1) {
          e.preventDefault()
          router.back()
        }
      }}
      aria-label="Volver"
      className="flex h-11 w-11 items-center justify-center rounded-full bg-[#FFFEFA] text-[#1A1612] shadow-sm transition-transform active:scale-95"
    >
      <ChevronLeft size={20} aria-hidden />
    </Link>
  )
}

/* ─────────────────────────────────────────────
   Regenerate image button (author-only)
   ───────────────────────────────────────────── */
function RegenerateImageButton({
  recipeId,
  userId,
}: {
  recipeId: string
  userId: string
}) {
  const regen = useRegenerateRecipeImage(recipeId, userId)
  const { data: profile } = useUser(userId)
  const quota = regen.data?.quota ?? profile?.imageGenQuota
  const exhausted = quota ? quota.used >= quota.limit : false

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => regen.mutate()}
        disabled={regen.isPending || exhausted}
        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[#DDD6C5] bg-[#F2EDE0] px-5 text-[12px] uppercase tracking-[0.12em] text-[#1A1612] transition-all hover:border-[#1A1612] disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Sparkles size={14} />
        {regen.isPending ? "Generando…" : "Regenerar imagen"}
      </button>
      {quota && !regen.error ? (
        <span className="text-[10px] uppercase tracking-[0.12em] text-[#7A7066]">
          {quota.used}/{quota.limit} este mes
        </span>
      ) : null}
      {regen.error ? (
        <span className="text-[11px] italic text-[#C65D38]">
          {regen.error.message}
        </span>
      ) : null}
    </div>
  )
}

/* ─────────────────────────────────────────────
   Copy-to-mine button
   ───────────────────────────────────────────── */
function CopyToMineButton({ recipeId }: { recipeId: string }) {
  const router = useRouter()
  const copy = useCopyRecipe()
  const [error, setError] = useState<string | null>(null)
  return (
    <section className="mt-8 flex flex-col gap-2">
      <button
        type="button"
        onClick={() => {
          setError(null)
          copy.mutate(recipeId, {
            onSuccess: (created) => router.push(`/recipes/${created.id}`),
            onError: (err: any) => {
              setError(err?.message ?? "No se pudo copiar la receta.")
            },
          })
        }}
        disabled={copy.isPending}
        className="inline-flex min-h-11 items-center gap-2 self-start rounded-full border border-[#DDD6C5] bg-[#F2EDE0] px-5 text-[12px] uppercase tracking-[0.12em] text-[#1A1612] transition-all hover:border-[#1A1612] disabled:cursor-not-allowed disabled:opacity-40"
      >
        <BookmarkPlus size={14} />
        {copy.isPending ? "Añadiendo…" : "Añadir a mis recetas"}
      </button>
      {error && <p className="text-[12px] italic text-[#C65D38]">{error}</p>}
    </section>
  )
}
