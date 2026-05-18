"use client"

/**
 * Inline button + bottom-sheet picker that lets the user add the current
 * recipe to any of the household's cookbooks (PR 8A). Tap a cookbook to
 * toggle; tap "Nuevo recetario" to create one inline.
 *
 * Lives on the recipe detail page next to the favorite / share buttons.
 */
import { useState } from "react"
import { BookmarkPlus, Check, Plus, X } from "lucide-react"
import {
  useAddRecipeToCookbook,
  useCookbooks,
  useCookbooksForRecipe,
  useCreateCookbook,
  useRemoveRecipeFromCookbook,
} from "@/hooks/useCookbooks"

const EMOJI_SUGGESTIONS = ['📖', '⭐', '🥗', '🍝', '🍰', '🥩', '🌮', '🍲', '☕']

export function AddToCookbookButton({ recipeId }: { recipeId: string }) {
  const [open, setOpen] = useState(false)
  const { data: hits } = useCookbooksForRecipe(recipeId)
  const inCount = hits?.length ?? 0

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-full border border-[#DDD6C5] bg-[#FFFEFA] px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] text-[#7A7066] transition-all hover:border-[#1A1612] hover:text-[#1A1612]"
      >
        <BookmarkPlus size={12} />
        {inCount > 0 ? `En ${inCount} ${inCount === 1 ? 'recetario' : 'recetarios'}` : 'Añadir a recetario'}
      </button>

      {open && <CookbookPickerSheet recipeId={recipeId} onClose={() => setOpen(false)} />}
    </>
  )
}

function CookbookPickerSheet({ recipeId, onClose }: { recipeId: string; onClose: () => void }) {
  const { data: books, isLoading } = useCookbooks()
  const { data: hits } = useCookbooksForRecipe(recipeId)
  const inIds = new Set((hits ?? []).map((h) => h.cookbookId))
  const add = useAddRecipeToCookbook()
  const remove = useRemoveRecipeFromCookbook()
  const create = useCreateCookbook()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState("")
  const [emoji, setEmoji] = useState<string>('📖')

  function toggle(cookbookId: string) {
    if (inIds.has(cookbookId)) {
      remove.mutate({ cookbookId, recipeId })
    } else {
      add.mutate({ cookbookId, recipeId })
    }
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    create.mutate(
      { name: trimmed, emoji },
      {
        onSuccess: (book) => {
          add.mutate({ cookbookId: book.id, recipeId })
          setCreating(false)
          setName("")
        },
      },
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#1A1612]/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-[430px] rounded-t-3xl bg-[#FAF6EE] p-5 pb-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="text-eyebrow">Añadir a recetario</div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-full p-1 hover:bg-[#F2EDE0]">
            <X size={16} />
          </button>
        </div>

        {isLoading ? (
          <div className="py-6 text-center font-italic italic text-[#7A7066]">Cargando…</div>
        ) : !books || books.length === 0 ? (
          <p className="font-italic italic text-[#7A7066] text-center py-4">
            Aún no tienes recetarios. Crea el primero abajo.
          </p>
        ) : (
          <ul className="space-y-1.5 max-h-[40vh] overflow-y-auto">
            {books.map((cb) => {
              const isIn = inIds.has(cb.id)
              return (
                <li key={cb.id}>
                  <button
                    type="button"
                    onClick={() => toggle(cb.id)}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 transition-colors ${
                      isIn ? 'bg-[#1A1612] text-[#FAF6EE]' : 'bg-[#FFFEFA] border border-[#DDD6C5] hover:border-[#1A1612]'
                    }`}
                  >
                    <span className="text-xl">{cb.emoji ?? '📖'}</span>
                    <span className="flex-1 text-left text-[14px]">{cb.name}</span>
                    {isIn ? (
                      <Check size={16} />
                    ) : (
                      <span className="text-[10px] uppercase tracking-[0.12em] text-[#7A7066]">
                        {cb.recipeCount}
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        <div className="mt-4 pt-4 border-t border-[#DDD6C5]">
          {creating ? (
            <form onSubmit={handleCreate} className="space-y-3">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nombre del recetario"
                autoFocus
                maxLength={60}
                className="w-full border-b border-[#DDD6C5] bg-transparent py-1.5 text-[14px] outline-none focus:border-[#1A1612]"
              />
              <div className="flex flex-wrap gap-1.5">
                {EMOJI_SUGGESTIONS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => setEmoji(e)}
                    className={`h-8 w-8 rounded-full text-base ${
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
                  onClick={() => { setCreating(false); setName("") }}
                  className="flex-1 rounded-full border border-[#DDD6C5] py-2 text-[11px] uppercase tracking-[0.12em] text-[#7A7066]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!name.trim() || create.isPending}
                  className="flex-1 rounded-full bg-[#1A1612] py-2 text-[11px] uppercase tracking-[0.12em] text-[#FAF6EE] disabled:opacity-40"
                >
                  Crear y añadir
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="inline-flex items-center gap-2 rounded-full border border-dashed border-[#DDD6C5] px-4 py-2 text-[12px] uppercase tracking-[0.12em] text-[#7A7066] hover:border-[#1A1612] hover:text-[#1A1612]"
            >
              <Plus size={12} /> Nuevo recetario
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
