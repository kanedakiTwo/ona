"use client"

/**
 * /cookbooks/[id] — drill-in detail for a single household cookbook (PR 8A),
 * "D · Luz y foto" (PRO-43): compact header (emoji tile, Fraunces title,
 * description, count) with a "···" sheet holding "Editar recetario" (inline
 * rename + emoji + description editor) and "Borrar recetario"; the recipes
 * use the `/recipes` grid (`CatalogGrid`) with a "Quitar del recetario"
 * button over each photo.
 */
import { useEffect, useState } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { ChevronLeft, MoreHorizontal, Pencil, Trash2 } from "lucide-react"
import {
  useCookbook,
  useDeleteCookbook,
  usePatchCookbook,
  useRemoveRecipeFromCookbook,
} from "@/hooks/useCookbooks"
import CatalogGrid from "@/components/recipes/CatalogGrid"
import { DISPLAY_UI } from "@/components/recipes/RecipeCard"
import { MenuSheet, SheetAction } from "@/components/menu/MenuSheet"

const EMOJI_SUGGESTIONS = ['📖', '⭐', '🥗', '🍝', '🍰', '🥩', '🌮', '🍲', '☕']

export default function CookbookDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const id = String(params?.id ?? "")
  const { data, isLoading } = useCookbook(id)
  const patch = usePatchCookbook()
  const del = useDeleteCookbook()
  const removeRecipe = useRemoveRecipeFromCookbook()

  const [editing, setEditing] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [emoji, setEmoji] = useState<string>('📖')

  useEffect(() => {
    if (data) {
      setName(data.name)
      setDescription(data.description ?? "")
      setEmoji(data.emoji ?? '📖')
    }
  }, [data])

  function handleSave() {
    if (!data) return
    const trimmed = name.trim()
    if (!trimmed) return
    patch.mutate(
      {
        id: data.id,
        patch: {
          name: trimmed,
          description: description.trim() || null,
          emoji,
        },
      },
      { onSuccess: () => setEditing(false) },
    )
  }

  function handleDeleteCookbook() {
    if (!data) return
    if (
      typeof window !== "undefined" &&
      !window.confirm(`¿Borrar el recetario "${data.name}"? Las recetas no se borran, solo este recetario.`)
    ) {
      return
    }
    del.mutate({ id: data.id }, { onSuccess: () => router.push("/profile/cookbooks") })
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream">
        <div className="text-eyebrow text-ink-muted" role="status">Cargando…</div>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream">
        <div className="text-eyebrow text-ink-muted">Recetario no encontrado.</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-cream">
      <div className="mx-auto w-full max-w-[1180px] pb-24 lg:px-12 lg:pt-8 lg:pb-10">
        <header className="px-5 pt-3 pb-5 lg:px-0 lg:pb-8">
          <Link
            href="/profile/cookbooks"
            className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-full px-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-muted transition-colors hover:text-terracotta-deep"
          >
            <ChevronLeft size={16} /> Recetarios
          </Link>

          {editing ? (
            <div className="mt-2 space-y-4 rounded-[20px] border border-border-soft bg-paper p-4 lg:max-w-[560px]">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
                aria-label="Nombre del recetario"
                className={`${DISPLAY_UI} w-full border-b border-border bg-transparent py-1.5 text-2xl text-ink outline-none focus:border-ink`}
              />
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={280}
                placeholder="Descripción (opcional)"
                className="w-full border-b border-border bg-transparent py-2 text-[15px] text-ink outline-none placeholder:text-ink-light focus:border-ink"
              />
              <div className="flex flex-wrap gap-1.5">
                {EMOJI_SUGGESTIONS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => setEmoji(e)}
                    aria-pressed={emoji === e}
                    className={`h-11 w-11 rounded-full text-lg transition-colors ${
                      emoji === e ? 'bg-ink text-cream' : 'bg-cream-deep hover:bg-bone'
                    }`}
                  >
                    {e}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false)
                    setName(data.name)
                    setDescription(data.description ?? "")
                    setEmoji(data.emoji ?? '📖')
                  }}
                  className="min-h-11 flex-1 rounded-full border border-border bg-paper text-[14px] font-semibold text-ink-mid transition-colors hover:bg-cream-deep"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={patch.isPending || !name.trim()}
                  className="min-h-11 flex-1 rounded-full bg-ink text-[14px] font-semibold text-cream transition-colors hover:bg-ink-mid disabled:opacity-40"
                >
                  Guardar
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-2 flex items-start gap-4">
              <div
                aria-hidden="true"
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[16px] bg-cream-deep text-[28px] lg:h-16 lg:w-16"
              >
                {data.emoji ?? '📖'}
              </div>
              <div className="min-w-0 flex-1">
                <h1 className={`${DISPLAY_UI} text-[28px] leading-[1.1] text-ink lg:text-[40px] lg:leading-[1.05]`}>
                  {data.name}
                </h1>
                {data.description && (
                  <p className="mt-1 text-[14px] leading-snug text-ink-muted">{data.description}</p>
                )}
                <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-muted">
                  {data.recipeCount} {data.recipeCount === 1 ? 'receta' : 'recetas'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSheetOpen(true)}
                aria-label="Opciones del recetario"
                aria-haspopup="dialog"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border bg-paper text-ink transition-colors hover:bg-cream-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              >
                <MoreHorizontal size={20} strokeWidth={2} />
              </button>
            </div>
          )}
        </header>

        <section className="px-5 lg:px-0">
          <CatalogGrid
            recipes={data.recipes}
            isLoading={false}
            emptyState={
              <div className="rounded-[22px] border border-dashed border-border bg-paper px-6 py-10 text-center">
                <p className="font-serif-text font-[650] text-lg text-ink">Aún no hay recetas.</p>
                <p className="mt-1 text-[14px] text-ink-muted">
                  Añade desde el botón "Añadir a recetario" en cualquier receta.
                </p>
              </div>
            }
            renderAction={(r) => (
              <button
                type="button"
                onClick={() => removeRecipe.mutate({ cookbookId: data.id, recipeId: r.id })}
                aria-label="Quitar del recetario"
                className="group/remove absolute top-0 right-0 flex h-11 w-11 items-center justify-center"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-paper/95 text-ink-mid shadow-sm backdrop-blur-sm transition-colors group-hover/remove:bg-terracotta-deep group-hover/remove:text-cream">
                  <Trash2 size={14} />
                </span>
              </button>
            )}
          />
        </section>
      </div>

      <MenuSheet open={sheetOpen} onClose={() => setSheetOpen(false)} eyebrow="Recetario" title={data.name}>
        <div className="flex flex-col gap-1">
          <SheetAction
            icon={Pencil}
            label="Editar recetario"
            hint="Nombre, emoji y descripción"
            onClick={() => {
              setSheetOpen(false)
              setEditing(true)
            }}
          />
          <SheetAction
            icon={Trash2}
            label="Borrar recetario"
            hint="Solo se borra el recetario, las recetas siguen ahí."
            destructive
            onClick={() => {
              setSheetOpen(false)
              handleDeleteCookbook()
            }}
          />
        </div>
      </MenuSheet>
    </div>
  )
}
