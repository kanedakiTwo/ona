"use client"

import { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Sparkles, Search, Coffee, X } from 'lucide-react'
import { RecipePickerSheet } from './RecipePickerSheet'
import type { Course } from '@ona/shared'

interface Props {
  open: boolean
  onClose: () => void
  /** For Aleatorio — informs the hint copy. */
  nextMissingCourse?: Course | null
  onPickAleatorio: () => void
  onPickRecipe: (recipeId: string, recipeName: string) => void
  onAddNote: (text: string) => void
  /** Context for the picker sheet header (e.g. "Comida del lunes"). */
  slotLabel?: string
}

export function AddDishSheet({
  open,
  onClose,
  nextMissingCourse,
  onPickAleatorio,
  onPickRecipe,
  onAddNote,
  slotLabel,
}: Props) {
  const [mode, setMode] = useState<'choose' | 'picker' | 'note'>('choose')
  const [noteText, setNoteText] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)

  function reset() {
    setMode('choose')
    setNoteText('')
    onClose()
  }

  const courseHint =
    nextMissingCourse === 'starter' ? 'Te buscamos un entrante.'
    : nextMissingCourse === 'main' ? 'Te buscamos un principal.'
    : nextMissingCourse === 'dessert' ? 'Te buscamos un postre.'
    : 'Te buscamos una receta que encaje.'

  return (
    <>
      <AnimatePresence>
        {open && mode !== 'picker' && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={reset}
              className="fixed inset-0 z-40 bg-[#1A1612]/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 280 }}
              className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-[430px] rounded-t-3xl bg-[#FAF6EE] p-5 lg:max-w-[500px]"
            >
              <div className="mb-4 flex items-center justify-between">
                <h3 className="font-display text-xl text-[#1A1612]">
                  {mode === 'choose' ? 'Añadir plato' : 'Añadir nota'}
                </h3>
                <button onClick={reset} aria-label="Cerrar">
                  <X size={18} className="text-[#7A7066]" />
                </button>
              </div>

              {mode === 'choose' && (
                <div className="space-y-2">
                  <button
                    onClick={() => { onPickAleatorio(); reset() }}
                    className="flex w-full items-center gap-3 rounded-xl border border-[#DDD6C5] bg-[#FFFEFA] px-4 py-3 text-left hover:border-[#1A1612]"
                  >
                    <Sparkles size={18} className="text-[#C65D38]" />
                    <div>
                      <p className="text-[14px] font-medium text-[#1A1612]">Aleatorio</p>
                      <p className="text-[12px] text-[#7A7066]">{courseHint}</p>
                    </div>
                  </button>

                  <button
                    onClick={() => {
                      setMode('picker')
                      setPickerOpen(true)
                    }}
                    className="flex w-full items-center gap-3 rounded-xl border border-[#DDD6C5] bg-[#FFFEFA] px-4 py-3 text-left hover:border-[#1A1612]"
                  >
                    <Search size={18} className="text-[#7A7066]" />
                    <div>
                      <p className="text-[14px] font-medium text-[#1A1612]">Elegir del catálogo</p>
                      <p className="text-[12px] text-[#7A7066]">Busca por nombre.</p>
                    </div>
                  </button>

                  <button
                    onClick={() => setMode('note')}
                    className="flex w-full items-center gap-3 rounded-xl border border-[#DDD6C5] bg-[#FFFEFA] px-4 py-3 text-left hover:border-[#1A1612]"
                  >
                    <Coffee size={18} className="text-[#7A7066]" />
                    <div>
                      <p className="text-[14px] font-medium text-[#1A1612]">Añadir nota</p>
                      <p className="text-[12px] text-[#7A7066]">"Pan con tomate", "comemos fuera"…</p>
                    </div>
                  </button>
                </div>
              )}

              {mode === 'note' && (
                <div className="space-y-3">
                  <textarea
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value.slice(0, 120))}
                    placeholder="Pan con tomate"
                    rows={3}
                    autoFocus
                    className="w-full rounded-xl border border-[#DDD6C5] bg-[#FFFEFA] px-3 py-2 text-[14px] text-[#1A1612] focus:border-[#1A1612] focus:outline-none"
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-[#7A7066]">{noteText.length}/120</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setMode('choose')}
                        className="text-[11px] uppercase tracking-[0.12em] text-[#7A7066]"
                      >
                        Volver
                      </button>
                      <button
                        onClick={() => { onAddNote(noteText.trim()); reset() }}
                        disabled={!noteText.trim()}
                        className="rounded-full bg-[#1A1612] px-4 py-2 text-[12px] uppercase tracking-[0.12em] text-[#FAF6EE] disabled:opacity-40"
                      >
                        Añadir
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Picker lives outside the main sheet so it can fill the full screen */}
      <RecipePickerSheet
        open={pickerOpen}
        onClose={() => {
          setPickerOpen(false)
          setMode('choose')
          onClose()
        }}
        title={slotLabel ?? 'Añadir plato'}
        subtitle="Busca por nombre"
        onPick={(picked) => {
          onPickRecipe(picked.id, picked.name)
          setPickerOpen(false)
          setMode('choose')
          onClose()
        }}
      />
    </>
  )
}
