"use client"

/**
 * «Envíos al carro del súper» en Perfil (D-154, specs/shop-orders.md): los
 * avisos que aceptó esta cuenta, uno por cadena, con «Desactivar». Desactivar
 * borra lo aceptado y el siguiente «Enviar a <cadena>» vuelve a enseñar el
 * aviso. Sin nada aceptado, no se pinta. La extensión se quita en el navegador.
 */
import { useBasketConsents, useRevokeBasketConsent } from "@/hooks/useBasketExtension"

const fecha = (iso: string) => new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" })

export function BasketConsentsCard() {
  const status = useBasketConsents()
  const revoke = useRevokeBasketConsent()
  const consents = status.data?.consents ?? []
  if (consents.length === 0) return null

  return (
    <div data-testid="profile-basket-consents" className="mt-2 border-t border-border-soft py-2">
      <div className="text-[14px] font-medium text-ink">Envíos al carro del súper</div>
      <ul className="mt-1 space-y-1">
        {consents.map((c) => (
          <li key={c.cadena} className="flex min-h-[44px] items-center justify-between gap-3">
            <div className="min-w-0 text-[12px] text-ink-muted">
              <span className="text-ink">{c.etiqueta}</span> · activado el {fecha(c.acceptedAt)}
            </div>
            <button
              type="button"
              disabled={revoke.isPending}
              onClick={() => revoke.mutate(c.cadena)}
              className="shrink-0 rounded-full border border-border-soft px-3 py-1.5 text-[12px] font-medium text-ink disabled:opacity-50"
            >
              Desactivar
            </button>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-ink-muted">Para quitar la extensión: en tu navegador, Extensiones → Quitar.</p>
      {revoke.isError && (
        <p role="alert" className="text-[12px] text-[#8A3B22]">
          No hemos podido desactivarlo. Prueba de nuevo en un momento.
        </p>
      )}
    </div>
  )
}
