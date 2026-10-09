"use client"

/**
 * /profile/memoria — Memory of the assistant.
 *
 * Every fact the assistant knows about the user, grouped by category, with
 * a source badge per fact. Each stored fact has a "···" sheet (Editar ·
 * Olvidar este dato); editing happens inline in the row with
 * `MemoryFactEditor`. Empty keys show "Añadir" so a first value can be set
 * from the UI.
 *
 * Skin: "D · Luz y foto" (PRO-40) — paper group cards, rows split by
 * hairlines, two columns at lg+.
 */
import { useState } from "react"
import { Pencil, Plus, Trash2 } from "lucide-react"
import { useAuth } from "@/lib/auth"
import { useUserMemory, useUpdateMemory, useDeleteMemoryFact } from "@/hooks/useUserMemory"
import { MemoryFactEditor } from "@/components/profile/MemoryFactEditor"
import { MenuSheet, SheetAction } from "@/components/menu/MenuSheet"
import { Accent, MoreButton, SUB_EYEBROW, SUB_LIST, SubPage } from "@/components/profile/SubPage"
import type { MemoryKey, MemoryFact } from "@ona/shared"

interface Group {
  title: string
  keys: MemoryKey[]
}

const GROUPS: Group[] = [
  {
    title: "Perfil físico",
    keys: [
      "physical.sex",
      "physical.age",
      "physical.height_cm",
      "physical.weight_kg",
      "physical.activity_level",
    ],
  },
  {
    title: "Hogar",
    keys: ["household.adults", "household.kids_2_to_10"],
  },
  {
    title: "Restricciones y gustos",
    keys: ["restrictions", "dislikes"],
  },
  {
    title: "Cocina",
    keys: ["equipment", "cooking_skill", "weekly_budget_eur"],
  },
  {
    title: "Rutina",
    keys: ["time_available", "meal_times", "cuisine_bias"],
  },
  {
    title: "Creencias nutricionales propias",
    keys: ["nutrition_principles"],
  },
  {
    title: "Hábitos de preparación",
    keys: ["prep_habits"],
  },
  {
    title: "Otras notas",
    keys: ["notes"],
  },
]

const LABELS: Partial<Record<MemoryKey, string>> = {
  "physical.sex": "Sexo",
  "physical.age": "Edad",
  "physical.height_cm": "Altura (cm)",
  "physical.weight_kg": "Peso (kg)",
  "physical.activity_level": "Actividad",
  "household.adults": "Adultos en casa",
  "household.kids_2_to_10": "Niños 2-10 años",
  restrictions: "Restricciones",
  dislikes: "Cosas que no le gustan",
  equipment: "Equipo de cocina",
  cooking_skill: "Nivel de cocinero",
  weekly_budget_eur: "Presupuesto semanal (€)",
  time_available: "Tiempo disponible por día",
  meal_times: "Horarios de comidas",
  cuisine_bias: "Preferencias de cocina",
  notes: "Notas del asistente",
  nutrition_principles: "Principios nutricionales",
  prep_habits: "Hábitos de preparación",
}

const SOURCE_BADGES: Record<MemoryFact["source"], { label: string; color: string }> = {
  onboarding: { label: "Onboarding", color: "bg-cream-deep text-ink-muted" },
  manual: { label: "Tú", color: "bg-ink text-cream" },
  inferred: { label: "Asistente", color: "bg-warn-bg text-terracotta-deep" },
}

function formatValue(key: MemoryKey, value: unknown): string {
  if (value == null) return "—"
  if (Array.isArray(value)) return value.length === 0 ? "—" : value.join(", ")
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter(([_, v]) => v !== null && v !== undefined && v !== "")
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ")
  }
  return String(value)
}

export default function MemoryPage() {
  const { user } = useAuth()
  const { data: memory, isLoading } = useUserMemory()
  const updateMemory = useUpdateMemory()
  const deleteFact = useDeleteMemoryFact()
  const [busyKey, setBusyKey] = useState<MemoryKey | null>(null)
  const [editingKey, setEditingKey] = useState<MemoryKey | null>(null)
  const [sheetKey, setSheetKey] = useState<MemoryKey | null>(null)

  if (!user) {
    return (
      <div className="min-h-screen bg-cream p-6">
        <p className="text-ink">Necesitas iniciar sesión para ver tu memoria.</p>
      </div>
    )
  }

  function save(k: MemoryKey, next: unknown) {
    setBusyKey(k)
    updateMemory.mutate(
      { key: k, value: next },
      {
        onSettled: () => {
          setBusyKey(null)
          setEditingKey(null)
        },
      },
    )
  }

  function forget(k: MemoryKey) {
    if (typeof window === "undefined" || window.confirm("¿Olvidar este dato?")) {
      setBusyKey(k)
      deleteFact.mutate({ key: k }, { onSettled: () => setBusyKey(null) })
    }
  }

  const sheetLabel = sheetKey ? (LABELS[sheetKey] ?? sheetKey) : ""

  return (
    <SubPage
      eyebrow="Memoria del asistente"
      title={
        <>
          Lo que <Accent>recuerdo</Accent> de ti
        </>
      }
      intro="Cada dato que el asistente conoce sobre ti vive aquí. Los que tú confirmaste llevan la etiqueta «Tú»; los que el asistente dedujo en una conversación, «Asistente»."
    >
      {isLoading ? (
        <div className="animate-pulse space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-14 rounded-[20px] bg-bone" />
          ))}
        </div>
      ) : (
        <>
          {(!memory || Object.keys(memory).length === 0) && (
            <div className="mb-8 rounded-[20px] border border-dashed border-border bg-paper p-6 text-center">
              <p className="font-serif-text text-[18px] italic text-ink-mid">Todavía no recuerdo nada de ti.</p>
              <p className="mt-2 text-[14px] text-ink-soft">
                Habla con el asistente — todo lo que le cuentes se guardará aquí automáticamente.
              </p>
            </div>
          )}

          <div className="grid gap-8 lg:grid-cols-2 lg:items-start lg:gap-x-10">
            {GROUPS.map((group) => {
              // Show every key in the group — with its current value if any,
              // or an "Añadir" row if missing, so a first entry for keys like
              // `prep_habits` can be added from the UI.
              const entries = group.keys.map((k) => [k, memory?.[k] ?? null] as const)
              return (
                <section key={group.title}>
                  <h2 className={SUB_EYEBROW}>{group.title}</h2>
                  <ul className={`${SUB_LIST} mt-3`}>
                    {entries.map(([key, fact]) => {
                      const k = key as MemoryKey
                      const label = LABELS[k] ?? k
                      const isEditing = editingKey === k
                      if (fact == null) {
                        return (
                          <li key={key} className="px-4 py-1">
                            {!isEditing ? (
                              <button
                                type="button"
                                onClick={() => setEditingKey(k)}
                                className="flex min-h-[48px] w-full items-center justify-between gap-3 text-left"
                              >
                                <span className="text-[15px] text-ink-soft">{label}</span>
                                <span className="inline-flex items-center gap-1 text-[13px] font-medium text-terracotta-deep">
                                  <Plus size={14} strokeWidth={2.2} aria-hidden="true" /> Añadir
                                </span>
                              </button>
                            ) : (
                              <div className="py-2">
                                <span className="text-[15px] font-medium text-ink">{label}</span>
                                <MemoryFactEditor
                                  memoryKey={k}
                                  initial={undefined}
                                  disabled={busyKey === k}
                                  onCancel={() => setEditingKey(null)}
                                  onSave={(next) => save(k, next)}
                                />
                              </div>
                            )}
                          </li>
                        )
                      }
                      const f = fact as MemoryFact
                      const badge = SOURCE_BADGES[f.source]
                      return (
                        <li key={key} className="py-2 pl-4 pr-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1 py-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[13px] font-medium text-ink-muted">{label}</span>
                                <span
                                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${badge.color}`}
                                >
                                  {badge.label}
                                </span>
                              </div>
                              {!isEditing && (
                                <div className="mt-0.5 break-words text-[15px] text-ink">{formatValue(k, f.value)}</div>
                              )}
                            </div>
                            {!isEditing && (
                              <MoreButton label={`Opciones de ${label}`} onClick={() => setSheetKey(k)} />
                            )}
                          </div>
                          {isEditing && (
                            <div className="pb-2 pr-2">
                              <MemoryFactEditor
                                memoryKey={k}
                                initial={f.value}
                                disabled={busyKey === k}
                                onCancel={() => setEditingKey(null)}
                                onSave={(next) => save(k, next)}
                              />
                            </div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </section>
              )
            })}
          </div>
        </>
      )}

      <p className="mt-10 max-w-[560px] text-[13px] leading-relaxed text-ink-muted">
        Pulsa «···» en cualquier dato para editarlo u olvidarlo. También puedes pedírselo al asistente
        («recuerda que…»); las dos vías escriben en la misma memoria.
      </p>

      <MenuSheet open={sheetKey !== null} onClose={() => setSheetKey(null)} eyebrow="Memoria" title={sheetLabel}>
        {sheetKey && (
          <div className="flex flex-col gap-1">
            <SheetAction
              icon={Pencil}
              label={`Editar ${sheetLabel}`}
              onClick={() => {
                setEditingKey(sheetKey)
                setSheetKey(null)
              }}
            />
            <SheetAction
              icon={Trash2}
              label={`Olvidar ${sheetLabel}`}
              hint="El asistente dejará de tenerlo en cuenta."
              destructive
              disabled={busyKey === sheetKey}
              onClick={() => {
                const k = sheetKey
                setSheetKey(null)
                forget(k)
              }}
            />
          </div>
        )}
      </MenuSheet>
    </SubPage>
  )
}
