/**
 * Centralized Spanish display labels for recipe-related enums.
 *
 * Single source of truth — every UI surface that renders a meal /
 * season / difficulty value must import from here. Keeps copy
 * consistent and avoids accent-stripped fallbacks leaking into the
 * UI ("autumn" → "Otoño", never "Otono").
 */

import type { Meal, Season, Difficulty, Aisle, BuyableUnit } from "@ona/shared"

/* ─── Meals ───────────────────────────────────────────────────── */

export const MEAL_LABELS: Record<Meal, string> = {
  breakfast: "Desayuno",
  lunch: "Comida",
  dinner: "Cena",
  snack: "Snack",
}

export function mealLabel(value: string | null | undefined): string {
  if (!value) return ""
  return MEAL_LABELS[value as Meal] ?? value
}

/* ─── Seasons ─────────────────────────────────────────────────── */

export const SEASON_LABELS: Record<Season, string> = {
  spring: "Primavera",
  summer: "Verano",
  autumn: "Otoño",
  winter: "Invierno",
}

export function seasonLabel(value: string | null | undefined): string {
  if (!value) return ""
  return SEASON_LABELS[value as Season] ?? value
}

/* ─── Difficulty ──────────────────────────────────────────────── */

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: "Fácil",
  medium: "Media",
  hard: "Difícil",
}

export function difficultyLabel(value: string | null | undefined): string {
  if (!value) return ""
  return DIFFICULTY_LABELS[value as Difficulty] ?? value
}

/* ─── Shopping aisles ─────────────────────────────────────────── */

export const AISLE_LABELS: Record<Aisle, string> = {
  produce: "Frutas y verduras",
  proteinas: "Carnes y pescados",
  lacteos: "Lácteos y huevos",
  panaderia: "Panadería",
  despensa: "Despensa",
  congelados: "Congelados",
  otros: "Otros",
}

/** Display order for aisle sections in the UI / clipboard export. */
export const AISLE_ORDER: Aisle[] = [
  "produce",
  "proteinas",
  "lacteos",
  "panaderia",
  "despensa",
  "congelados",
  "otros",
]

export function aisleLabel(value: string | null | undefined): string {
  if (!value) return AISLE_LABELS.otros
  return AISLE_LABELS[value as Aisle] ?? AISLE_LABELS.otros
}

/* ─── Quantities ──────────────────────────────────────────────── */

/**
 * Render a (quantity, unit) pair in the shopping UI.
 *
 *   - g/ml above 1 kg/L collapse into "1.5 kg" / "2 L".
 *   - u → "2 u"; cda / cdita kept verbatim.
 *
 * Never silently rewrites the unit (no falling back to "g" — a `cda` stays a `cda`).
 */
export function formatQuantity(quantity: number, unit: BuyableUnit | string): string {
  const u = unit as BuyableUnit
  if (u === "g" && quantity >= 1000) {
    return `${trimZeros(quantity / 1000)} kg`
  }
  if (u === "ml" && quantity >= 1000) {
    return `${trimZeros(quantity / 1000)} L`
  }
  return `${trimZeros(quantity)} ${unit}`
}

function trimZeros(n: number): string {
  // Up to 2 decimals, trim trailing zeros: 1.50 → "1.5", 250.00 → "250".
  return n
    .toFixed(2)
    .replace(/\.?0+$/, "")
}
