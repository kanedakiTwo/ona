"use client"

/**
 * PendingRecipesSection — Admin → «Recetas pendientes» (/admin/recetas,
 * specs/catalog-import.md, specs/admin-dashboard.md).
 *
 * The catalogue drafts, by batch, laid out like a cookbook index (each batch
 * a chapter, each recipe a line with dotted leaders to where it comes from),
 * the way recipes from two books were picked for the catalogue. Per recipe:
 * «Publicar» (his OK + this recipe out) and «Descartar» (his «no»); per batch,
 * «Publicar las aprobadas» when the rule leaves any. D-099: every Cocina
 * recipe is seen and approved one by one; nothing goes out without a click.
 * The import of a new batch file lives on top (CatalogImportPanel).
 */

import { useMemo, useState } from "react"
import Link from "next/link"
import { ApiError } from "@/lib/api"
import type { CatalogDraftBatchView, CatalogDraftView } from "@ona/shared"
import { DISPLAY_UI } from "@/components/recipes/RecipeCard"
import { RecipeCover } from "@/components/menu/RecipeCover"
import { useCatalogDrafts, useDraftAction, usePublishBatch } from "@/hooks/useCatalogReview"
import { CatalogImportPanel } from "./CatalogImportPanel"
import { Empty } from "./shared"

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

const DIFFICULTY: Record<string, string> = { easy: "Fácil", medium: "Media", hard: "Difícil" }

function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase()
}

function originLabel(origins: CatalogDraftBatchView["origins"]): string {
  if (origins.length > 1) return "Cocina y tus fuentes"
  return origins[0] === "miguel" ? "Tus fuentes" : "Cocina"
}

/** «Cocina · Escritas por Cocina» / «Recetario de mamá · pág. 12». */
function reference(d: CatalogDraftView): string {
  const parts = [d.origin === "miguel" ? d.book ?? "Tus fuentes" : "Cocina", d.origin === "miguel" ? null : d.book, d.page ? `pág. ${d.page}` : null]
  return parts.filter(Boolean).join(" · ")
}

function Chip({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "warn" | "ink" }) {
  const cls =
    tone === "warn" ? "bg-warn-bg text-warn-text" : tone === "ink" ? "border border-ink text-ink" : "bg-cream-deep text-ink-mid"
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] ${cls}`}>{children}</span>
}

type Notice = { tone: "ok" | "error"; text: string } | null

export function PendingRecipesSection() {
  const drafts = useCatalogDrafts()
  const [query, setQuery] = useState("")
  const [onlyDoubts, setOnlyDoubts] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)

  const batches = useMemo(() => {
    const words = fold(query.trim()).split(/\s+/).filter(Boolean)
    const visible = (d: CatalogDraftView) => {
      if (onlyDoubts && !d.allergenDoubt && d.auditIssues.length === 0) return false
      if (words.length === 0) return true
      const hay = fold(`${d.name} ${d.ingredients.join(" ")} ${d.book ?? ""}`)
      return words.every((w) => hay.includes(w))
    }
    return (drafts.data?.batches ?? []).map((b) => ({ ...b, shown: b.pending.filter(visible) }))
  }, [drafts.data, query, onlyDoubts])

  const total = drafts.data?.pending ?? 0
  const filtering = query.trim() !== "" || onlyDoubts
  const anyShown = batches.some((b) => b.shown.length > 0 || (!filtering && b.discarded.length > 0))

  return (
    <section data-testid="pending-recipes" className="space-y-6">
      <CatalogImportPanel />

      {/* Count + filters, sticky like the index bar of a cookbook. */}
      <div className="sticky top-0 z-10 -mx-5 border-b border-border-soft bg-cream/95 px-5 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-baseline gap-2">
            <span data-testid="pending-count" className={`${DISPLAY_UI} text-[26px] leading-none text-ink`}>
              {total}
            </span>
            <span className="text-[13px] text-ink-muted">{total === 1 ? "pendiente" : "pendientes"}</span>
          </div>
          <p role="status" aria-live="polite" className={`min-w-0 flex-1 text-[12px] ${notice?.tone === "error" ? "text-warn-text" : "text-ink-mid"}`}>
            {notice?.text ?? ""}
          </p>
          <div className="flex w-full flex-wrap items-center gap-2 md:w-auto">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar plato o ingrediente"
              aria-label="Buscar plato o ingrediente"
              className="min-h-[44px] min-w-0 flex-1 rounded-full border border-border bg-paper px-4 text-[14px] text-ink focus:border-ink focus:outline-none md:w-60 md:flex-none"
            />
            <button
              type="button"
              aria-pressed={onlyDoubts}
              onClick={() => setOnlyDoubts((v) => !v)}
              className={`inline-flex min-h-[44px] shrink-0 items-center rounded-full border px-4 text-[13px] font-medium ${
                onlyDoubts ? "border-ink bg-ink text-cream" : "border-border-soft bg-paper text-ink-mid hover:border-ink"
              }`}
            >
              Solo con dudas
            </button>
          </div>
        </div>
        {/* Mobile: batches as chips (the desktop index sits on the left). */}
        {batches.length > 1 && (
          <nav aria-label="Tandas" className="-mx-5 mt-2 flex gap-1.5 overflow-x-auto px-5 pb-1 scrollbar-none lg:hidden">
            {batches.map((b) => (
              <a key={b.batch} href={`#tanda-${b.batch}`} className="inline-flex min-h-[36px] shrink-0 items-center rounded-full bg-cream-deep px-3 text-[13px] text-ink">
                {b.batch}
                <span className="ml-1.5 text-[11px] text-ink-muted">{b.pending.length}</span>
              </a>
            ))}
          </nav>
        )}
      </div>

      {drafts.isLoading && <p className="text-[12px] italic text-ink-muted">Cargando borradores…</p>}
      {drafts.isError && <p className="text-[13px] text-warn-text">No se han podido cargar los borradores. Prueba otra vez.</p>}
      {drafts.data && drafts.data.batches.length === 0 && (
        <Empty>No hay recetas pendientes. Cuando importes una tanda, sus borradores aparecen aquí.</Empty>
      )}
      {drafts.data && drafts.data.batches.length > 0 && !anyShown && <Empty>Ninguna receta con estos filtros.</Empty>}

      <div className="lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-10">
        {batches.length > 0 && (
          <nav aria-label="Índice de tandas" className="hidden lg:block">
            <div className="sticky top-24 space-y-0.5">
              <p className="text-eyebrow mb-2 text-ink-muted">Tandas</p>
              {batches.map((b) => (
                <a
                  key={b.batch}
                  href={`#tanda-${b.batch}`}
                  className="flex items-baseline justify-between gap-2 border-b border-dotted border-border py-1.5 text-[14px] text-ink hover:text-terracotta-deep"
                >
                  <span className="truncate font-mono text-[13px]">{b.batch}</span>
                  <span className="shrink-0 text-[12px] text-ink-muted">{b.pending.length}</span>
                </a>
              ))}
            </div>
          </nav>
        )}
        <div className="min-w-0 space-y-10">
          {batches
            .filter((b) => b.shown.length > 0 || (!filtering && (b.discarded.length > 0 || b.pending.length === 0)))
            .map((b) => (
              <BatchChapter key={b.batch} batch={b} shown={b.shown} filtering={filtering} onNotice={setNotice} />
            ))}
        </div>
      </div>
    </section>
  )
}

function BatchChapter({
  batch,
  shown,
  filtering,
  onNotice,
}: {
  batch: CatalogDraftBatchView
  shown: CatalogDraftView[]
  filtering: boolean
  onNotice: (n: Notice) => void
}) {
  const publishBatch = usePublishBatch()
  const [confirming, setConfirming] = useState(false)
  const onlyMiguel = batch.origins.length === 1 && batch.origins[0] === "miguel"

  function publishApproved() {
    publishBatch.mutate(batch.batch, {
      onSuccess: (r) => {
        setConfirming(false)
        onNotice({ tone: "ok", text: `Tanda ${batch.batch}: ${plural(r.published, "receta publicada", "recetas publicadas")}.` })
      },
      onError: (err) => onNotice({ tone: "error", text: (err as Error).message }),
    })
  }

  return (
    <section id={`tanda-${batch.batch}`} aria-labelledby={`tanda-${batch.batch}-title`} data-testid="catalog-batch" className="scroll-mt-40">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b-2 border-ink pb-2">
        <h2 id={`tanda-${batch.batch}-title`} className={`${DISPLAY_UI} text-[24px] leading-tight text-ink`}>
          {batch.batch}
        </h2>
        <span className="text-[12px] text-ink-muted">
          {originLabel(batch.origins)} · {plural(batch.pending.length, "por decidir", "por decidir")} · {plural(batch.publishedCount, "publicada", "publicadas")}
          {batch.discarded.length > 0 ? ` · ${plural(batch.discarded.length, "descartada", "descartadas")}` : ""}
        </span>
        {batch.publishable > 0 && !confirming && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="ml-auto inline-flex min-h-[44px] items-center rounded-full border border-ink px-4 text-[13px] font-semibold text-ink hover:bg-ink hover:text-cream"
          >
            {onlyMiguel
              ? batch.publishable === 1
                ? "Publicar la que pasa la auditoría"
                : `Publicar las ${batch.publishable} que pasan la auditoría`
              : batch.publishable === 1
                ? "Publicar la aprobada"
                : `Publicar las ${batch.publishable} aprobadas`}
          </button>
        )}
      </header>

      {confirming && (
        <div role="alertdialog" aria-labelledby={`confirm-${batch.batch}`} className="mt-3 rounded-[16px] border border-ink bg-cream p-4">
          <p id={`confirm-${batch.batch}`} className="font-semibold text-ink">
            ¿Publicar {plural(batch.publishable, "receta", "recetas")} de la tanda {batch.batch}?
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-mid">
            {onlyMiguel
              ? "Son de tus fuentes y pasan la auditoría: saldrán al catálogo y las verán todos los hogares."
              : "Son las que ya aprobaste y aún no han salido. Saldrán al catálogo y las verán todos los hogares."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={publishApproved}
              disabled={publishBatch.isPending}
              className="inline-flex min-h-[44px] items-center rounded-full bg-ink px-5 text-[13px] font-semibold text-cream disabled:opacity-50"
            >
              {publishBatch.isPending ? "Publicando…" : "Sí, publicar"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="inline-flex min-h-[44px] items-center rounded-full border border-border-soft px-5 text-[13px] font-medium text-ink-mid"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {batch.pending.length === 0 && !filtering && <p className="mt-3 text-[13px] text-ink-muted">Nada por decidir en esta tanda.</p>}
      <ul className="mt-1">
        {shown.map((d) => (
          <DraftLine key={d.id} draft={d} onNotice={onNotice} />
        ))}
      </ul>

      {!filtering && batch.discarded.length > 0 && (
        <details className="mt-3">
          <summary className="inline-flex min-h-[44px] cursor-pointer items-center text-[13px] font-medium text-ink-mid underline underline-offset-2">
            Descartadas ({batch.discarded.length})
          </summary>
          <p className="text-[12px] text-ink-muted">No salen nunca; se quedan guardadas para que una nueva importación no las vuelva a traer.</p>
          <ul className="mt-1">
            {batch.discarded.map((d) => (
              <DiscardedLine key={d.id} draft={d} onNotice={onNotice} />
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

function DraftLine({ draft: d, onNotice }: { draft: CatalogDraftView; onNotice: (n: Notice) => void }) {
  const publish = useDraftAction("publish")
  const discard = useDraftAction("discard")
  const [open, setOpen] = useState(false)
  const busy = publish.isPending || discard.isPending
  const held = d.decision === "auditoria"
  const facts = [
    `${d.servings} raciones`,
    d.totalTime ? `${d.totalTime} min` : null,
    plural(d.stepCount, "paso", "pasos"),
    d.difficulty ? DIFFICULTY[d.difficulty] ?? d.difficulty : null,
  ].filter(Boolean)

  const fail = (err: unknown) => onNotice({ tone: "error", text: err instanceof ApiError || err instanceof Error ? err.message : "No se ha podido hacer." })

  return (
    <li data-testid="draft-row" data-draft-id={d.id} className="grid grid-cols-[52px_minmax(0,1fr)] gap-3 border-b border-border-soft py-4">
      <RecipeCover src={d.imageUrl} name={d.name} className="h-[52px] w-[52px] rounded-xl" />
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 sm:flex-nowrap">
          <Link href={`/recipes/${d.id}`} className="min-w-0 text-[15px] font-medium leading-snug text-ink underline-offset-2 [overflow-wrap:anywhere] hover:underline">
            {d.name}
          </Link>
          <span aria-hidden className="hidden min-w-4 flex-1 -translate-y-1 border-b-[1.5px] border-dotted border-border sm:block" />
          <span className="w-full text-[12px] text-ink-muted sm:w-auto sm:shrink-0 sm:whitespace-nowrap">{reference(d)}</span>
        </div>
        {d.credit && <p className="font-italic text-[16px] leading-tight text-ink-muted">{d.credit}</p>}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {d.allergenDoubt && <Chip tone="warn">Duda de alérgenos</Chip>}
          {d.auditIssues.map((i) => (
            <Chip key={i.code} tone="warn">
              Auditoría: {i.label}
            </Chip>
          ))}
          {d.verdict === "ok" && <Chip tone="ink">Ya dijiste que sí</Chip>}
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex min-h-[32px] items-center px-1 text-[12px] text-ink-muted underline underline-offset-2"
          >
            {open ? "Ocultar detalles" : "Detalles"}
          </button>
        </div>
        {open && (
          <div className="mt-2 space-y-1 text-[13px] leading-relaxed text-ink-mid">
            <p>{facts.join(" · ")}</p>
            {d.ingredients.length > 0 && <p>{d.ingredients.join(", ")}.</p>}
            {d.tags.length > 0 && <p className="text-ink-muted">Etiquetas: {d.tags.join(", ")}</p>}
            {d.tips && <p className="text-ink-muted">Consejo: {d.tips}</p>}
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || held}
            aria-label={`Publicar ${d.name}`}
            onClick={() =>
              publish.mutate(d.id, {
                onSuccess: (r) => onNotice({ tone: "ok", text: `«${r.name}» publicada.` }),
                onError: fail,
              })
            }
            className="inline-flex min-h-[44px] items-center rounded-full bg-ink px-5 text-[13px] font-semibold text-cream hover:bg-terracotta-deep disabled:opacity-40 disabled:hover:bg-ink"
          >
            {publish.isPending ? "Publicando…" : "Publicar"}
          </button>
          <button
            type="button"
            disabled={busy}
            aria-label={`Descartar ${d.name}`}
            onClick={() =>
              discard.mutate(d.id, {
                onSuccess: (r) => onNotice({ tone: "ok", text: `«${r.name}» descartada: no saldrá.` }),
                onError: fail,
              })
            }
            className="inline-flex min-h-[44px] items-center rounded-full border border-border px-5 text-[13px] font-medium text-ink-mid hover:border-ink hover:text-ink disabled:opacity-40"
          >
            {discard.isPending ? "Descartando…" : "Descartar"}
          </button>
        </div>
        {held && (
          <p className="mt-2 text-[12px] text-warn-text">
            No se puede publicar mientras la auditoría vea algo: corrige la receta o descártala.
          </p>
        )}
      </div>
    </li>
  )
}

function DiscardedLine({ draft: d, onNotice }: { draft: CatalogDraftView; onNotice: (n: Notice) => void }) {
  const restore = useDraftAction("restore")
  return (
    <li data-testid="discarded-row" className="flex flex-wrap items-center justify-between gap-2 border-b border-border-soft py-2">
      <Link href={`/recipes/${d.id}`} className="min-w-0 text-[14px] text-ink-mid line-through decoration-ink-light [overflow-wrap:anywhere] hover:text-ink">
        {d.name}
      </Link>
      <button
        type="button"
        aria-label={`Recuperar ${d.name}`}
        disabled={restore.isPending}
        onClick={() =>
          restore.mutate(d.id, {
            onSuccess: (r) => onNotice({ tone: "ok", text: `«${r.name}» vuelve a pendientes.` }),
            onError: (err) => onNotice({ tone: "error", text: (err as Error).message }),
          })
        }
        className="inline-flex min-h-[44px] items-center rounded-full border border-border-soft px-4 text-[13px] font-medium text-ink-mid hover:border-ink disabled:opacity-40"
      >
        Recuperar
      </button>
    </li>
  )
}
