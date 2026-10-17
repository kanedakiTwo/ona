import type { NextFunction, Request, Response } from 'express'

/** Shape of a recipe id (Postgres `uuid`). */
export const RECIPE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isRecipeId(value: unknown): value is string {
  return typeof value === 'string' && RECIPE_ID_RE.test(value)
}

/**
 * PRO-181: a link with an id that isn't one (cut, old, hand-typed) used to
 * reach the database, which rejected the `uuid` cast — a 500 recorded as an
 * app error. Now it's the same 404 as a recipe that doesn't exist, answered
 * before touching the database (nothing is logged).
 */
export function requireRecipeId(param: string = 'id') {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!isRecipeId(req.params[param])) {
      res.status(404).json({ error: 'Recipe not found' })
      return
    }
    next()
  }
}
