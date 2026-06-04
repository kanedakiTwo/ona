"use client"

/**
 * /profile/cookbooks — list household cookbooks (PR 8A).
 *
 * Tap a cookbook to drill into its recipe list. Add a new one inline.
 */
import { useState } from "react"
import Link from "next/link"
import { ChevronLeft, Plus, BookOpen } from "lucide-react"
import { useCookbooks, useCreateCookbook } from "@/hooks/useCookbooks"

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
    <div className="bg-[#FAF6EE] min-h-screen pb-24 lg:mx-auto lg:max-w-[900px]">
      <header className="px-5 pt-8 pb-6">
        <Link
          href="/profile"
          className="inline-flex items-center gap-1 text-eyebrow text-[#7A7066] hover:text-[#C65D38]"
        >
          <ChevronLeft size={14} /> Volver al perfil
        </Link>
        <div className="mt-3 text-eyebrow">Recetarios</div>
        <h1 className="mt-1 font-display text-[2.2rem] leading-[0.95] text-[#1A1612]">
          Tus <span className="italic text-[#C65D38]">recetarios</span>.
        </h1>
        <p className="mt-3 text-[12px] text-[#7A7066] max-w-md">
          Agrupa recetas como te dé la gana: "Favoritos de Sara", "Para
          diabéticos", "Lo que cocino los lunes". Cualquier persona del hogar
          puede crear y editar.
        </p>
      </header>

      <section className="px-5">
        {open ? (
          <form
            onSubmit={handleCreate}
            className="rounded-2xl border border-[#DDD6C5] bg-[#FFFEFA] p-4 space-y-3"
          >
            <div className="text-eyebrow text-[#7A7066]">Nuevo recetario</div>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Favoritos de Sara"
              autoFocus
              maxLength={60}
              className="w-full border-b border-[#DDD6C5] bg-transparent py-1.5 text-[14px] outline-none focus:border-[#1A1612]"
            />
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descripción (opcional)"
              maxLength={280}
              className="w-full border-b border-[#DDD6C5] bg-transparent py-1.5 text-[13px] outline-none focus:border-[#1A1612]"
            />
            <div className="flex flex-wrap gap-1.5">
              {EMOJI_SUGGESTIONS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => setEmoji(e)}
                  className={`h-9 w-9 rounded-full text-base transition-all ${
                    emoji === e ? 'bg-[#1A1612] text-[#FAF6EE]' : 'bg-[#F2EDE0] hover:bg-[#DDD6C5]'
                  }`}
                >
                  {e}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex-1 rounded-full border border-[#DDD6C5] py-2 text-[11px] uppercase tracking-[0.12em] text-[#7A7066]"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={!name.trim() || create.isPending}
                className="flex-1 rounded-full bg-[#1A1612] py-2 text-[11px] uppercase tracking-[0.12em] text-[#FAF6EE] disabled:opacity-40"
              >
                {create.isPending ? "Creando…" : "Crear"}
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-2 rounded-full bg-[#1A1612] px-5 py-2.5 text-[12px] uppercase tracking-[0.12em] text-[#FAF6EE] hover:bg-[#2D6A4F]"
          >
            <Plus size={12} /> Nuevo recetario
          </button>
        )}
      </section>

      <section className="px-5 mt-8">
        <div className="text-eyebrow mb-3">Lista · {books?.length ?? 0}</div>
        {isLoading ? (
          <div className="py-10 text-center font-italic italic text-[#7A7066]">Cargando…</div>
        ) : !books || books.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#DDD6C5] py-10 text-center">
            <p className="font-italic italic text-[#7A7066]">Sin recetarios todavía.</p>
            <p className="mt-1 text-[12px] text-[#A39A8E]">Crea uno para empezar a agrupar.</p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-3">
            {books.map((cb) => (
              <li key={cb.id}>
                <Link
                  href={`/cookbooks/${cb.id}`}
                  className="flex items-center gap-3 rounded-2xl border border-[#DDD6C5] bg-[#FFFEFA] p-4 transition-colors hover:border-[#1A1612]"
                >
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#F2EDE0] text-2xl">
                    {cb.emoji ?? <BookOpen size={20} className="text-[#7A7066]" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-display text-[18px] leading-tight text-[#1A1612]">
                      {cb.name}
                    </div>
                    {cb.description && (
                      <div className="text-[12px] text-[#7A7066] truncate mt-0.5">
                        {cb.description}
                      </div>
                    )}
                    <div className="text-[10px] uppercase tracking-[0.18em] text-[#A39A8E] mt-1">
                      {cb.recipeCount} {cb.recipeCount === 1 ? 'receta' : 'recetas'}
                    </div>
                  </div>
                  <div className="text-[#7A7066] text-lg">›</div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
