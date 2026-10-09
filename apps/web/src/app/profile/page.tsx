'use client'

/**
 * /profile — "D · Luz y foto" (PRO-39): compact header with the household's
 * name, paper cards per section (Casa, Memoria, Creencias, Despensa, Fijos,
 * Recetarios, Voz, WhatsApp) with an icon and a status line, then the menu
 * settings the generator reads (one "Guardar cambios") and the account card.
 * Secondary actions sit behind "···" sheets (`MenuSheet`). 2–3 columns at lg+.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { useQuery } from '@tanstack/react-query'
import {
  Archive,
  Bell,
  BellOff,
  BookOpen,
  Brain,
  CalendarDays,
  ChefHat,
  Compass,
  Home,
  LogOut,
  MessageCircle,
  Mic,
  Minus,
  Plus,
  Repeat,
  Ruler,
  Send,
  Shield,
  SlidersHorizontal,
  UserRound,
  Wrench,
  X,
} from 'lucide-react'
import { MenuSheet, SheetAction } from '@/components/menu/MenuSheet'
import { DISPLAY_UI } from '@/components/recipes/RecipeCard'
import { useUserMemory } from '@/hooks/useUserMemory'
import { usePantry } from '@/hooks/usePantry'
import { useStaples } from '@/hooks/useStaples'
import { useCookbooks } from '@/hooks/useCookbooks'
import { GroupLabel, MoreButton, ProfileCard, ProfileHubLink, Switch } from './sections/ProfileCards'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'
import { useWebPush } from '@/hooks/useWebPush'
import { useMimo } from '@/components/mimo/MimoProvider'
import {
  getEnabled as getNotifEnabled,
  setEnabled as setNotifEnabledLS,
  getMealTimes,
  setMealTimes,
  requestPermission as requestNotifPermission,
  scheduleMealReminders,
  clearAllReminders,
  type MealTimes,
} from '@/lib/pwa/notifications'
import { MyRecipesSection } from './sections/MyRecipesSection'
import { MealDishCountControls } from '@/components/profile/MealDishCountControls'
import { WhatsAppCard } from '@/components/profile/WhatsAppCard'
import { DeleteAccountCard } from '@/components/profile/DeleteAccountCard'
import { useWhatsAppStatus } from '@/hooks/useWhatsApp'
import type { Meal } from '@ona/shared'
import { RESTRICTION_PRESETS } from '@ona/shared'
import type { HealthConsentState } from '@ona/shared'
import { HealthConsentCheckbox } from '@/components/HealthConsentCheckbox'

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

interface Household {
  adults: number
  kidsCount: number
}

/**
 * Per-day meal template with diner counts.
 *
 * Each day maps a meal name ('desayuno' | 'almuerzo' | 'merienda' | 'cena')
 * to the number of diners for that slot (>= 1). Absence of the key means the
 * slot is off and won't be generated. The API normalizes either this shape or
 * the legacy `string[]` shape; we keep loading both for backwards compat but
 * always save the numeric one. See `extractMealDiners` in `menuGenerator.ts`.
 */
interface MealTemplate {
  [day: string]: Record<string, number>
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

// Shared with onboarding so both offer the same chips (@ona/shared).
const COMMON_RESTRICTIONS: readonly string[] = RESTRICTION_PRESETS

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
  const whatsapp = useWhatsAppStatus()
  const mimo = useMimo()

  const [physical, setPhysical] = useState<PhysicalData>({
    sex: '', age: '', weight: '', height: '', activity_level: 'moderate',
  })
  const [preferences, setPreferences] = useState<Preferences>({
    restrictions: [], priority: 'balanced',
  })
  const [household, setHousehold] = useState<Household>({ adults: 2, kidsCount: 0 })
  const [mealTemplate, setMealTemplate] = useState<MealTemplate>(() => {
    // Default: 3 meals every day, 2 diners each — matches the previous on/off
    // default ("desayuno, almuerzo, cena") but seeded with sensible counts so
    // the menu generator can flow them into shopping-list quantities.
    const t: MealTemplate = {}
    for (const d of DAYS) t[d] = { desayuno: 2, almuerzo: 2, cena: 2 }
    return t
  })
  const [mealDishCounts, setMealDishCounts] = useState<Partial<Record<Meal, 1 | 2 | 3>>>({})
  const [restrictionInput, setRestrictionInput] = useState('')
  // RGPD art. 9 (PRO-21): physical data and restrictions only with consent.
  const [healthConsent, setHealthConsent] = useState<HealthConsentState | null>(null)
  const [consentBusy, setConsentBusy] = useState(false)
  const healthActive = healthConsent?.active === true
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)

  const [notifEnabled, setNotifEnabled] = useState(false)
  const [mealTimes, setLocalMealTimes] = useState<MealTimes>({
    breakfast: '08:00',
    lunch: '14:00',
    dinner: '21:00',
    snack: '17:00',
  })

  useEffect(() => {
    setNotifEnabled(getNotifEnabled())
    setLocalMealTimes(getMealTimes())
  }, [])

  async function handleToggleNotif() {
    if (!notifEnabled) {
      const perm = await requestNotifPermission()
      if (perm !== 'granted') return
      setNotifEnabledLS(true)
      setNotifEnabled(true)
      scheduleMealReminders(mealTimes)
    } else {
      setNotifEnabledLS(false)
      setNotifEnabled(false)
      clearAllReminders()
    }
  }

  function handleMealTimeChange(meal: keyof MealTimes, value: string) {
    const next = { ...mealTimes, [meal]: value }
    setLocalMealTimes(next)
    setMealTimes(next)
    if (notifEnabled) scheduleMealReminders(next)
  }

  useEffect(() => {
    if (!user) return
    api.get<HealthConsentState>(`/user/${user.id}/health-consent`).then(setHealthConsent).catch(() => {})
  }, [user])

  async function handleHealthConsent(next: boolean) {
    if (!user || consentBusy) return
    if (!next && !window.confirm('Si retiras el consentimiento, borramos tus alergias, restricciones y datos físicos. ¿Seguro?')) return
    setConsentBusy(true)
    try {
      const state = await api.post<HealthConsentState>(`/user/${user.id}/health-consent`, { consent: next })
      setHealthConsent(state)
      if (!next) {
        setPhysical({ sex: '', age: '', weight: '', height: '', activity_level: 'moderate' })
        setPreferences((p) => ({ ...p, restrictions: [] }))
      }
    } catch (e) { console.error(e) }
    finally { setConsentBusy(false) }
  }

  useEffect(() => {
    if (!user) return
    api.get<any>(`/user/${user.id}/settings`).then((data) => {
      const blob = data?.template && !Array.isArray(data.template) ? data.template : data
      if (blob?.physical) setPhysical(blob.physical)
      if (blob?.preferences) setPreferences(blob.preferences)
      const rawMt = blob?.mealTemplate ?? blob?.meal_template
      if (rawMt && typeof rawMt === 'object') {
        // Coerce legacy on/off (`string[]`) to the numeric shape with the
        // household default so the stepper has somewhere to start.
        const defaultDiners = Math.max(
          1,
          (user.adults ?? 2) + Math.ceil((user.kidsCount ?? 0) * 0.5),
        )
        const next: MealTemplate = {}
        for (const day of DAYS) {
          const cell = (rawMt as Record<string, unknown>)[day]
          if (Array.isArray(cell)) {
            const counts: Record<string, number> = {}
            for (const meal of cell) {
              if (typeof meal === 'string') counts[meal] = defaultDiners
            }
            next[day] = counts
          } else if (cell && typeof cell === 'object') {
            const counts: Record<string, number> = {}
            for (const [meal, n] of Object.entries(cell as Record<string, unknown>)) {
              const v = typeof n === 'number' ? Math.floor(n) : 0
              if (v > 0) counts[meal] = v
            }
            next[day] = counts
          } else {
            next[day] = {}
          }
        }
        setMealTemplate(next)
      }
      const rawMdc = blob?.mealDishCounts
      if (rawMdc && typeof rawMdc === 'object') {
        const cleaned: Partial<Record<Meal, 1 | 2 | 3>> = {}
        for (const [m, c] of Object.entries(rawMdc as Record<string, unknown>)) {
          if (c === 1 || c === 2 || c === 3) cleaned[m as Meal] = c
        }
        setMealDishCounts(cleaned)
      }
    }).catch(() => {})
  }, [user])

  // Hydrate household sizing from the user object (already includes
  // adults + kidsCount after the 0005 migration). Falls back to the
  // legacy enum until the user re-saves their profile.
  useEffect(() => {
    if (!user) return
    if (typeof user.adults === 'number' && user.adults > 0) {
      setHousehold({ adults: user.adults, kidsCount: user.kidsCount ?? 0 })
      return
    }
    switch (user.householdSize) {
      case 'solo':
        setHousehold({ adults: 1, kidsCount: 0 })
        break
      case 'couple':
        setHousehold({ adults: 2, kidsCount: 0 })
        break
      case 'family_no_kids':
        setHousehold({ adults: 3, kidsCount: 0 })
        break
      case 'family_with_kids':
        setHousehold({ adults: 2, kidsCount: 2 })
        break
    }
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

  const defaultDinersForCell = useMemo(() => {
    return Math.max(
      1,
      (household.adults ?? 2) + Math.ceil((household.kidsCount ?? 0) * 0.5),
    )
  }, [household.adults, household.kidsCount])

  function adjustMealDiners(day: string, meal: string, delta: number) {
    setMealTemplate((prev) => {
      const cur = prev[day] ?? {}
      const has = Object.prototype.hasOwnProperty.call(cur, meal)
      const current = has ? cur[meal] : 0
      // First tap on an off cell seeds the household default rather than 1, so
      // the typical user (couple, family) doesn't have to spam +.
      const next = has
        ? Math.max(0, Math.min(24, current + delta))
        : delta > 0
          ? defaultDinersForCell
          : 0
      const nextCell: Record<string, number> = { ...cur }
      if (next > 0) nextCell[meal] = next
      else delete nextCell[meal]
      return { ...prev, [day]: nextCell }
    })
  }

  function clearMealDiners(day: string, meal: string) {
    setMealTemplate((prev) => {
      const cur = prev[day] ?? {}
      if (!Object.prototype.hasOwnProperty.call(cur, meal)) return prev
      const nextCell: Record<string, number> = { ...cur }
      delete nextCell[meal]
      return { ...prev, [day]: nextCell }
    })
  }

  const handleSave = useCallback(async () => {
    if (!user) return
    setSaving(true); setSaved(false)
    try {
      const ACTIVITY_MAP: Record<string, 'none' | 'light' | 'moderate' | 'high'> = {
        sedentary: 'none',
        light: 'light',
        moderate: 'moderate',
        active: 'moderate',
        very_active: 'high',
      }
      const userPayload: Record<string, unknown> = {}
      if (healthActive) {
      if (physical.sex) userPayload.sex = physical.sex
      if (physical.age !== '' && physical.age != null) userPayload.age = Number(physical.age)
      if (physical.weight !== '' && physical.weight != null) userPayload.weight = Number(physical.weight)
      if (physical.height !== '' && physical.height != null) userPayload.height = Number(physical.height)
      if (physical.activity_level) userPayload.activityLevel = ACTIVITY_MAP[physical.activity_level] ?? 'moderate'
      if (preferences.restrictions.length > 0) userPayload.restrictions = preferences.restrictions
      }
      const PRIORITY_MAP: Record<string, 'quick' | 'varied' | 'healthy' | 'cheap'> = {
        balanced: 'varied',
        muscle: 'healthy',
        weight_loss: 'healthy',
        energy: 'quick',
      }
      if (preferences.priority) userPayload.priority = PRIORITY_MAP[preferences.priority] ?? 'varied'
      // Household sizing — required by the shopping-list scaler.
      if (Number.isFinite(household.adults) && household.adults >= 1) {
        userPayload.adults = Math.floor(household.adults)
      }
      if (Number.isFinite(household.kidsCount) && household.kidsCount >= 0) {
        userPayload.kidsCount = Math.floor(household.kidsCount)
      }

      const calls: Promise<unknown>[] = []
      if (Object.keys(userPayload).length > 0) {
        calls.push(api.put(`/user/${user.id}`, userPayload))
      }
      calls.push(api.put(`/user/${user.id}/settings`, {
        template: healthActive
          ? { physical, preferences, mealTemplate, mealDishCounts }
          : { preferences: { ...preferences, restrictions: [] }, mealTemplate, mealDishCounts },
      }))
      await Promise.all(calls)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) { console.error(e) }
    finally { setSaving(false) }
  }, [user, physical, preferences, household, mealTemplate, mealDishCounts, healthActive])


  if (authLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream">
        <div className="text-eyebrow">Cargando...</div>
      </div>
    )
  }

  const activeMeals = Object.values(mealTemplate).reduce((n, day) => n + Object.keys(day).length, 0)
  const showWhatsApp = Boolean(whatsapp.data?.available || whatsapp.data?.linked)

  return (
    <div className="min-h-screen bg-cream pb-12">
      <div className="mx-auto w-full max-w-[1180px] lg:px-12 lg:pt-8">
        <ProfileHeader
          username={user.username}
          email={user.email}
          onMore={() => setMoreOpen(true)}
        />

        {/* Casa y Mimo: one paper card per sub-page, with a status line. */}
        <div className="mt-6 px-5 lg:mt-8 lg:px-0">
          <GroupLabel>Tu casa y Mimo</GroupLabel>
          <ProfileHub />
        </div>

        <div className="mt-3 grid gap-3 px-5 lg:mt-4 lg:grid-cols-2 lg:items-start lg:gap-4 lg:px-0">
          {/* Voz (D-023: one assistant, the floating button on every page) */}
          <ProfileCard
            icon={Mic}
            title="Voz"
            status={mimo.speakReplies ? 'Mimo lee sus respuestas en voz alta' : 'Mimo lee en voz alta solo cuando le hablas'}
            data-testid="profile-mimo-voice"
          >
            <p className="mt-3 text-[13px] leading-snug text-ink-muted">
              Mimo está en el botón flotante de cualquier pantalla. Toca el micro para hablarle, o activa
              «Manos libres» para conversar sin tocar nada mientras cocinas.
            </p>

            <ToggleRow
              title="Leer las respuestas en voz alta"
              subtitle={mimo.speakReplies ? 'Activo · también cuando escribes' : 'Solo cuando le hablas'}
              on={mimo.speakReplies}
              onToggle={() => mimo.setSpeakReplies(!mimo.speakReplies)}
            />

            {mimo.voices.length > 1 && (
              <label className="flex min-h-[56px] items-center justify-between gap-3 border-t border-border-soft py-2">
                <span className="text-[14px] font-medium text-ink">Voz de Mimo</span>
                <select
                  value={mimo.selectedVoice ?? ''}
                  onChange={(e) => mimo.previewVoice(e.target.value)}
                  className="h-11 max-w-[60%] rounded-full border border-border bg-cream px-3 text-[13px] text-ink focus:border-ink focus:outline-none"
                  aria-label="Voz de Mimo"
                >
                  {mimo.voices.map((v) => (
                    <option key={v.key} value={v.key}>{v.name}</option>
                  ))}
                </select>
              </label>
            )}

            {mimo.wakeWord.available ? (
              <ToggleRow
                title={`Escuchar «${mimo.wakeWord.phrase}»`}
                subtitle={
                  !mimo.wakeWord.enabled
                    ? 'Desactivado · actívalo para abrir a Mimo sin tocar nada'
                    : mimo.wakeWord.listening
                      ? `Escuchando «${mimo.wakeWord.phrase}»`
                      : 'Iniciando…'
                }
                on={mimo.wakeWord.enabled}
                onToggle={async () => {
                  const next = !mimo.wakeWord.enabled
                  if (next) {
                    try {
                      await navigator.mediaDevices.getUserMedia({ audio: true }).then((st) => st.getTracks().forEach((t) => t.stop()))
                    } catch {
                      alert('Necesito permiso de micrófono para escucharte.')
                      return
                    }
                  }
                  mimo.wakeWord.setEnabled(next)
                }}
              />
            ) : (
              <p className="mt-2 border-t border-border-soft pt-3 text-[12px] leading-snug text-ink-muted">
                Abrir a Mimo diciendo «Hola Mimo», sin tocar nada, llegará en cuanto esté entrenada la palabra de activación.
              </p>
            )}
          </ProfileCard>

          {/* WhatsApp. Hidden unless the server has the channel configured for
              this account (or a phone is already linked, so it can always be
              disconnected). */}
          {showWhatsApp && whatsapp.data && (
            <ProfileCard
              icon={MessageCircle}
              title="WhatsApp"
              status={whatsapp.data.linked ? 'Conectado' : 'Sin conectar'}
            >
              <p className="mt-3 text-[13px] leading-snug text-ink-muted">
                Todo lo que hace el asistente, desde tu WhatsApp: escríbele,
                mándale audios o compártele recetas.
              </p>
              <div className="mt-3">
                <WhatsAppCard status={whatsapp.data} />
              </div>
            </ProfileCard>
          )}
        </div>

        {/* Ajustes del menú: what the generator reads. One save button below. */}
        <div className="mt-8 px-5 lg:mt-10 lg:px-0">
          <GroupLabel>Ajustes del menú</GroupLabel>
        </div>
        <div className="mt-3 grid gap-3 px-5 lg:mt-4 lg:grid-cols-2 lg:items-start lg:gap-4 lg:px-0">
          <div className="grid gap-3 lg:gap-4">
            {/* Datos físicos (RGPD art. 9: only with the health-data consent) */}
            <ProfileCard
              icon={Ruler}
              title="Datos físicos"
              status={
                !healthActive
                  ? 'Sin tu consentimiento no se guardan'
                  : tdee
                    ? `Gasto diario estimado: ${tdee} kcal`
                    : 'Completa sexo, edad, peso y altura'
              }
            >
              <div className="mt-4" data-testid="health-consent">
                <HealthConsentCheckbox
                  checked={healthActive}
                  disabled={consentBusy || healthConsent === null}
                  onChange={handleHealthConsent}
                />
                {!healthActive && healthConsent !== null && (
                  <p className="mt-2 text-[12px] italic text-ink-muted">
                    Sin tu consentimiento no guardamos datos físicos, alergias ni restricciones.
                  </p>
                )}
              </div>
              <fieldset disabled={!healthActive} className={`mt-5 space-y-5 ${healthActive ? '' : 'opacity-40'}`}>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Sexo" className="col-span-2">
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
              </fieldset>

              {bmr && tdee && (
                <div className="mt-5 grid grid-cols-2 gap-3 border-t border-border-soft pt-4">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">Metabolismo basal</div>
                    <div className="mt-1 font-serif-text text-[24px] font-[650] text-ink">
                      {bmr}<span className="ml-1 text-[13px] font-normal text-ink-muted">kcal</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">Gasto diario</div>
                    <div className="mt-1 font-serif-text text-[24px] font-[650] text-terracotta-deep">
                      {tdee}<span className="ml-1 text-[13px] font-normal text-ink-muted">kcal</span>
                    </div>
                  </div>
                </div>
              )}
            </ProfileCard>

            {/* Preferencias */}
            <ProfileCard
              icon={SlidersHorizontal}
              title="Preferencias"
              status={`${household.adults} ${household.adults === 1 ? 'adulto' : 'adultos'} · ${household.kidsCount} ${household.kidsCount === 1 ? 'niño' : 'niños'} · ${PRIORITY_LABELS[preferences.priority] ?? ''}`}
            >
              <div className="mt-4 space-y-6">
                <div>
                  <Label>Hogar (para escalar la compra)</Label>
                  <p className="mt-1 text-[12px] italic leading-snug text-ink-muted">
                    Adultos cuenta a partir de 11 años. Niños son 2 a 10. Menores de 2 no cuentan. Cada niño cuenta como media ración.
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <Stepper
                      label="Adultos"
                      value={household.adults}
                      onMinus={() => setHousehold((h) => ({ ...h, adults: Math.max(1, h.adults - 1) }))}
                      onPlus={() => setHousehold((h) => ({ ...h, adults: Math.min(20, h.adults + 1) }))}
                      minusLabel="Quitar adulto"
                      plusLabel="Añadir adulto"
                    />
                    <Stepper
                      label="Niños 2–10"
                      value={household.kidsCount}
                      onMinus={() => setHousehold((h) => ({ ...h, kidsCount: Math.max(0, h.kidsCount - 1) }))}
                      onPlus={() => setHousehold((h) => ({ ...h, kidsCount: Math.min(20, h.kidsCount + 1) }))}
                      minusLabel="Quitar niño"
                      plusLabel="Añadir niño"
                    />
                  </div>
                </div>

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

                <fieldset disabled={!healthActive} className={healthActive ? '' : 'opacity-40'}>
                  <Label>Restricciones</Label>
                  {preferences.restrictions.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {preferences.restrictions.map((r) => (
                        <motion.span
                          key={r}
                          layout
                          initial={{ scale: 0.85, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          className="inline-flex h-10 items-center gap-0.5 rounded-full bg-ink pl-3.5 pr-0.5 text-[13px] text-cream"
                        >
                          {r}
                          <button
                            type="button"
                            onClick={() => removeRestriction(r)}
                            className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-cream/15"
                            aria-label={`Quitar ${r}`}
                          >
                            <X size={13} />
                          </button>
                        </motion.span>
                      ))}
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {COMMON_RESTRICTIONS.filter((r) => !preferences.restrictions.includes(r)).map((r) => (
                      <button
                        type="button"
                        key={r}
                        onClick={() => addRestriction(r)}
                        className="inline-flex min-h-[40px] items-center gap-1 rounded-full border border-dashed border-border bg-transparent px-3.5 text-[13px] text-ink-muted hover:border-ink hover:text-ink"
                      >
                        <Plus size={12} /> {r}
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
                      type="button"
                      onClick={() => addRestriction(restrictionInput)}
                      disabled={!restrictionInput.trim()}
                      className="h-11 rounded-full bg-ink px-5 text-[13px] font-medium text-cream disabled:opacity-30"
                    >
                      Añadir
                    </button>
                  </div>
                </fieldset>
              </div>
            </ProfileCard>
          </div>

          <div className="grid gap-3 lg:gap-4">
            {/* Plantilla semanal */}
            <ProfileCard
              icon={CalendarDays}
              title="Plantilla semanal"
              status={`${activeMeals} ${activeMeals === 1 ? 'comida' : 'comidas'} a la semana`}
            >
              <p className="mt-3 text-[13px] leading-snug text-ink-muted">
                Qué comidas incluye tu menú cada día y para cuántos comensales.
                Toca <span className="font-mono">+</span> para activar (parte con tu
                casa por defecto, <span className="tabular-nums">{defaultDinersForCell}</span>),
                <span className="font-mono"> −</span> para bajar y dejar la celda
                vacía para apagarla.
              </p>

              <div className="mt-4">
                <MealDishCountControls value={mealDishCounts} onChange={setMealDishCounts} />
              </div>

              <div className="mt-4 overflow-hidden rounded-2xl border border-border-soft bg-paper">
                <div className="grid grid-cols-[36px_1fr_1fr_1fr_1fr]">
                  <div />
                  {MEALS.map((m) => (
                    <div key={m} className="border-l border-border-soft py-2.5 text-center text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
                      {m === 'desayuno' ? 'Des' : m === 'almuerzo' ? 'Com' : m === 'merienda' ? 'Mer' : 'Cen'}
                    </div>
                  ))}
                  {DAYS.map((day, di) => (
                    <div key={day} className="contents">
                      <div className="flex items-center justify-center border-t border-border-soft">
                        <span className="font-serif-text text-[15px] font-[650] text-ink" title={day}>
                          {DAYS_SHORT[di]}
                        </span>
                      </div>
                      {MEALS.map((meal) => {
                        const count = mealTemplate[day]?.[meal] ?? 0
                        const active = count > 0
                        return (
                          <div
                            key={meal}
                            className={`flex min-h-[44px] items-stretch border-l border-t border-border-soft ${
                              active ? 'bg-ink text-cream' : 'bg-transparent'
                            }`}
                          >
                            {active ? (
                              <div className="flex w-full items-center justify-between">
                                <button
                                  type="button"
                                  onClick={() => adjustMealDiners(day, meal, -1)}
                                  className="flex h-11 w-7 shrink-0 items-center justify-center transition-colors hover:bg-cream/15"
                                  aria-label={`Menos comensales en ${meal} ${day}`}
                                >
                                  <Minus size={12} />
                                </button>
                                <span className="text-[13px] font-medium tabular-nums">{count}</span>
                                <button
                                  type="button"
                                  onClick={() => adjustMealDiners(day, meal, 1)}
                                  disabled={count >= 24}
                                  className="flex h-11 w-7 shrink-0 items-center justify-center transition-colors hover:bg-cream/15 disabled:opacity-30"
                                  aria-label={`Más comensales en ${meal} ${day}`}
                                >
                                  <Plus size={12} />
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => adjustMealDiners(day, meal, 1)}
                                className="flex w-full items-center justify-center text-ink-muted transition-colors hover:bg-cream-deep"
                                aria-label={`Activar ${meal} el ${day}`}
                              >
                                <Plus size={14} />
                              </button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </ProfileCard>

            {/* Recordatorios */}
            <ProfileCard
              icon={Bell}
              title="Recordatorios"
              status={notifEnabled ? 'Recordatorios de comidas activados' : 'Recordatorios de comidas desactivados'}
            >
              <p className="mt-3 text-[13px] leading-snug text-ink-muted">
                Te avisamos a las horas que prefieras para que no se te pase. Las
                notificaciones son locales: solo suenan si tienes la app abierta o
                instalada.
              </p>

              <button
                type="button"
                onClick={handleToggleNotif}
                className="mt-2 flex min-h-[56px] w-full items-center justify-between gap-3 border-t border-border-soft py-2"
                aria-pressed={notifEnabled}
              >
                <div className="min-w-0 text-left">
                  <div className="text-[14px] font-medium text-ink">
                    Recibir recordatorios de comidas
                  </div>
                  <div className="truncate text-[12px] text-ink-muted">
                    {notifEnabled ? 'Activado' : 'Desactivado'}
                  </div>
                </div>
                <Switch on={notifEnabled} />
              </button>

              {notifEnabled && (
                <div className="mt-2 grid grid-cols-2 gap-4 border-t border-border-soft pt-4">
                  <Field label="Desayuno">
                    <input
                      type="time"
                      value={mealTimes.breakfast}
                      onChange={(e) => handleMealTimeChange('breakfast', e.target.value)}
                      className="input-line"
                    />
                  </Field>
                  <Field label="Comida">
                    <input
                      type="time"
                      value={mealTimes.lunch}
                      onChange={(e) => handleMealTimeChange('lunch', e.target.value)}
                      className="input-line"
                    />
                  </Field>
                  <Field label="Merienda">
                    <input
                      type="time"
                      value={mealTimes.snack}
                      onChange={(e) => handleMealTimeChange('snack', e.target.value)}
                      className="input-line"
                    />
                  </Field>
                  <Field label="Cena">
                    <input
                      type="time"
                      value={mealTimes.dinner}
                      onChange={(e) => handleMealTimeChange('dinner', e.target.value)}
                      className="input-line"
                    />
                  </Field>
                </div>
              )}

              {/* Web Push — server-side notifications that survive a closed tab. */}
              <PushNotificationsCard />
            </ProfileCard>

            {/* Mis recetas */}
            <ProfileCard
              icon={ChefHat}
              title="Mis recetas"
              status="Las que has creado tú. Edítalas o elimínalas si ya no las usas."
            >
              <div className="mt-4">
                <MyRecipesSection />
              </div>
            </ProfileCard>
          </div>
        </div>

        {/* Save bar */}
        <div className="mt-6 px-5 lg:flex lg:justify-end lg:px-0">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-ink text-[15px] font-medium text-cream transition-colors hover:bg-ink-mid disabled:opacity-50 lg:w-[320px]"
          >
            {saving ? 'Guardando...' : saved ? '✓ Guardado' : 'Guardar cambios'}
          </button>
        </div>

        {/* Tu cuenta — session, privacy + right to erasure */}
        <div className="mt-8 px-5 mb-24 lg:mt-10 lg:px-0">
          <GroupLabel>Tu cuenta</GroupLabel>
          <ProfileCard
            icon={UserRound}
            title={user.username}
            status={user.email}
            className="mt-3 lg:mt-4 lg:max-w-[580px]"
          >
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border-soft pt-3">
              <button
                type="button"
                onClick={logout}
                className="inline-flex h-11 items-center gap-2 rounded-full border border-border bg-paper px-4 text-[14px] font-medium text-ink transition-colors hover:bg-cream-deep"
              >
                <LogOut size={16} strokeWidth={1.8} />
                Salir
              </button>
              <a
                href="/privacidad"
                className="inline-flex min-h-[44px] items-center text-[13px] text-ink-muted underline underline-offset-4 hover:text-ink"
              >
                Política de privacidad
              </a>
            </div>
            {user.id && (
              <div className="mt-2">
                <DeleteAccountCard userId={user.id} />
              </div>
            )}
          </ProfileCard>
        </div>
      </div>

      <MenuSheet open={moreOpen} onClose={() => setMoreOpen(false)} eyebrow="Perfil" title="Más opciones">
        <div className="flex flex-col gap-1">
          <SheetAction
            icon={Mic}
            label="Onboarding por voz"
            hint="Cuéntale a Mimo cómo coméis en casa y lo guarda en su memoria"
            href="/onboarding/voz"
          />
          {user.role === 'admin' && (
            <SheetAction icon={Shield} label="Panel de admin" href="/admin" />
          )}
        </div>
      </MenuSheet>

      <style jsx>{`
        :global(.input-line) {
          width: 100%;
          min-height: 44px;
          background: transparent;
          border: none;
          border-bottom: 1px solid var(--color-border);
          padding: 0.5rem 0;
          font-family: inherit;
          font-size: 15px;
          color: var(--color-ink);
          outline: none;
          transition: border-color 200ms;
        }
        :global(.input-line:focus) {
          border-bottom-color: var(--color-ink);
        }
        :global(.input-line::placeholder) {
          color: var(--color-ink-light);
        }
      `}</style>
    </div>
  )
}

/* ─────────────────────────────────────────── */

/**
 * Compact header (PRO-39): eyebrow with the user, the household's name as
 * the h1 (Fraunces 650, like /menu and /recipes) and a "···" for the
 * secondary actions.
 */
function ProfileHeader({ username, email, onMore }: { username: string; email: string; onMore: () => void }) {
  const household = useQuery<{ name: string }>({
    queryKey: ['household', 'me'],
    queryFn: () => api.get<{ name: string }>('/households/me'),
  })
  return (
    <header className="flex items-start justify-between gap-3 px-5 pt-3 lg:px-0 lg:pt-0">
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-muted lg:text-[12px]">
          Perfil · <span className="normal-case tracking-normal">{username}</span>
        </p>
        {household.isPending ? (
          <span aria-hidden="true" className="my-1.5 block h-7 w-48 rounded-full bg-bone lg:h-9" />
        ) : (
          <h1 className={`${DISPLAY_UI} text-[30px] leading-[1.1] text-ink lg:text-[40px] lg:leading-[1.05]`}>
            {household.data?.name || 'Tu casa'}
          </h1>
        )}
        <p className="truncate text-[13px] text-ink-muted">{email}</p>
      </div>
      <MoreButton onClick={onMore} label="Más opciones del perfil" />
    </header>
  )
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`
}

/** The six sub-page cards, each with a one-line status from its own data. */
function ProfileHub() {
  const household = useQuery<{ members: unknown[]; pendingInvites?: unknown[] }>({
    queryKey: ['household', 'me'],
    queryFn: () => api.get('/households/me'),
  })
  const memory = useUserMemory()
  const pantry = usePantry()
  const staples = useStaples()
  const cookbooks = useCookbooks()

  const memoryCount = memory.data
    ? Object.keys(memory.data).filter((k) => k !== 'nutrition_principles').length
    : null
  const principles = memory.data?.nutrition_principles?.value
  const principlesCount = Array.isArray(principles) ? principles.length : memory.data ? 0 : null

  const loading = '…'
  const members = household.data?.members.length
  return (
    <div className="mt-3 grid grid-cols-2 gap-3 lg:mt-4 lg:grid-cols-3 lg:gap-4">
      <ProfileHubLink
        href="/profile/casa"
        icon={Home}
        title="Casa"
        status={members == null ? (household.isError ? 'Tu hogar' : loading) : members === 1 ? 'Solo tú' : plural(members, 'persona', 'personas')}
      />
      <ProfileHubLink
        href="/profile/memoria"
        icon={Brain}
        title="Memoria"
        status={memoryCount == null ? loading : memoryCount === 0 ? 'Aún vacía' : plural(memoryCount, 'cosa que recuerda', 'cosas que recuerda')}
      />
      <ProfileHubLink
        href="/profile/creencias"
        icon={Compass}
        title="Creencias"
        status={principlesCount == null ? loading : principlesCount === 0 ? 'Ninguna todavía' : plural(principlesCount, 'principio', 'principios')}
      />
      <ProfileHubLink
        href="/profile/pantry"
        icon={Archive}
        title="Despensa"
        status={pantry.data == null ? loading : pantry.data.length === 0 ? 'Vacía' : plural(pantry.data.length, 'producto', 'productos')}
      />
      <ProfileHubLink
        href="/profile/staples"
        icon={Repeat}
        title="Fijos"
        status={staples.data == null ? loading : staples.data.length === 0 ? 'Ningún básico todavía' : plural(staples.data.length, 'básico', 'básicos')}
      />
      <ProfileHubLink
        href="/profile/cookbooks"
        icon={BookOpen}
        title="Recetarios"
        status={cookbooks.data == null ? loading : cookbooks.data.length === 0 ? 'Ninguno todavía' : plural(cookbooks.data.length, 'recetario', 'recetarios')}
      />
    </div>
  )
}

/**
 * Renders the Web Push opt-in block inside the Recordatorios card.
 *
 * The button stays hidden when:
 *   - the browser doesn't support Push (esp. iOS Safari pre-install),
 *   - `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is missing at build time.
 *
 * On iOS, the user must "Add to Home Screen" first; we surface a tip
 * line so they don't think the button is broken. "Enviar prueba" and
 * "Reparar service worker" live behind its "···" (PRO-39).
 */
async function resetServiceWorker() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return
  const regs = await navigator.serviceWorker.getRegistrations()
  await Promise.all(regs.map((r) => r.unregister()))
  if (typeof caches !== 'undefined') {
    const names = await caches.keys()
    await Promise.all(names.map((n) => caches.delete(n)))
  }
  window.location.reload()
}

function PushNotificationsCard() {
  const { state, error, subscribe, unsubscribe, sendTest } = useWebPush()
  const [sheetOpen, setSheetOpen] = useState(false)

  if (state === 'unsupported') {
    return (
      <p className="mt-3 border-t border-border-soft pt-3 text-[12px] leading-snug text-ink-muted">
        Las notificaciones push no están disponibles en este navegador. En
        iPhone tienes que añadir la app a inicio primero (Compartir → Añadir
        a pantalla de inicio).
      </p>
    )
  }

  const isSubscribed = state === 'subscribed'
  const isWorking = state === 'subscribing'

  return (
    <div className="mt-3 border-t border-border-soft pt-3">
      <div className="flex items-start gap-3">
        {isSubscribed ? (
          <Bell size={18} className="mt-0.5 shrink-0 text-ink" />
        ) : (
          <BellOff size={18} className="mt-0.5 shrink-0 text-ink-muted" />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-medium text-ink">
            Notificaciones push del asistente
          </div>
          <div className="mt-1 text-[12px] leading-snug text-ink-muted">
            Avisos que llegan aunque la app esté cerrada — futura base para
            recordatorios de prep (sacar pescado del congelador, poner
            legumbres en remojo…).{' '}
            {state === 'denied' && (
              <span className="text-terracotta-deep">
                Has denegado el permiso; cámbialo en los ajustes del
                navegador.
              </span>
            )}
            {error && <span className="text-terracotta-deep"> {error}</span>}
          </div>

          <div className="mt-3 flex items-center gap-2">
            {isSubscribed ? (
              <button
                type="button"
                onClick={unsubscribe}
                className="h-11 rounded-full border border-border bg-paper px-4 text-[13px] font-medium text-ink-muted transition-colors hover:text-ink"
              >
                Desactivar
              </button>
            ) : (
              <button
                type="button"
                onClick={subscribe}
                disabled={isWorking}
                className="h-11 rounded-full bg-ink px-4 text-[13px] font-medium text-cream transition-colors hover:bg-ink-mid disabled:opacity-50"
              >
                {isWorking ? 'Activando…' : 'Activar notificaciones'}
              </button>
            )}
            <MoreButton onClick={() => setSheetOpen(true)} label="Más opciones de las notificaciones push" />
          </div>
        </div>
      </div>

      <MenuSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        eyebrow="Notificaciones push"
        title="Más opciones"
      >
        <div className="flex flex-col gap-1">
          {isSubscribed ? (
            <SheetAction
              icon={Send}
              label="Enviar prueba"
              hint="Te llega un aviso de prueba a este dispositivo"
              onClick={() => {
                setSheetOpen(false)
                sendTest()
              }}
            />
          ) : (
            /* Recovery escape hatch while subscribe hasn't succeeded: some
               users have a stale broken SW from a previous deploy; one tap
               nukes everything and reloads cleanly. */
            <SheetAction
              icon={Wrench}
              label="Reparar service worker"
              hint="Borra la caché de la app y recarga la página"
              onClick={() => {
                resetServiceWorker().catch(() => {})
              }}
            />
          )}
        </div>
      </MenuSheet>
    </div>
  )
}

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label>{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">{children}</div>
  )
}

function Stepper({
  label,
  value,
  onMinus,
  onPlus,
  minusLabel,
  plusLabel,
}: {
  label: string
  value: number
  onMinus: () => void
  onPlus: () => void
  minusLabel: string
  plusLabel: string
}) {
  const btn =
    'flex h-11 w-11 items-center justify-center rounded-full border border-border bg-paper text-ink transition-colors hover:border-ink'
  return (
    <div className="rounded-2xl border border-border-soft bg-cream p-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-muted">{label}</div>
      <div className="mt-2 flex items-center justify-between gap-1">
        <button type="button" onClick={onMinus} className={btn} aria-label={minusLabel}>
          <Minus size={16} />
        </button>
        <span className="w-6 text-center text-xl font-medium tabular-nums text-ink">{value}</span>
        <button type="button" onClick={onPlus} className={btn} aria-label={plusLabel}>
          <Plus size={16} />
        </button>
      </div>
    </div>
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
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-[40px] rounded-full border px-4 text-[13px] font-medium transition-colors active:scale-95 ${
        active
          ? 'border-ink bg-ink text-cream'
          : 'border-border bg-paper text-ink-mid hover:border-ink'
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
      aria-pressed={active}
      className={`h-11 flex-1 rounded-full border px-3 text-[13px] font-medium transition-colors active:scale-95 ${
        active
          ? 'border-ink bg-ink text-cream'
          : 'border-border bg-transparent text-ink-muted hover:border-ink hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}

function ToggleRow({ title, subtitle, on, onToggle }: { title: string; subtitle: string; on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="mt-2 flex min-h-[56px] w-full items-center justify-between gap-3 border-t border-border-soft py-2"
      aria-pressed={on}
    >
      <div className="min-w-0 text-left">
        <div className="text-[14px] font-medium text-ink">{title}</div>
        <div className="truncate text-[12px] text-ink-muted">{subtitle}</div>
      </div>
      <Switch on={on} />
    </button>
  )
}
