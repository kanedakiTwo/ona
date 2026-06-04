"use client"

/**
 * /cookbooks/[id] — drill-in detail for a single household cookbook (PR 8A).
 *
 * Shows the recipes inside the cookbook (clickable cards), the inline
 * rename + emoji + description editor, and a destructive "Borrar
 * recetario" button.
 */
import { useEffect, useState } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { ChevronLeft, Pencil, Trash2 } from "lucide-react"
import {
  useCookbook,
  useDeleteCookbook,
  usePatchCookbook,
  useRemoveRecipeFromCookbook,
} from "@/hooks/useCookbooks"

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
      <div className="flex min-h-screen items-center justify-center bg-[#FAF6EE]">
        <div className="text-eyebrow">Cargando…</div>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#FAF6EE]">
        <div className="text-eyebrow">Recetario no encontrado.</div>
      </div>
    )
  }

  return (
    <div className="bg-[#FAF6EE] min-h-screen pb-24 lg:mx-auto lg:max-w-[1100px] lg:px-8">
      <header className="px-5 pt-8 pb-6 lg:px-0">
        <Link
          href="/profile/cookbooks"
          className="inline-flex items-center gap-1 text-eyebrow text-[#7A7066] hover:text-[#C65D38]"
        >
          <ChevronLeft size={14} /> Recetarios
        </Link>

        {editing ? (
          <div className="mt-4 rounded-2xl border border-[#DDD6C5] bg-[#FFFEFA] p-4 space-y-3">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              className="w-full font-display text-2xl border-b border-[#DDD6C5] bg-transparent py-1.5 outline-none focus:border-[#1A1612]"
            />
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={280}
              placeholder="Descripción (opcional)"
              className="w-full border-b border-[#DDD6C5] bg-transparent py-1.5 text-[13px] outline-none focus:border-[#1A1612]"
            />
            <div className="flex flex-wrap gap-1.5">
              {EMOJI_SUGGESTIONS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => setEmoji(e)}
                  className={`h-9 w-9 rounded-full text-base transition-all ${
                    emoji === e ? 'bg-[#1A1612] text-[#FAF6EE]' : 'bg-[#F2EDE0]'
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
                className="flex-1 rounded-full border border-[#DDD6C5] py-2 text-[11px] uppercase tracking-[0.12em] text-[#7A7066]"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={patch.isPending || !name.trim()}
                className="flex-1 rounded-full bg-[#1A1612] py-2 text-[11px] uppercase tracking-[0.12em] text-[#FAF6EE] disabled:opacity-40"
              >
                Guardar
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex items-start gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-[#F2EDE0] text-3xl">
              {data.emoji ?? '📖'}
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="font-display text-[2rem] leading-[1.05] text-[#1A1612]">{data.name}</h1>
              {data.description && (
                <p className="mt-1 text-[12px] text-[#7A7066]">{data.description}</p>
              )}
              <div className="mt-2 text-[10px] uppercase tracking-[0.18em] text-[#A39A8E]">
                {data.recipeCount} {data.recipeCount === 1 ? 'receta' : 'recetas'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setEditing(true)}
              aria-label="Editar"
              className="shrink-0 rounded-full border border-[#DDD6C5] p-2 text-[#7A7066] hover:border-[#1A1612] hover:text-[#1A1612]"
            >
              <Pencil size={13} />
            </button>
          </div>
        )}
      </header>

      <section className="px-5 lg:px-0">
        {data.recipes.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#DDD6C5] py-10 text-center">
            <p className="font-italic italic text-[#7A7066]">Aún no hay recetas.</p>
            <p className="mt-1 text-[12px] text-[#A39A8E]">
              Añade desde el botón "Añadir a recetario" en cualquier receta.
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {data.recipes.map((r) => (
              <li key={r.id} className="relative">
                <Link
                  href={`/recipes/${r.id}`}
                  className="block overflow-hidden rounded-2xl bg-[#FFFEFA] border border-[#DDD6C5] transition-colors hover:border-[#1A1612]"
                >
                  <div className="relative aspect-square overflow-hidden bg-[#F2EDE0]">
                    {r.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.imageUrl} alt={r.name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center text-3xl text-[#C65D38]/30">∅</div>
                    )}
                  </div>
                  <div className="px-3 py-2.5">
                    <div className="text-[13px] leading-snug text-[#1A1612] line-clamp-2">{r.name}</div>
                  </div>
                </Link>
                <button
                  type="button"
                  onClick={() => removeRecipe.mutate({ cookbookId: data.id, recipeId: r.id })}
                  aria-label="Quitar del recetario"
                  className="absolute top-2 right-2 rounded-full bg-[#FAF6EE]/95 backdrop-blur-sm p-1.5 text-[#7A7066] hover:bg-[#C65D38] hover:text-[#FAF6EE] shadow-sm"
                >
                  <Trash2 size={11} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="px-5 mt-12 lg:px-0">
        <button
          type="button"
          onClick={handleDeleteCookbook}
          className="inline-flex items-center gap-2 rounded-full border border-[#C65D38]/40 px-4 py-2 text-[11px] uppercase tracking-[0.12em] text-[#C65D38] hover:bg-[#C65D38] hover:text-[#FAF6EE]"
        >
          <Trash2 size={11} /> Borrar recetario
        </button>
        <p className="mt-2 text-[11px] text-[#7A7066]">
          Solo se borra el recetario, las recetas siguen ahí.
        </p>
      </section>
    </div>
  )
}
