/**
 * PRO-72 guard: the menu must not ask for confirmation with the browser's
 * native `window.confirm`. Some browsers never show that window (in-app
 * browsers, automated ones) and count it as «Cancelar», so «Saltar día»,
 * «Quitar comida», «Vetar» and «Vaciar semana» silently did nothing. The menu
 * confirms in its own sheet (`ConfirmSheet` in components/menu/MenuSheet.tsx).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const WEB_SRC = resolve(__dirname, '../../../web/src')
const DIRS = ['components/menu', 'app/menu']

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(tsx?|jsx?)$/.test(name) ? [path] : []
  })
}

/** Drops block and line comments so documentation can still name the API. */
function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

describe('menu confirmations', () => {
  it('no window.confirm / confirm() in components/menu or app/menu', () => {
    const offenders: string[] = []
    for (const dir of DIRS) {
      for (const file of sourceFiles(join(WEB_SRC, dir))) {
        const code = withoutComments(readFileSync(file, 'utf8'))
        if (/(^|[^\w.$]|window\.)confirm\s*\(/.test(code)) offenders.push(relative(WEB_SRC, file))
      }
    }
    expect(offenders).toEqual([])
  })
})
