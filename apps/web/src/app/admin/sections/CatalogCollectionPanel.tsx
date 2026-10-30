"use client"

/**
 * CatalogCollectionPanel — «Colecciones» in Admin → Recetas pendientes
 * (PRO-374, specs/catalog-import.md → «Colecciones»). Upload or paste
 * Cocina's collection file: it is
 * checked here with the shared schema and the §6 words, then
 * `POST /admin/catalog-collections` resolves its recipes (only published
 * catalogue recipes) and saves it by slug — the same slug again replaces it.
 * Below, the collections there are, with a link to each page.
 */

import { useRef, useState, type ChangeEvent } from "react"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CATALOG_COLLECTION_PATH, checkCatalogCollection, type CatalogCollectionAdminView } from "@ona/shared"
import { ApiError, api } from "@/lib/api"

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

interface UploadResult {
  created: boolean
  slug: string
  title: string
  recipeCount: number
  published: boolean
}

export function CatalogCollectionPanel() {
  const qc = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)
  const [text, setText] = useState("")
  const [fileName, setFileName] = useState<string | null>(null)
  const [problems, setProblems] = useState<string[] | null>(null)
  const [done, setDone] = useState<UploadResult | null>(null)
  const [open, setOpen] = useState(false)

  const list = useQuery<CatalogCollectionAdminView[]>({
    queryKey: ["admin", "catalog-collections"],
    queryFn: async () => (await api.get<{ collections: CatalogCollectionAdminView[] }>("/admin/catalog-collections")).collections,
  })
  const upload = useMutation({
    mutationFn: (body: unknown) => api.post<UploadResult>("/admin/catalog-collections", body),
    onSuccess: (r) => {
      setDone(r)
      setText("")
      setFileName(null)
      if (fileInput.current) fileInput.current.value = ""
      qc.invalidateQueries({ queryKey: ["admin", "catalog-collections"] })
      qc.invalidateQueries({ queryKey: ["catalog-collections"] })
    },
    onError: (err) => {
      const fromApi = err instanceof ApiError ? (err.body?.problems as string[] | undefined) : undefined
      setProblems(fromApi?.length ? fromApi : [(err as Error).message])
    },
  })

  function changed() {
    setProblems(null)
    setDone(null)
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    changed()
    setText(await f.text())
    setFileName(f.name)
  }

  function subir() {
    changed()
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      setProblems(["No es un JSON válido."])
      return
    }
    const check = checkCatalogCollection(parsed)
    if (!check.ok) {
      setProblems(check.problems)
      return
    }
    upload.mutate(check.collection)
  }

  const collections = list.data ?? []

  return (
    <section aria-labelledby="catalog-collections-title" data-testid="catalog-collections" className="rounded-[20px] border border-border-soft bg-paper p-4 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 id="catalog-collections-title" className="text-eyebrow text-ink-muted">Colecciones</h2>
          <p className="mt-1 text-[13px] text-ink-mid">
            {collections.length > 0
              ? `${plural(collections.length, "colección", "colecciones")} en /recipes. `
              : ""}
            Solo con recetas publicadas, y nunca por salud.
          </p>
        </div>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="catalog-collection-form"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex min-h-[44px] shrink-0 items-center rounded-full border border-ink px-4 text-[13px] font-semibold text-ink hover:bg-ink hover:text-cream"
        >
          {open ? "Cerrar" : "Subir colección"}
        </button>
      </div>

      {open && (
        <div id="catalog-collection-form" className="mt-4 space-y-3">
          <p className="max-w-2xl text-[13px] leading-relaxed text-ink-mid">
            El JSON de Cocina: <span className="font-mono text-[12px]">slug</span>, título, subtítulo, temporada si la tiene y sus recetas
            (su id o su nombre exacto), en el orden en que salen. Si el slug ya existe, la colección se sustituye.
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <label className="inline-flex min-h-[44px] cursor-pointer items-center rounded-full border border-border bg-cream px-4 text-[13px] font-medium text-ink focus-within:border-ink hover:border-ink">
              Elegir fichero
              <input ref={fileInput} type="file" accept=".json,application/json" onChange={onFile} className="sr-only" />
            </label>
            <span className="min-w-0 break-all text-[12px] text-ink-muted">{fileName ?? "Ningún fichero elegido"}</span>
          </div>
          <label className="block text-[13px] font-medium text-ink">
            O pega el JSON
            <textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value)
                changed()
              }}
              rows={6}
              spellCheck={false}
              data-testid="catalog-collection-text"
              placeholder='{ "slug": "otono", "title": "Otoño en casa", "recipes": [ … ] }'
              className="mt-1.5 block w-full rounded-[14px] border border-border bg-paper px-3 py-2 font-mono text-[12px] leading-snug text-ink focus:border-ink focus:outline-none"
            />
          </label>
          <button
            type="button"
            onClick={subir}
            disabled={upload.isPending || !text.trim()}
            className="inline-flex min-h-[44px] items-center rounded-full bg-ink px-5 text-[13px] font-semibold text-cream hover:bg-terracotta-deep disabled:opacity-40"
          >
            {upload.isPending ? "Subiendo…" : "Subir colección"}
          </button>

          {problems && (
            <div role="alert" data-testid="catalog-collection-problems" className="rounded-[16px] bg-warn-bg p-4 text-[13px] text-warn-text">
              <p className="font-semibold">La colección aún no vale:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {done && (
        <p role="status" className="mt-4 text-[13px] text-ink">
          {done.created ? "Colección subida" : "Colección sustituida"}: «{done.title}», {plural(done.recipeCount, "receta", "recetas")}
          {done.published ? "." : " (sin publicar)."}{" "}
          <Link href={`${CATALOG_COLLECTION_PATH}/${done.slug}`} className="underline underline-offset-4">
            Verla
          </Link>
        </p>
      )}

      {collections.length > 0 && (
        <ul className="mt-4 divide-y divide-border-soft text-[13px]">
          {collections.map((c) => (
            <li key={c.slug} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2">
              <Link href={`${CATALOG_COLLECTION_PATH}/${c.slug}`} className="font-medium text-ink underline-offset-4 hover:underline">
                {c.title}
              </Link>
              <span className="text-ink-muted">
                {plural(c.recipeCount, "receta", "recetas")}
                {c.published ? "" : " · sin publicar"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
