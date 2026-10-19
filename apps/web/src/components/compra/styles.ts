/** Estilos y formato comunes de las tarjetas de /compra (OrderCard, ExtensionOrder). */

export const primaryBtn =
  "inline-flex items-center justify-center gap-2 rounded-full bg-[#1A1612] px-5 py-2.5 text-[12px] uppercase tracking-[0.12em] text-[#FAF6EE] disabled:opacity-40"
export const ghostBtn = "inline-flex items-center gap-1.5 text-[12px] text-[#7A7066] hover:text-[#1A1612]"

/** 42.5 → «42,5 €»; sin importe, «—». */
export const eur = (n: number | null | undefined) => (n == null ? "—" : `${String(Math.round(n * 100) / 100).replace(".", ",")} €`)
