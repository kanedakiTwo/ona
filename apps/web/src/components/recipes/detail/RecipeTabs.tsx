"use client"

import { useRef, type KeyboardEvent } from "react"

export interface RecipeTab<K extends string> {
  key: K
  label: string
}

interface Props<K extends string> {
  tabs: RecipeTab<K>[]
  active: K
  onChange: (key: K) => void
  /** Prefix for the tab / panel ids: tab = `${idPrefix}-tab-${key}`, panel = `${idPrefix}-panel-${key}`. */
  idPrefix: string
  /** Classes for the outer wrapper (e.g. sticky positioning + background). */
  className?: string
}

export const recipeTabId = (prefix: string, key: string) => `${prefix}-tab-${key}`
export const recipePanelId = (prefix: string, key: string) => `${prefix}-panel-${key}`

/**
 * WAI-ARIA tablist with automatic activation: ←/→ move (and select) between
 * tabs, Home/End jump to the first/last one. Only the selected tab is in the
 * tab order (roving tabindex); the panel itself is the next stop.
 */
export function RecipeTabs<K extends string>({ tabs, active, onChange, idPrefix, className = "" }: Props<K>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])

  function focusAt(i: number) {
    const n = tabs.length
    const next = ((i % n) + n) % n
    onChange(tabs[next].key)
    refs.current[next]?.focus()
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    if (e.key === "ArrowRight") focusAt(i + 1)
    else if (e.key === "ArrowLeft") focusAt(i - 1)
    else if (e.key === "Home") focusAt(0)
    else if (e.key === "End") focusAt(tabs.length - 1)
    else return
    e.preventDefault()
  }

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label="Secciones de la receta"
        className="flex gap-[22px] overflow-x-auto shadow-[inset_0_-1px_0_#DDD6C5] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((tab, i) => {
          const selected = tab.key === active
          return (
            <button
              key={tab.key}
              ref={(el) => {
                refs.current[i] = el
              }}
              type="button"
              role="tab"
              id={recipeTabId(idPrefix, tab.key)}
              aria-selected={selected}
              aria-controls={recipePanelId(idPrefix, tab.key)}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(tab.key)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={`h-11 shrink-0 whitespace-nowrap border-b-2 text-[15px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1A1612] ${
                selected
                  ? "border-[#1A1612] font-semibold text-[#1A1612]"
                  : "border-transparent text-[#6E655B] hover:text-[#1A1612]"
              }`}
            >
              {tab.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
