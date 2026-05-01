/**
 * Centralized Spanish display labels for recipe-related enums.
 *
 * Single source of truth — every UI surface that renders a meal /
 * season / difficulty value must import from here. Keeps copy
 * consistent and avoids accent-stripped fallbacks leaking into the
 * UI ("autumn" → "Otoño", never "Otono").
 */

import type { Meal, Season, Difficulty } from "@ona/shared"

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
