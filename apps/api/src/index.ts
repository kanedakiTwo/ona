import express from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import { env } from './config/env.js'
import { errorHandler } from './middleware/errorHandler.js'
import authRoutes from './routes/auth.js'
import userRoutes from './routes/users.js'
import recipeRoutes from './routes/recipes.js'
import ingredientRoutes from './routes/ingredients.js'
import menuRoutes from './routes/menus.js'
import shoppingRoutes from './routes/shopping.js'
import advisorRoutes from './routes/advisor.js'
import assistantRoutes from './routes/assistant.js'
import realtimeRoutes from './routes/realtime.js'
import adminRoutes from './routes/admin.js'
import unitsRouter from './routes/units.js'
import memoryRoutes from './routes/memory.js'
import householdRoutes, { publicHouseholdRouter } from './routes/households.js'
import cookLogRoutes from './routes/cookLogs.js'
import staplesRoutes from './routes/staples.js'
import pushRoutes from './routes/push.js'
import recipeNotesRoutes from './routes/recipeNotes.js'
import pantryRoutes from './routes/pantry.js'
import cookbooksRoutes from './routes/cookbooks.js'
import recipePhotosRoutes from './routes/recipePhotos.js'
import { startScheduler } from './services/notificationScheduler.js'

const app = express()

// Trust the first proxy hop (Railway's edge) so `req.ip` reflects the real
// client address from `X-Forwarded-For`. Without this the IP-keyed auth rate
// limiter would bucket every request under the proxy's IP and throttle the
// whole world as one. One hop only — don't trust arbitrary client-supplied
// XFF chains.
app.set('trust proxy', 1)

// Middleware
app.use(cors({
  origin: '*',
  exposedHeaders: ['X-Total-Count'],
}))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Static files
const __dirname = path.dirname(fileURLToPath(import.meta.url))
app.use('/public', express.static(path.join(__dirname, '..', 'public')))

// Serve generated recipe images from the volume mount in prod (or the
// `apps/web/public/images/recipes` dir in dev). Filenames include the
// recipe id, so the bytes for a given URL are stable until regeneration —
// long-cache + Cache-Control: immutable. The frontend bumps a `?v=<updatedAt>`
// query when the recipe changes to bust the cache without affecting headers.
app.use(
  '/images/recipes',
  express.static(env.IMAGE_STORAGE_DIR, {
    fallthrough: false,
    immutable: true,
    maxAge: '365d',
  }),
)

// Liveness probe — used by smoke tests and orchestration scripts to detect
// when the server is ready. Public, no auth, no DB read.
app.get('/health', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() })
})

// Routes
// Order matters: routers that call `router.use(authMiddleware)` at the top
// (userRoutes, menuRoutes, shoppingRoutes, advisorRoutes, assistantRoutes,
// memoryRoutes, householdRoutes, realtimeRoutes) intercept ANY request that
// reaches them, even if it doesn't match one of their routes, and reject it
// with 401 — because `router.use(mw)` runs unconditionally. Public-readable
// routers (recipeRoutes, ingredientRoutes, publicHouseholdRouter) and
// individual public routes (e.g. /invites/:token) MUST be mounted first so
// they get a chance to respond before the catch-all auth.
app.use(authRoutes)
app.use(publicHouseholdRouter)
app.use(recipeRoutes)
app.use(ingredientRoutes)
// pushRoutes is mostly auth-protected (per-route authMiddleware) but the
// `GET /push/public-key` endpoint is intentionally public — must be
// mounted BEFORE userRoutes so the catch-all auth there doesn't block it.
app.use(pushRoutes)
app.use(userRoutes)
app.use(menuRoutes)
app.use(shoppingRoutes)
app.use(advisorRoutes)
app.use(assistantRoutes)
app.use(realtimeRoutes)
app.use(adminRoutes)
app.use('/', unitsRouter)
app.use(memoryRoutes)
app.use(householdRoutes)
app.use(cookLogRoutes)
app.use(staplesRoutes)
app.use(recipeNotesRoutes)
app.use(pantryRoutes)
app.use(cookbooksRoutes)
app.use(recipePhotosRoutes)

// Error handler
app.use(errorHandler)

app.listen(env.PORT, () => {
  console.log(`ONA API running on port ${env.PORT}`)
  // Notification scheduler — periodic poll over `notification_schedule`
  // dispatches due prep alerts via Web Push. Started once at boot;
  // idempotent if startup runs twice. See PR-D / notifications spec.
  startScheduler()
})

export default app
