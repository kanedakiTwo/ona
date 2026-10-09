"use client"

/**
 * /profile/cookbooks — list household cookbooks (PR 8A).
 *
 * Tap a cookbook to drill into its recipe list. Add a new one inline.
 *
 * Skin: "D · Luz y foto" (PRO-40): paper rows with an emoji tile on bone,
 * Fraunces 650 names, ink pill "Nuevo recetario"; 2 columns at md, 3 at lg+.
 */
import { useState } from "react"
import Link from "next/link"
import { BookOpen, ChevronRight, Plus } from "lucide-react"
import { useCookbooks, useCreateCookbook } from "@/hooks/useCookbooks"
import {
  Accent,
  PILL_INK,
  PILL_OUTLINE,
  SUB_CARD,
  SUB_EYEBROW,
  SUB_INPUT,
  SubNotice,
  SubPage,
} from "@/components/profile/SubPage"

const EMOJI_SUGGESTIONS = ['📖', '⭐', '🥗', '🍝', '🍰', '🥩', '🌮', '🍲', '☕']

export default function CookbooksPage() {
  const { data: books, isLoading } = useCookbooks()
  const create = useCreateCookbook()

  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [emoji, setEmoji] = useState<string>('📖')
  const [description, setDescription] = useState("")

  function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    create.mutate(
      { name: trimmed, emoji, description: description.trim() || null },
      {
        onSuccess: () => {
          setName("")
          setDescription("")
          setOpen(false)
        },
      },
    )
  }

  return (
    <SubPage
      eyebrow="Recetarios"
      title={
        <>
          Tus <Accent>recetarios</Accent>.
        </>
      }
      intro={'Agrupa recetas como te dé la gana: "Favoritos de Sara", "Para diabéticos", "Lo que cocino los lunes". Cualquier persona del hogar puede crear y editar.'}
    >
      <section>
        {open ? (
          <form onSubmit={handleCreate} className={`${SUB_CARD} space-y-3 p-4 lg:max-w-[560px]`}>
            <h2 className={SUB_EYEBROW}>Nuevo recetario</h2>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Favoritos de Sara"
              autoFocus
              maxLength={60}
              aria-label="Nombre del recetario"
              className={SUB_INPUT}
            />
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descripción (opcional)"
              maxLength={280}
              aria-label="Descripción (opcional)"
              className={SUB_INPUT}
            />
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Emoji">
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
              <button type="button" onClick={() => setOpen(false)} className={`${PILL_OUTLINE} flex-1`}>
                Cancelar
              </button>
              <button type="submit" disabled={!name.trim() || create.isPending} className={`${PILL_INK} flex-1`}>
                {create.isPending ? "Creando…" : "Crear"}
              </button>
            </div>
          </form>
        ) : (
          <button type="button" onClick={() => setOpen(true)} className={PILL_INK}>
            <Plus size={16} /> Nuevo recetario
          </button>
        )}
      </section>

      <section className="mt-8">
        <h2 className={`${SUB_EYEBROW} mb-3`}>Lista · {books?.length ?? 0}</h2>
        {isLoading ? (
          <SubNotice>
            <p className="font-serif-text text-[18px] italic text-ink-mid">Cargando…</p>
          </SubNotice>
        ) : !books || books.length === 0 ? (
          <SubNotice dashed>
            <p className="font-serif-text text-[18px] italic text-ink-mid">Sin recetarios todavía.</p>
            <p className="mt-1 text-[14px] text-ink-soft">Crea uno para empezar a agrupar.</p>
          </SubNotice>
        ) : (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 lg:gap-4">
            {books.map((cb) => (
              <li key={cb.id}>
                <Link
                  href={`/cookbooks/${cb.id}`}
                  className={`${SUB_CARD} flex h-full min-h-[76px] items-center gap-3.5 p-3.5 transition-colors hover:border-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink`}
                >
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-bone text-2xl">
                    {cb.emoji ?? <BookOpen size={22} className="text-ink-muted" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-serif-text text-[18px] font-[650] leading-tight text-ink">{cb.name}</div>
                    {cb.description && (
                      <div className="mt-0.5 truncate text-[13px] text-ink-soft">{cb.description}</div>
                    )}
                    <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
                      {cb.recipeCount} {cb.recipeCount === 1 ? 'receta' : 'recetas'}
                    </div>
                  </div>
                  <ChevronRight size={18} className="shrink-0 text-ink-muted" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </SubPage>
  )
}
