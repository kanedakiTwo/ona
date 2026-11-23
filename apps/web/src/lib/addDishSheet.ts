/**
 * PRO-1180 · «Añadir plato» (`AddDishSheet`): choosing first, the draw last
 * (propuesta de Producto 2026-11-11 §5.2: «el azar, siempre dentro de una
 * elección, nunca como primera opción de una hoja»). Until then «Mimoia
 * sugiere» came first, with sparkles.
 */
export const ADD_DISH_OPTIONS = [
  { key: "catalog", label: "Elegir del catálogo" },
  { key: "write", label: "Escribir un plato" },
  { key: "mimoia", label: "Que elija Mimoia" },
] as const

export type AddDishOption = (typeof ADD_DISH_OPTIONS)[number]["key"]
