/**
 * Where a full-screen page goes back to, without the browser's back button:
 * the installed app (PWA, `display: standalone`) has none, and on a Windows
 * desktop «Afina tu menú» left the person with no way out (Miguel's friend,
 * 2026-10-21: «no sale menú de navegación para ir atrás o al menú
 * principal»). RootShell remembers the app pages visited in this tab; a page
 * asks which one came before it. Pure apart from the module's small list.
 */

const MAX = 8
let visited: string[] = []

/** Called by RootShell on every page change (same path twice counts once). */
export function rememberPath(path: string): void {
  if (!path || visited[visited.length - 1] === path) return
  visited = [...visited, path].slice(-MAX)
}

/** The last app page visited that isn't `path` (null on a fresh load). */
export function previousPathBefore(path: string): string | null {
  for (let i = visited.length - 1; i >= 0; i--) if (visited[i] !== path) return visited[i]
  return null
}

/** For tests. */
export function resetNavHistory(): void {
  visited = []
}

const SECTIONS: Array<[RegExp, string, string]> = [
  [/^\/profile(\/|$)/, "/profile", "Perfil"],
  [/^\/menu(\/|$)/, "/menu", "Menú"],
  [/^\/(shopping|compra)(\/|$)/, "/shopping", "Compra"],
  [/^\/recipes(\/|$)/, "/recipes", "Recetas"],
]

/**
 * «‹ Perfil» back to the exact page it came from (a profile sub-page stays a
 * sub-page), labelled with its section; from anywhere else, or on a fresh
 * load, «‹ Menú» (the app's home).
 */
export function backTarget(previous: string | null): { href: string; label: string } {
  if (previous) {
    for (const [re, , label] of SECTIONS) if (re.test(previous)) return { href: previous, label }
  }
  return { href: "/menu", label: "Menú" }
}
