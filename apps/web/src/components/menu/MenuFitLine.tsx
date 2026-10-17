"use client"

import Link from "next/link"
import type { MenuFit } from "@ona/shared"

/** «carbonara, rodaballo y chuletón» (at most `max`, then «…»). */
function listOf(items: string[], max = 3): string {
  const shown = items.slice(0, max)
  const more = items.length > max
  if (shown.length <= 1) return `${shown[0] ?? ""}${more ? "…" : ""}`
  if (more) return `${shown.join(", ")}…`
  return `${shown.slice(0, -1).join(", ")} y ${shown[shown.length - 1]}`
}

/** Pure: the line under the menu for each level (PRO-155). */
export function menuFitText(fit: MenuFit): string {
  const missing = fit.missed.map((m) => m.preference)
  const notInCatalog = fit.missed.filter((m) => m.reason === "no_catalogo").map((m) => m.preference)
  const pct = `${fit.score} %`
  if (fit.level === "alto") {
    const got = fit.met.map((m) => m.preference)
    return got.length
      ? `Este menú se acerca mucho a lo que os gusta (${pct}): hay ${listOf(got)}.`
      : `Este menú se acerca mucho a lo que os gusta (${pct}).`
  }
  if (fit.level === "medio") {
    return missing.length
      ? `Se acerca bastante a lo que os gusta (${pct}). No he podido meter ${listOf(missing)}; puedes ponerlo en lugar de otro plato.`
      : `Se acerca bastante a lo que os gusta (${pct}).`
  }
  const lacking = notInCatalog.length ? notInCatalog : missing
  return lacking.length
    ? `Con las recetas que tengo no me he acercado mucho a lo que os gusta (${pct}): aún no tengo ${listOf(lacking)}. Si añades tus recetas, las tendré en cuenta.`
    : `Con las recetas que tengo no me he acercado mucho a lo que os gusta (${pct}). Si añades tus recetas, las tendré en cuenta.`
}

/** «Cuánto ha acertado» (PRO-155, specs/menus.md): one line under the generated week. Nothing without a verdict. */
export function MenuFitLine({ fit, className = "" }: { fit?: MenuFit | null; className?: string }) {
  if (!fit) return null
  return (
    <p data-testid="menu-fit" data-level={fit.level} className={`text-[14px] leading-relaxed text-ink-muted ${className}`}>
      {menuFitText(fit)}
      {fit.level === "bajo" && (
        <>
          {" "}
          <Link href="/recipes/new" className="font-medium text-ink underline underline-offset-4 hover:text-terracotta-deep">
            Añadir una receta
          </Link>
        </>
      )}
    </p>
  )
}
