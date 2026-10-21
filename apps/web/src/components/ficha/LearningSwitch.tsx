"use client"

/**
 * «Aprender de lo que hago» (PRO-318, RGPD art. 21): per person, in the
 * reader's own part of «Tu ficha». A real switch (`role="switch"`), 52×32 with
 * a 44 px hit area. Forest when on, as in the design Miguel approved on
 * 2026-10-21 — the only green the D guard allows on the profile pages
 * (apps/api/src/tests/redesignDSubPerfil.test.ts). Off is ink-soft so the
 * track keeps 3:1 against the paper card.
 */
import type { RefObject } from "react"
import { FICHA_CARD } from "./FichaUI"

export function LearningSwitch({
  on,
  pending,
  onToggle,
  switchRef,
}: {
  on: boolean
  pending: boolean
  /** Called with the new `paused` value. */
  onToggle: (paused: boolean) => void
  switchRef?: RefObject<HTMLButtonElement | null>
}) {
  return (
    <section aria-labelledby="aprendo-titulo" className={`${FICHA_CARD} flex scroll-mt-24 flex-col gap-3 p-4`} id="aprender" data-testid="ficha-learning">
      <div className="flex items-center justify-between gap-3">
        <h2 id="aprendo-titulo" className="text-[15.5px] font-semibold text-ink">
          Aprender de lo que hago
        </h2>
        <button
          ref={switchRef}
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby="aprendo-titulo"
          aria-describedby="aprendo-texto"
          disabled={pending}
          onClick={() => onToggle(on)}
          className={`relative h-8 w-[52px] shrink-0 rounded-full transition-colors after:absolute after:inset-[-6px] after:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-70 ${
            on ? "bg-forest" : "bg-ink-soft"
          }`}
        >
          <span
            aria-hidden="true"
            className={`absolute top-[3px] h-[26px] w-[26px] rounded-full bg-paper shadow-sm transition-[left] duration-200 motion-reduce:transition-none ${
              on ? "left-[23px]" : "left-[3px]"
            }`}
          />
        </button>
      </div>
      <p id="aprendo-texto" className="text-[14px] leading-[1.5] text-ink-mid">
        Cada noche aprendo de lo que haces tú: lo que cambias del menú, lo que me cuentas y lo que marcas en la compra. Si lo pausas, lo que ya sé se queda y puedes corregirlo u olvidarlo; solo dejo de apuntar cosas nuevas sobre ti.
      </p>
    </section>
  )
}
