"use client"

/**
 * «Salud y objetivo» of the reader, inside their own row of «Quién come»
 * (PRO-1203; until then «Datos físicos» and «Prioridad nutricional» on
 * /profile). RGPD art. 9 (PRO-21): body data and the goal only with the
 * health-data consent, which is also withdrawn here (that deletes the
 * allergies, restrictions and body data). Saves itself: no «Guardar
 * cambios» at the bottom of the profile any more.
 */
import { useEffect, useMemo, useState } from "react"
import type { HealthConsentState } from "@ona/shared"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { HealthConsentCheckbox } from "@/components/HealthConsentCheckbox"
import { FieldLabel, RequiredNote } from "@/components/FieldLabel"
import { PILL_INK, SUB_CARD, SUB_EYEBROW } from "@/components/profile/SubPage"

interface PhysicalData {
  sex: "male" | "female" | ""
  age: number | ""
  weight: number | ""
  height: number | ""
  activity_level: "sedentary" | "light" | "moderate" | "active" | "very_active"
}

type Priority = "balanced" | "muscle" | "weight_loss" | "energy"

const ACTIVITY_LABELS: Record<PhysicalData["activity_level"], string> = {
  sedentary: "Sedentario",
  light: "Ligero",
  moderate: "Moderado",
  active: "Activo",
  very_active: "Muy activo",
}

const PRIORITY_LABELS: Record<Priority, string> = {
  balanced: "Equilibrado",
  muscle: "Ganar músculo",
  weight_loss: "Perder peso",
  energy: "Más energía",
}

// The account keeps the generator's words (users.activityLevel / users.priority).
const ACTIVITY_MAP: Record<string, "none" | "light" | "moderate" | "high"> = {
  sedentary: "none",
  light: "light",
  moderate: "moderate",
  active: "moderate",
  very_active: "high",
}
const PRIORITY_MAP: Record<Priority, "quick" | "varied" | "healthy" | "cheap"> = {
  balanced: "varied",
  muscle: "healthy",
  weight_loss: "healthy",
  energy: "quick",
}

const ACTIVITY_MULTIPLIERS: Record<string, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
}

const EMPTY: PhysicalData = { sex: "", age: "", weight: "", height: "", activity_level: "moderate" }

function calculateBMR(sex: string, weight: number, height: number, age: number): number {
  if (sex === "male") return 10 * weight + 6.25 * height - 5 * age + 5
  return 10 * weight + 6.25 * height - 5 * age - 161
}

const INPUT =
  "min-h-[44px] w-full border-0 border-b border-border bg-transparent py-2 text-[15px] text-ink outline-none placeholder:text-ink-light focus:border-ink"

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-[40px] rounded-full border px-4 text-[13px] font-medium transition-colors active:scale-95 ${
        active ? "border-ink bg-ink text-cream" : "border-border bg-paper text-ink-mid hover:border-ink"
      }`}
    >
      {children}
    </button>
  )
}

export function HealthAndGoalCard({ onConsentChange }: { onConsentChange?: (active: boolean) => void }) {
  const { user } = useAuth()
  const [consent, setConsent] = useState<HealthConsentState | null>(null)
  const [busy, setBusy] = useState(false)
  const [physical, setPhysical] = useState<PhysicalData>(EMPTY)
  const [priority, setPriority] = useState<Priority>("balanced")
  /** The settings blob as it is, so saving here never drops what else it keeps. */
  const [blob, setBlob] = useState<Record<string, unknown>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const active = consent?.active === true

  useEffect(() => {
    if (!user) return
    api.get<HealthConsentState>(`/user/${user.id}/health-consent`).then(setConsent).catch(() => {})
    api
      .get<any>(`/user/${user.id}/settings`)
      .then((data) => {
        const t = data?.template && !Array.isArray(data.template) ? data.template : data
        if (!t || typeof t !== "object") return
        setBlob(t)
        if (t.physical) setPhysical({ ...EMPTY, ...t.physical })
        if (t.preferences?.priority && t.preferences.priority in PRIORITY_LABELS) setPriority(t.preferences.priority)
      })
      .catch(() => {})
  }, [user])

  const bmr = useMemo(() => {
    if (!physical.sex || !physical.weight || !physical.height || !physical.age) return null
    return Math.round(calculateBMR(physical.sex, Number(physical.weight), Number(physical.height), Number(physical.age)))
  }, [physical])
  const tdee = bmr ? Math.round(bmr * (ACTIVITY_MULTIPLIERS[physical.activity_level] ?? 1.55)) : null

  async function changeConsent(next: boolean) {
    if (!user || busy) return
    if (!next && !window.confirm("Si retiras el consentimiento, borramos tus alergias, restricciones y datos físicos. ¿Seguro?")) return
    setBusy(true)
    try {
      const state = await api.post<HealthConsentState>(`/user/${user.id}/health-consent`, { consent: next })
      setConsent(state)
      if (!next) setPhysical(EMPTY)
      onConsentChange?.(state.active === true)
    } catch (e) {
      console.error(e)
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (!user || !active) return
    setSaving(true)
    setSaved(false)
    const payload: Record<string, unknown> = { priority: PRIORITY_MAP[priority] }
    if (physical.sex) payload.sex = physical.sex
    if (physical.age !== "") payload.age = Number(physical.age)
    if (physical.weight !== "") payload.weight = Number(physical.weight)
    if (physical.height !== "") payload.height = Number(physical.height)
    payload.activityLevel = ACTIVITY_MAP[physical.activity_level] ?? "moderate"
    try {
      const prefs = (blob.preferences && typeof blob.preferences === "object" ? blob.preferences : {}) as Record<string, unknown>
      const template = { ...blob, physical, preferences: { ...prefs, priority } }
      await Promise.all([
        api.put(`/user/${user.id}`, payload),
        api.put(`/user/${user.id}/settings`, { template }),
      ])
      setBlob(template)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      console.error(e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section id="datos-fisicos" className={`${SUB_CARD} scroll-mt-4 p-4 lg:p-5`} data-testid="health-and-goal">
      <h2 className="font-serif-text text-[18px] font-[650] text-ink">Salud y objetivo</h2>
      <p className="mt-0.5 text-[13px] text-ink-muted">
        {!active ? "Sin tu permiso no se guardan" : tdee ? `Gasto diario estimado: ${tdee} kcal` : "Completa sexo, edad, peso y altura"}
      </p>
      <div className="mt-4" data-testid="health-consent">
        <HealthConsentCheckbox checked={active} disabled={busy || consent === null} onChange={changeConsent} />
      </div>
      {active && (
        <div className="mt-5 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <FieldLabel as="div" optional className={SUB_EYEBROW}>Sexo</FieldLabel>
              <div className="mt-2 flex gap-1.5">
                <Pill active={physical.sex === "male"} onClick={() => setPhysical((p) => ({ ...p, sex: "male" }))}>
                  Masculino
                </Pill>
                <Pill active={physical.sex === "female"} onClick={() => setPhysical((p) => ({ ...p, sex: "female" }))}>
                  Femenino
                </Pill>
              </div>
            </div>
            <label>
              <FieldLabel as="span" optional className={SUB_EYEBROW}>Edad</FieldLabel>
              <input
                type="number"
                min={1}
                max={120}
                value={physical.age}
                onChange={(e) => setPhysical((p) => ({ ...p, age: e.target.value ? Number(e.target.value) : "" }))}
                placeholder="—"
                className={INPUT}
              />
            </label>
            <label>
              <FieldLabel as="span" optional className={SUB_EYEBROW}>Peso · kg</FieldLabel>
              <input
                type="number"
                min={20}
                max={300}
                step={0.1}
                value={physical.weight}
                onChange={(e) => setPhysical((p) => ({ ...p, weight: e.target.value ? Number(e.target.value) : "" }))}
                placeholder="—"
                className={INPUT}
              />
            </label>
            <label>
              <FieldLabel as="span" optional className={SUB_EYEBROW}>Altura · cm</FieldLabel>
              <input
                type="number"
                min={100}
                max={250}
                value={physical.height}
                onChange={(e) => setPhysical((p) => ({ ...p, height: e.target.value ? Number(e.target.value) : "" }))}
                placeholder="—"
                className={INPUT}
              />
            </label>
          </div>
          <div>
            <FieldLabel as="div" optional className={SUB_EYEBROW}>Nivel de actividad</FieldLabel>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {Object.entries(ACTIVITY_LABELS).map(([value, label]) => (
                <Pill
                  key={value}
                  active={physical.activity_level === value}
                  onClick={() => setPhysical((p) => ({ ...p, activity_level: value as PhysicalData["activity_level"] }))}
                >
                  {label}
                </Pill>
              ))}
            </div>
          </div>
          <div>
            <FieldLabel as="div" required className={SUB_EYEBROW}>Tu objetivo</FieldLabel>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(Object.keys(PRIORITY_LABELS) as Priority[]).map((value) => (
                <Pill key={value} active={priority === value} onClick={() => setPriority(value)}>
                  {PRIORITY_LABELS[value]}
                </Pill>
              ))}
            </div>
          </div>
          {bmr && tdee && (
            <div className="grid grid-cols-2 gap-3 border-t border-border-soft pt-4">
              <div>
                <div className={SUB_EYEBROW}>Metabolismo basal</div>
                <div className="mt-1 font-serif-text text-[24px] font-[650] text-ink">
                  {bmr}
                  <span className="ml-1 text-[13px] font-normal text-ink-muted">kcal</span>
                </div>
              </div>
              <div>
                <div className={SUB_EYEBROW}>Gasto diario</div>
                <div className="mt-1 font-serif-text text-[24px] font-[650] text-terracotta-deep">
                  {tdee}
                  <span className="ml-1 text-[13px] font-normal text-ink-muted">kcal</span>
                </div>
              </div>
            </div>
          )}
          <div className="flex items-center gap-4">
            <button type="button" onClick={() => void save()} disabled={saving} className={PILL_INK}>
              {saving ? "Guardando…" : saved ? "✓ Guardado" : "Guardar"}
            </button>
            <RequiredNote />
          </div>
        </div>
      )}
    </section>
  )
}
