/**
 * The ingredients box's state (PRO-1115): the lines read as you type, each
 * one checked against the library (`POST /ingredients/match-lines`, a
 * moment after you stop typing), the «¿cuál?» picks, and `resolveRows`,
 * which turns it all into the recipe's rows when saving (creating the new
 * ones with `POST /ingredients/ensure`).
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import {
  ingredientLineViews,
  nameKey,
  namesToMatch,
  resolveIngredientRows,
  type LineChoice,
  type LineMatch,
  type SavedIngredientRow,
} from "@/lib/ingredientLines"

const DEBOUNCE_MS = 350

async function fetchMatches(names: string[]): Promise<LineMatch[]> {
  const out: LineMatch[] = []
  // The API takes up to 80 names per call.
  for (let i = 0; i < names.length; i += 80) {
    const res = await api.post<{ results: LineMatch[] }>("/ingredients/match-lines", { names: names.slice(i, i + 80) })
    out.push(...res.results)
  }
  return out
}

export function useIngredientLines(text: string, saved: readonly SavedIngredientRow[]) {
  const queryClient = useQueryClient()
  const [matches, setMatches] = useState<Record<string, LineMatch>>({})
  const [choices, setChoices] = useState<Record<string, LineChoice>>({})

  const views = useMemo(() => ingredientLineViews(text, saved, matches, choices), [text, saved, matches, choices])
  const missing = useMemo(
    () => namesToMatch(views).filter((n) => !(nameKey(n) in matches)),
    [views, matches],
  )
  const missingKey = missing.join("\n")

  useEffect(() => {
    if (!missingKey) return
    let cancelled = false
    const timer = setTimeout(() => {
      const names = missingKey.split("\n")
      fetchMatches(names)
        .then((results) => {
          if (cancelled) return
          setMatches((prev) => {
            const next = { ...prev }
            names.forEach((n, i) => {
              if (results[i]) next[nameKey(n)] = results[i]
            })
            return next
          })
        })
        .catch(() => {
          /* the line stays «comprobando…»; saving checks it again */
        })
    }, DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [missingKey])

  const choose = useCallback((key: string, choice: LineChoice) => {
    setChoices((prev) => ({ ...prev, [key]: choice }))
  }, [])

  const resolveRows = useCallback(async () => {
    const rows = await resolveIngredientRows(views, {
      match: fetchMatches,
      ensure: async (names) => {
        const res = await api.post<{ ingredients: Array<{ name: string; id: string; ingredientName: string; created: boolean }> }>(
          "/ingredients/ensure",
          { names },
        )
        if (res.ingredients.some((i) => i.created)) {
          void queryClient.invalidateQueries({ queryKey: ["ingredients"] })
        }
        return res.ingredients
      },
    })
    return rows
  }, [views, queryClient])

  return { views, choose, resolveRows }
}
