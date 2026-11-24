/**
 * PRO-1041 (Seguridad): allergies said to Mimo and not saved (no health
 * consent, or over WhatsApp) still shape the menu Mimo generates, for that
 * menu only. They are never written anywhere: they ride on the async call
 * that generates the week and `withHouseholdRestrictions` adds them to the
 * saved ones, so every pick inside it (the weekly generator, its dish
 * checks) leaves them out.
 */
import { AsyncLocalStorage } from 'node:async_hooks'

const store = new AsyncLocalStorage<readonly string[]>()

/** Runs `fn` with `restrictions` applied to every menu pick inside it (and only there). */
export function withMenuOnlyRestrictions<T>(restrictions: readonly string[], fn: () => Promise<T>): Promise<T> {
  if (restrictions.length === 0) return fn()
  return store.run([...restrictions], fn)
}

/** The restrictions of the menu being generated right now (empty outside `withMenuOnlyRestrictions`). */
export function menuOnlyRestrictions(): readonly string[] {
  return store.getStore() ?? []
}
