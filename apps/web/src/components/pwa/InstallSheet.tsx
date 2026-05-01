"use client"

import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "motion/react"
import { X, Share2, Plus, Smartphone } from "lucide-react"
import { getInstallPromptState, triggerInstall, dismissForDays } from "@/lib/pwa/installPrompt"
import { haptic } from "@/lib/pwa/haptics"

export default function InstallSheet() {
  const [open, setOpen] = useState(false)
  const [isIOS, setIsIOS] = useState(false)

  useEffect(() => {
    // Re-check periodically (visits get incremented elsewhere)
    function check() {
      const s = getInstallPromptState()
      setOpen(s.shouldShow)
      setIsIOS(s.isIOS)
    }
    check()
    const interval = setInterval(check, 2000)
    return () => clearInterval(interval)
  }, [])

  function handleInstall() {
    haptic.medium()
    triggerInstall().then((res) => {
      if (res.outcome === "accepted" || res.outcome === "dismissed") {
        setOpen(false)
      }
    })
  }

  function handleLater() {
    haptic.light()
    dismissForDays(30)
    setOpen(false)
  }

  function handleNever() {
    haptic.light()
    dismissForDays(365)
    setOpen(false)
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleLater}
          />
          {/* Sheet */}
          <motion.div
            role="dialog"
            aria-modal="true"
            className="fixed bottom-0 left-0 right-0 z-50 mx-auto max-w-[430px] rounded-t-3xl bg-cream p-6 shadow-2xl"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 24px)" }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ ease: [0.19, 1, 0.22, 1], duration: 0.35 }}
          >
            <button
              onClick={handleLater}
              aria-label="Cerrar"
              className="absolute top-4 right-4 flex h-8 w-8 items-center justify-center rounded-full bg-paper text-ink-soft"
            >
              <X size={16} />
            </button>

            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-paper">
              <Smartphone size={26} className="text-ink" />
            </div>

            <h2 className="font-display text-2xl text-ink">Añade ONA a tu inicio</h2>
            <p className="mt-2 text-sm text-ink-soft">
              Cocina sin pestañas: abre ONA con un toque desde tu pantalla de inicio.
            </p>

            {isIOS ? (
              <div className="mt-5 rounded-2xl border border-border bg-paper p-4 text-sm text-ink-soft">
                <p className="font-medium text-ink">Cómo instalar en iPhone:</p>
                <ol className="mt-2 space-y-2">
                  <li className="flex items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cream font-medium text-ink">1</span>
                    Toca <Share2 size={14} className="inline align-middle" /> en la barra de Safari
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cream font-medium text-ink">2</span>
                    Selecciona <span className="inline-flex items-center gap-1"><Plus size={14} /> Añadir a pantalla de inicio</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cream font-medium text-ink">3</span>
                    Confirma con &quot;Añadir&quot;
                  </li>
                </ol>
              </div>
            ) : (
              <button
                onClick={handleInstall}
                className="mt-5 w-full rounded-full bg-ink py-3 text-sm font-medium text-cream shadow-md active:scale-[0.98]"
              >
                Añadir a inicio
              </button>
            )}

            <div className="mt-3 flex items-center justify-between text-xs text-ink-soft">
              <button onClick={handleLater} className="underline">Más tarde</button>
              <button onClick={handleNever} className="underline">No mostrar otra vez</button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
