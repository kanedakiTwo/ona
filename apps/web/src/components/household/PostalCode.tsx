"use client"

/**
 * PRO-1124 (D-179): the household's postal code (specs/household.md).
 *
 *   - `PostalCodeQuestion`: once per household, under «Preparar los pedidos»
 *     in /compra when the API says it's its turn (`askPostalCode`). Legal's
 *     words (LEG-506), with «Ahora no» as visible as «Guardar».
 *   - `PostalCodeSection`: Perfil → Tu casa, to change or delete it.
 *
 * Only the code, never the street.
 */
import { useEffect, useState } from "react"
import { POSTAL_CODE_INVALID, POSTAL_CODE_QUESTION, POSTAL_CODE_WHY, normalizePostalCode } from "@ona/shared"
import { api } from "@/lib/api"
import { PILL_INK, PILL_OUTLINE, SUB_CARD, SUB_EYEBROW, SUB_INPUT } from "@/components/profile/SubPage"

interface HouseholdPostalCode {
  postalCode: string | null
  asked: boolean
}

const save = (postalCode: string | null) => api.put<HouseholdPostalCode>("/households/me/postal-code", { postalCode })

function PostalCodeInput({ value, onChange, id }: { value: string; onChange: (v: string) => void; id: string }) {
  return (
    <input
      id={id}
      inputMode="numeric"
      autoComplete="postal-code"
      maxLength={6}
      placeholder="28012"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={SUB_INPUT}
    />
  )
}

export function PostalCodeQuestion() {
  const [value, setValue] = useState("")
  const [state, setState] = useState<"ask" | "saved" | "skipped">("ask")
  const [saved, setSaved] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (state === "skipped") return null
  if (state === "saved") {
    return (
      <p data-testid="postal-code-saved" className="rounded-xl bg-[#F7F2E7] px-3 py-2 text-[12px] text-[#7A7066]">
        Guardado: {saved}. Lo puedes cambiar o borrar en Perfil → Tu casa.
      </p>
    )
  }

  async function onSave() {
    const code = normalizePostalCode(value)
    if (!code) return setError(POSTAL_CODE_INVALID)
    setBusy(true)
    setError(null)
    try {
      const r = await save(code)
      setSaved(r.postalCode)
      setState("saved")
    } catch (e: any) {
      setError(e?.message ?? "No se ha podido guardar")
    } finally {
      setBusy(false)
    }
  }

  async function onSkip() {
    setState("skipped")
    // The API already marked it as asked when it offered it; this makes the skip explicit.
    await api.post("/households/me/postal-code/skip").catch(() => undefined)
  }

  return (
    <div data-testid="postal-code-question" className={`${SUB_CARD} p-4`}>
      <label htmlFor="postal-code-question-input" className="block text-[15px] font-medium text-ink">
        {POSTAL_CODE_QUESTION}
      </label>
      <p className="mb-3 mt-1 text-[13px] leading-snug text-ink-muted">{POSTAL_CODE_WHY}</p>
      <PostalCodeInput id="postal-code-question-input" value={value} onChange={setValue} />
      {error && (
        <p role="alert" className="mt-2 text-[12px] text-[#C65D38]">
          {error}
        </p>
      )}
      {/* LEG-506: «Ahora no» as visible as «Guardar»: same pill, same size. */}
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={() => void onSkip()} disabled={busy} className={`${PILL_OUTLINE} flex-1`}>
          Ahora no
        </button>
        <button type="button" onClick={() => void onSave()} disabled={busy} className={`${PILL_OUTLINE} flex-1`}>
          Guardar
        </button>
      </div>
    </div>
  )
}

export function PostalCodeSection({ canEdit }: { canEdit: boolean }) {
  const [current, setCurrent] = useState<string | null | undefined>(undefined)
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api
      .get<HouseholdPostalCode>("/households/me/postal-code")
      .then((r) => setCurrent(r.postalCode))
      .catch(() => setCurrent(null))
  }, [])

  if (current === undefined) return null

  async function run(next: string | null) {
    setBusy(true)
    setError(null)
    try {
      const r = await save(next)
      setCurrent(r.postalCode)
      setEditing(false)
    } catch (e: any) {
      setError(e?.message ?? "No se ha podido guardar")
    } finally {
      setBusy(false)
    }
  }

  return (
    <section data-testid="postal-code-section" className="mt-8">
      <h2 className={`${SUB_EYEBROW} mb-1`}>Código postal</h2>
      <p className="mb-3 text-[13px] leading-snug text-ink-muted">Lo usamos para buscarte tiendas de barrio cerca. Solo el código, nunca tu calle.</p>
      {editing ? (
        <div className={`${SUB_CARD} p-4`}>
          <PostalCodeInput id="postal-code-input" value={value} onChange={setValue} />
          {error && (
            <p role="alert" className="mt-2 text-[12px] text-[#C65D38]">
              {error}
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => setEditing(false)} className={`${PILL_OUTLINE} flex-1`}>
              Cancelar
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const code = normalizePostalCode(value)
                if (!code) return setError(POSTAL_CODE_INVALID)
                void run(code)
              }}
              className={`${PILL_INK} flex-1`}
            >
              Guardar
            </button>
          </div>
        </div>
      ) : (
        <div className={`${SUB_CARD} flex min-h-[64px] items-center gap-3 py-2 pl-4 pr-2`}>
          <span data-testid="postal-code-current" className="flex-1 text-[15px] text-ink">
            {current ?? <span className="text-ink-muted">Sin poner</span>}
          </span>
          {canEdit && (
            <>
              {current && (
                <button type="button" disabled={busy} onClick={() => void run(null)} className={PILL_OUTLINE}>
                  Borrar
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setValue(current ?? "")
                  setError(null)
                  setEditing(true)
                }}
                className={PILL_OUTLINE}
              >
                {current ? "Cambiar" : "Poner"}
              </button>
            </>
          )}
        </div>
      )}
    </section>
  )
}
