'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { LogOut, X, Plus, Check, Mic } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'
import { useVoiceMode } from '@/components/voice/VoiceProvider'

interface PhysicalData {
  sex: 'male' | 'female' | ''
  age: number | ''
  weight: number | ''
  height: number | ''
  activity_level: 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active'
}

interface Preferences {
  restrictions: string[]
  priority: 'balanced' | 'muscle' | 'weight_loss' | 'energy'
}

interface MealTemplate {
  [day: string]: string[]
}

const DAYS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'] as const
const DAYS_SHORT = ['L', 'M', 'X', 'J', 'V', 'S', 'D']
const MEALS = ['desayuno', 'almuerzo', 'merienda', 'cena'] as const

const ACTIVITY_LABELS: Record<string, string> = {
  sedentary: 'Sedentario',
  light: 'Ligero',
  moderate: 'Moderado',
  active: 'Activo',
  very_active: 'Muy activo',
}

const PRIORITY_LABELS: Record<string, string> = {
  balanced: 'Equilibrado',
  muscle: 'Ganar musculo',
  weight_loss: 'Perder peso',
  energy: 'Mas energia',
}

const COMMON_RESTRICTIONS = [
  'sin gluten', 'sin lactosa', 'vegetariano', 'vegano',
  'frutos secos', 'mariscos', 'huevo', 'soja',
]

function calculateBMR(sex: string, weight: number, height: number, age: number): number {
  if (sex === 'male') return 10 * weight + 6.25 * height - 5 * age + 5
  return 10 * weight + 6.25 * height - 5 * age - 161
}

const ACTIVITY_MULTIPLIERS: Record<string, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
}

export default function ProfilePage() {
  const { user, logout, isLoading: authLoading } = useAuth()
  const voiceMode = useVoiceMode()

  const [physical, setPhysical] = useState<PhysicalData>({
    sex: '', age: '', weight: '', height: '', activity_level: 'moderate',
  })
  const [preferences, setPreferences] = useState<Preferences>({
    restrictions: [], priority: 'balanced',
  })
  const [mealTemplate, setMealTemplate] = useState<MealTemplate>(() => {
    const t: MealTemplate = {}
    for (const d of DAYS) t[d] = ['desayuno', 'almuerzo', 'cena']
    return t
  })
  const [restrictionInput, setRestrictionInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!user) return
    api.get<any>(`/user/${user.id}/settings`).then((data) => {
      if (data?.physical) setPhysical(data.physical)
      if (data?.preferences) setPreferences(data.preferences)
      if (data?.meal_template) setMealTemplate(data.meal_template)
    }).catch(() => {})
  }, [user])

  const bmr = useMemo(() => {
    if (!physical.sex || !physical.weight || !physical.height || !physical.age) return null
    return Math.round(calculateBMR(physical.sex, Number(physical.weight), Number(physical.height), Number(physical.age)))
  }, [physical])

  const tdee = useMemo(() => {
    if (!bmr) return null
    return Math.round(bmr * (ACTIVITY_MULTIPLIERS[physical.activity_level] ?? 1.55))
  }, [bmr, physical.activity_level])

  function addRestriction(value: string) {
    const t = value.trim().toLowerCase()
    if (t && !preferences.restrictions.includes(t)) {
      setPreferences((p) => ({ ...p, restrictions: [...p.restrictions, t] }))
    }
    setRestrictionInput('')
  }

  function removeRestriction(value: string) {
    setPreferences((p) => ({ ...p, restrictions: p.restrictions.filter((r) => r !== value) }))
  }

  function toggleMeal(day: string, meal: string) {
    setMealTemplate((prev) => {
      const cur = prev[day] ?? []
      const next = cur.includes(meal) ? cur.filter((m) => m !== meal) : [...cur, meal]
      return { ...prev, [day]: next }
    })
  }

  const handleSave = useCallback(async () => {
    if (!user) return
    setSaving(true); setSaved(false)
    try {
      await Promise.all([
        api.put(`/user/${user.id}`, {
          sex: physical.sex || undefined,
          age: physical.age || undefined,
          weight: physical.weight || undefined,
          height: physical.height || undefined,
          activity_level: physical.activity_level,
        }),
        api.put(`/user/${user.id}/settings`, { physical, preferences, meal_template: mealTemplate }),
      ])
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) { console.error(e) }
    finally { setSaving(false) }
  }, [user, physical, preferences, mealTemplate])

  if (authLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#FAF6EE]">
        <div className="text-eyebrow">Cargando...</div>
      </div>
    )
  }

  const initials = user.username?.charAt(0).toUpperCase() || "U"

  return (
    <div className="bg-[#FAF6EE] min-h-screen pb-12">
      {/* Editorial header */}
      <header className="px-5 pt-8 pb-6">
        <div className="text-eyebrow mb-2">Tu perfil</div>
        <div className="flex items-end justify-between gap-4">
          <h1 className="font-display text-[2.4rem] leading-[0.95] text-[#1A1612]">
            <span className="font-italic italic text-[#C65D38]">Tu</span><br />sello.
          </h1>
          <button
            onClick={logout}
            className="flex items-center gap-1.5 rounded-full border border-[#DDD6C5] bg-[#FFFEFA] px-3 py-1.5 text-[10px] uppercase tracking-[0.15em] text-[#7A7066] hover:border-[#C65D38] hover:text-[#C65D38]"
          >
            <LogOut size={12} />
            Salir
          </button>
        </div>
      </header>

      {/* Identity card */}
      <div className="px-5">
        <div className="rounded-2xl bg-[#1A1612] p-5 text-[#FAF6EE]">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#C65D38] font-display text-2xl text-[#FAF6EE]">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-display text-xl truncate">{user.username}</div>
              <div className="text-[11px] text-[#FAF6EE]/60 truncate">{user.email}</div>
            </div>
          </div>
          {bmr && tdee && (
            <div className="mt-5 grid grid-cols-2 gap-4 border-t border-[#FAF6EE]/15 pt-4">
              <div>
                <div className="text-[9px] uppercase tracking-[0.2em] text-[#FAF6EE]/50">Metabolismo basal</div>
                <div className="mt-1 font-display text-2xl">{bmr}<span className="text-sm text-[#FAF6EE]/50 ml-1">kcal</span></div>
              </div>
              <div>
                <div className="text-[9px] uppercase tracking-[0.2em] text-[#FAF6EE]/50">Gasto diario</div>
                <div className="mt-1 font-display text-2xl text-[#52B788]">{tdee}<span className="text-sm text-[#52B788]/60 ml-1">kcal</span></div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Capitulo 01 — Datos fisicos */}
      <section className="px-5 mt-10">
        <ChapterHeader number="01" title="Datos" italic="fisicos" />
        <div className="mt-6 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Sexo">
              <div className="flex gap-1.5 pt-1">
                <SexPill
                  active={physical.sex === 'male'}
                  onClick={() => setPhysical((p) => ({ ...p, sex: 'male' }))}
                >
                  Masculino
                </SexPill>
                <SexPill
                  active={physical.sex === 'female'}
                  onClick={() => setPhysical((p) => ({ ...p, sex: 'female' }))}
                >
                  Femenino
                </SexPill>
              </div>
            </Field>
            <Field label="Edad">
              <input
                type="number" min={1} max={120}
                value={physical.age}
                onChange={(e) => setPhysical((p) => ({ ...p, age: e.target.value ? Number(e.target.value) : '' }))}
                placeholder="—"
                className="input-line"
              />
            </Field>
            <Field label="Peso · kg">
              <input
                type="number" min={20} max={300} step={0.1}
                value={physical.weight}
                onChange={(e) => setPhysical((p) => ({ ...p, weight: e.target.value ? Number(e.target.value) : '' }))}
                placeholder="—"
                className="input-line"
              />
            </Field>
            <Field label="Altura · cm">
              <input
                type="number" min={100} max={250}
                value={physical.height}
                onChange={(e) => setPhysical((p) => ({ ...p, height: e.target.value ? Number(e.target.value) : '' }))}
                placeholder="—"
                className="input-line"
              />
            </Field>
          </div>

          <div>
            <Label>Nivel de actividad</Label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {Object.entries(ACTIVITY_LABELS).map(([value, label]) => (
                <Pill
                  key={value}
                  active={physical.activity_level === value}
                  onClick={() => setPhysical((p) => ({ ...p, activity_level: value as PhysicalData['activity_level'] }))}
                >
                  {label}
                </Pill>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Capitulo 02 — Preferencias */}
      <section className="px-5 mt-12">
        <ChapterHeader number="02" title="Tus" italic="preferencias" />
        <div className="mt-6 space-y-6">
          <div>
            <Label>Prioridad nutricional</Label>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                <Pill
                  key={value}
                  active={preferences.priority === value}
                  onClick={() => setPreferences((p) => ({ ...p, priority: value as Preferences['priority'] }))}
                >
                  {label}
                </Pill>
              ))}
            </div>
          </div>

          <div>
            <Label>Restricciones</Label>
            {preferences.restrictions.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {preferences.restrictions.map((r) => (
                  <motion.span
                    key={r}
                    layout
                    initial={{ scale: 0.85, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="inline-flex items-center gap-1 rounded-full bg-[#1A1612] pl-3 pr-1.5 py-1 text-[12px] text-[#FAF6EE]"
                  >
                    {r}
                    <button
                      onClick={() => removeRestriction(r)}
                      className="ml-0.5 rounded-full p-0.5 hover:bg-[#FAF6EE]/15"
                      aria-label={`Quitar ${r}`}
                    >
                      <X size={11} />
                    </button>
                  </motion.span>
                ))}
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {COMMON_RESTRICTIONS.filter((r) => !preferences.restrictions.includes(r)).map((r) => (
                <button
                  key={r}
                  onClick={() => addRestriction(r)}
                  className="inline-flex items-center gap-1 rounded-full border border-dashed border-[#DDD6C5] bg-transparent px-3 py-1 text-[12px] text-[#7A7066] hover:border-[#1A1612] hover:text-[#1A1612]"
                >
                  <Plus size={10} /> {r}
                </button>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <input
                type="text"
                value={restrictionInput}
                onChange={(e) => setRestrictionInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); addRestriction(restrictionInput) }
                }}
                placeholder="Otra restriccion..."
                className="input-line flex-1"
              />
              <button
                onClick={() => addRestriction(restrictionInput)}
                disabled={!restrictionInput.trim()}
                className="rounded-full bg-[#1A1612] px-4 text-[11px] uppercase tracking-[0.12em] text-[#FAF6EE] disabled:opacity-30"
              >
                Anadir
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Capitulo 03 — Plantilla semanal */}
      <section className="px-5 mt-12">
        <ChapterHeader number="03" title="Plantilla" italic="semanal" />
        <p className="mt-2 text-[12px] text-[#7A7066]">
          Que comidas incluye tu menu cada dia.
        </p>

        <div className="mt-5 overflow-hidden rounded-2xl bg-[#FFFEFA] border border-[#DDD6C5]">
          <div className="grid grid-cols-[auto_1fr_1fr_1fr_1fr]">
            <div />
            {MEALS.map((m) => (
              <div key={m} className="border-l border-[#DDD6C5] py-2.5 text-center text-[9px] uppercase tracking-[0.15em] text-[#7A7066]">
                {m === 'desayuno' ? 'Des' : m === 'almuerzo' ? 'Com' : m === 'merienda' ? 'Mer' : 'Cen'}
              </div>
            ))}
            {DAYS.map((day, di) => (
              <div key={day} className="contents">
                <div className="border-t border-[#DDD6C5] py-3 px-3 flex items-center gap-2">
                  <span className="font-display text-base text-[#1A1612]">{DAYS_SHORT[di]}</span>
                  <span className="text-[10px] uppercase tracking-[0.1em] text-[#7A7066] capitalize">{day}</span>
                </div>
                {MEALS.map((meal) => {
                  const active = (mealTemplate[day] ?? []).includes(meal)
                  return (
                    <button
                      key={meal}
                      onClick={() => toggleMeal(day, meal)}
                      className={`border-l border-t border-[#DDD6C5] py-3 transition-colors flex items-center justify-center ${
                        active ? 'bg-[#1A1612] text-[#FAF6EE]' : 'bg-transparent hover:bg-[#F2EDE0]'
                      }`}
                      aria-label={`${meal} el ${day}`}
                    >
                      {active && <Check size={13} strokeWidth={2.5} />}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Capitulo 04 — Voz */}
      {typeof window !== 'undefined' && typeof (window as any).RTCPeerConnection !== 'undefined' && (
      <section className="px-5 mt-12">
        <ChapterHeader number="04" title="Modo" italic="manos libres" />
        <p className="mt-2 text-[12px] text-[#7A7066]">
          Di "Hola Ona" desde cualquier pantalla y mantén una conversación sin tocar la app.
          La detección de la palabra ocurre en tu dispositivo: no se envía audio hasta que la activas.
        </p>

        <div className="mt-5 rounded-2xl bg-[#FFFEFA] border border-[#DDD6C5] p-4">
          <button
            type="button"
            onClick={async () => {
              const next = !voiceMode.enabled
              if (next) {
                try {
                  await navigator.mediaDevices.getUserMedia({ audio: true }).then(s => s.getTracks().forEach(t => t.stop()))
                } catch {
                  alert('Necesito permiso de micrófono para activar el modo voz.')
                  return
                }
              }
              voiceMode.setEnabled(next)
            }}
            className="flex w-full items-center justify-between gap-3"
            aria-pressed={voiceMode.enabled}
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${voiceMode.enabled ? 'bg-[#2D6A4F] text-white' : 'bg-[#F2EDE0] text-[#7A7066]'}`}>
                <Mic size={16} />
              </div>
              <div className="text-left min-w-0">
                <div className="text-[13px] font-medium text-[#1A1612]">Activar wake word "Hola Ona"</div>
                <div className="text-[11px] text-[#7A7066] truncate">
                  {voiceMode.enabled ? (voiceMode.isWakeListening ? 'Escuchando…' : (voiceMode.wakeError ?? 'Iniciando…')) : 'Desactivado'}
                </div>
              </div>
            </div>
            <span className={`relative inline-block h-6 w-11 rounded-full transition-colors ${voiceMode.enabled ? 'bg-[#2D6A4F]' : 'bg-[#DDD6C5]'}`}>
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${voiceMode.enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </span>
          </button>
        </div>
      </section>
      )}

      {/* Save bar */}
      <div className="px-5 mt-10 mb-24">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-[#1A1612] py-3.5 text-[13px] font-medium text-[#FAF6EE] transition-all hover:bg-[#2D6A4F] disabled:opacity-50"
        >
          {saving ? 'Guardando...' : saved ? '✓ Guardado' : 'Guardar cambios'}
        </button>
      </div>

      <style jsx>{`
        :global(.input-line) {
          width: 100%;
          background: transparent;
          border: none;
          border-bottom: 1px solid #DDD6C5;
          padding: 0.5rem 0;
          font-family: inherit;
          font-size: 14px;
          color: #1A1612;
          outline: none;
          transition: border-color 200ms;
        }
        :global(.input-line:focus) {
          border-bottom-color: #1A1612;
        }
        :global(.input-line::placeholder) {
          color: #A39A8E;
        }
      `}</style>
    </div>
  )
}

/* ─────────────────────────────────────────── */

function ChapterHeader({ number, title, italic }: { number: string; title: string; italic: string }) {
  return (
    <div className="border-b border-[#DDD6C5] pb-3">
      <div className="text-eyebrow mb-2 text-[#7A7066]">Capitulo {number}</div>
      <h2 className="font-display text-[1.6rem] leading-tight text-[#1A1612]">
        {title} <span className="font-italic italic text-[#C65D38]">{italic}</span>
      </h2>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-[0.18em] text-[#7A7066]">{children}</div>
  )
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3.5 py-1.5 text-[12px] font-medium transition-all active:scale-95 ${
        active
          ? 'border-[#1A1612] bg-[#1A1612] text-[#FAF6EE]'
          : 'border-[#DDD6C5] bg-[#FFFEFA] text-[#4A4239] hover:border-[#1A1612]'
      }`}
    >
      {children}
    </button>
  )
}

function SexPill({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-full border px-3 py-2 text-[12px] font-medium transition-all active:scale-95 ${
        active
          ? 'border-[#1A1612] bg-[#1A1612] text-[#FAF6EE]'
          : 'border-[#DDD6C5] bg-transparent text-[#7A7066] hover:border-[#1A1612] hover:text-[#1A1612]'
      }`}
    >
      {children}
    </button>
  )
}
