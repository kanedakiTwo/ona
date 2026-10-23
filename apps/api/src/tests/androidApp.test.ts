/**
 * The Android app's contract (a Trusted Web Activity of the web): what each flavour opens, what it asks for and
 * what the web declares about it. Reads the files; doesn't compile (CI has no Android SDK). Spec: specs/android-app.md.
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const R = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')
const gradle = R('../../../android/app/build.gradle.kts')
const manifiesto = R('../../../android/app/src/main/AndroidManifest.xml')
const sabor = (nombre: string) => {
  const bloque = new RegExp(`create\\("${nombre}"\\) \\{([\\s\\S]*?)\\n        \\}`).exec(gradle)?.[1] ?? ''
  const res = (k: string) => new RegExp(`resValue\\("string", "${k}", (?:"([^"]*)"|declaracion\\("([^"]*)"\\))\\)`).exec(bloque)
  return {
    sufijo: /applicationIdSuffix = "([^"]+)"/.exec(bloque)?.[1] ?? '',
    host: /manifestPlaceholders\["host"\] = "([^"]+)"/.exec(bloque)?.[1],
    nombre: res('nombre')?.[1],
    inicio: res('url_inicio')?.[1],
    sitio: res('asset_statements')?.[2],
  }
}

describe('Android app (TWA)', () => {
  it('is com.mimoia.app and only asks for internet and notifications', () => {
    expect(/applicationId = "([^"]+)"/.exec(gradle)?.[1]).toBe('com.mimoia.app')
    const permisos = [...manifiesto.matchAll(/uses-permission android:name="([^"]+)"/g)].map((m) => m[1]).sort()
    expect(permisos).toEqual(['android.permission.INTERNET', 'android.permission.POST_NOTIFICATIONS'])
    expect(manifiesto).toContain('android:allowBackup="false"')
    expect(manifiesto).toContain('android:host="${host}"')
  })

  it('«pruebas» opens staging and «tienda» opens mimoia.com, both on /menu inside the app', () => {
    expect(sabor('pruebas')).toEqual({ sufijo: '.pruebas', host: 'ona-web-staging.up.railway.app', nombre: 'Mimoia (pruebas)',
      inicio: 'https://ona-web-staging.up.railway.app/menu?app=android', sitio: 'https://ona-web-staging.up.railway.app' })
    expect(sabor('tienda')).toEqual({ sufijo: '', host: 'mimoia.com', nombre: 'Mimoia',
      inicio: 'https://mimoia.com/menu?app=android', sitio: 'https://mimoia.com' })
  })

  it('the web declares both apps with SHA-256 fingerprints (once it serves assetlinks.json)', () => {
    const f = fileURLToPath(new URL('../../../web/public/.well-known/assetlinks.json', import.meta.url))
    if (!existsSync(f)) return
    const decl = JSON.parse(readFileSync(f, 'utf8')) as Array<{ relation: string[]; target: { namespace: string; package_name: string; sha256_cert_fingerprints: string[] } }>
    expect(decl.map((d) => d.target.package_name).sort()).toEqual(['com.mimoia.app', 'com.mimoia.app.pruebas'])
    for (const d of decl) {
      expect(d.relation).toEqual(['delegate_permission/common.handle_all_urls'])
      expect(d.target.namespace).toBe('android_app')
      expect(d.target.sha256_cert_fingerprints.length).toBeGreaterThan(0)
      for (const h of d.target.sha256_cert_fingerprints) expect(h).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/)
    }
  })
})
