import express from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import { env } from './config/env.js'
import { errorHandler } from './middleware/errorHandler.js'
import {
  captureServerErrors,
  installConsoleErrorCapture,
  installProcessErrorHandlers,
  observeServerErrors,
} from './middleware/errorCapture.js'
import authRoutes from './routes/auth.js'
import publicConfigRoutes from './routes/publicConfig.js'
import versionRoutes from './routes/version.js'
import userRoutes from './routes/users.js'
import recipeRoutes from './routes/recipes.js'
import ingredientRoutes from './routes/ingredients.js'
import menuRoutes from './routes/menus.js'
import shoppingRoutes from './routes/shopping.js'
import advisorRoutes from './routes/advisor.js'
import assistantRoutes from './routes/assistant.js'
import ttsRoutes from './routes/tts.js'
import sttRoutes from './routes/stt.js'
import adminRoutes from './routes/admin.js'
import unitsRouter from './routes/units.js'
import memoryRoutes from './routes/memory.js'
import householdRoutes, { publicHouseholdRouter } from './routes/households.js'
import cookLogRoutes from './routes/cookLogs.js'
import staplesRoutes from './routes/staples.js'
import pushRoutes from './routes/push.js'
import notificationRoutes from './routes/notifications.js'
import recipeNotesRoutes from './routes/recipeNotes.js'
import pantryRoutes from './routes/pantry.js'
import cookbooksRoutes from './routes/cookbooks.js'
import recipePhotosRoutes from './routes/recipePhotos.js'
import whatsappRoutes, { whatsappWebhookRouter } from './routes/whatsapp.js'
import telegramRoutes from './routes/telegram.js'
import metricsRoutes from './routes/metrics.js'
import shopOrdersRoutes, { publicShopOrdersRouter } from './routes/shopOrders.js'
import appErrorsRoutes, { clientErrorsRouter } from './routes/appErrors.js'
import waitlistRoutes, { adminWaitlistRouter } from './routes/waitlist.js'
import newsletterRoutes from './routes/newsletter.js'
import emailSinkRoutes from './routes/emailSink.js'
import usageRoutes from './routes/usage.js'
import inviteCampaignRoutes from './routes/inviteCampaigns.js'
import billingRoutes, { billingWebhookRouter } from './routes/billing.js'
import priceSurveyRoutes from './routes/priceSurvey.js'
import feedbackRoutes from './routes/feedback.js'
import tasteRoutes from './routes/taste.js'
import noticesRoutes from './routes/notices.js'
import { startAfinaNotice } from './services/afinaNotice.js'
import catalogWishesRoutes from './routes/catalogWishes.js'
import catalogReviewRoutes from './routes/catalogReview.js'
import { interruptStaleCatalogImports } from './services/catalogImportJobs.js'
import { startCatalogPhotos } from './services/catalogPhotos.js'
import householdHabitsRoutes from './routes/householdHabits.js'
import householdProfileRoutes from './routes/householdProfile.js'
import schoolMenuRoutes from './routes/schoolMenu.js'
import blindComparisonRoutes from './routes/blindComparison.js'
import { trackShoppingActivity } from './services/activityEvents.js'
import { trackUsageRoutes } from './services/usageEvents.js'
import { warnDroppedExtraRefSources } from './services/agentView.js'
import { startScheduler } from './services/notificationScheduler.js'

// In-house error tracker (specs/errors.md): remember what handlers log with
// console.error while serving a request, and record unhandled rejections.
installConsoleErrorCapture()
installProcessErrorHandlers()

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
// Records every 5xx response in `app_errors` (observes only; mounted first so
// each request runs in its error context). See middleware/errorCapture.ts.
app.use(observeServerErrors)
// WhatsApp webhook verifies an HMAC over the raw body, so it must see the
// bytes before `express.json()` consumes the stream. It parses its own body.
app.use(whatsappWebhookRouter)
// Stripe signs the raw body too (specs/billing.md).
app.use(billingWebhookRouter)
// POST /client-errors reads its own body with a hard 8 KB cap (any content
// type — the browser beacon sends text/plain), so it goes before express.json().
app.use(clientErrorsRouter)
// Admin «Recetas pendientes» (specs/catalog-import.md): a batch file can pass
// the global 100 KB body limit, so its import routes read their own body (2 MB)
// after the admin check. Per-route auth, no catch-all.
app.use(catalogReviewRoutes)
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
// Logs shopping-list item mutations (2xx) for the business metrics'
// "resolved week" — observes the response, never changes it.
app.use(trackShoppingActivity)
// Product analytics (specs/metrics.md "Usage events"): records signups,
// menus, imports… once the route answers 2xx. Observes only.
app.use(trackUsageRoutes)

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
// The deployed commit (PRO-365): public, no cache, no DB read.
app.use(versionRoutes)

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
// Public config (PRO-167): the registration mode the web follows.
app.use(publicConfigRoutes)
app.use(publicHouseholdRouter)
// Public short links (/shop-orders/link/:token) for the order messages.
app.use(publicShopOrdersRouter)
// Pre-launch waitlist (public: signup, referral count, opt-out).
app.use(waitlistRoutes)
// Newsletter: public one-click opt-out + admin send (per-route auth, PRO-94).
app.use(newsletterRoutes)
// Staging mail sink for test addresses (EMAIL_SINK_DOMAINS; off on production).
app.use(emailSinkRoutes)
// Per-route authMiddleware (no catch-all), before userRoutes.
app.use(billingRoutes)
app.use(priceSurveyRoutes)
app.use(feedbackRoutes)
// «Afina tu menú» (PRO-146): per-route auth.
app.use(tasteRoutes)
app.use(noticesRoutes)
app.use(catalogWishesRoutes)
// How the household cooks (PRO-217): per-route auth.
app.use(householdHabitsRoutes)
// «Tu ficha» (PRO-317): per-route auth.
app.use(householdProfileRoutes)
// Menú del cole (PRO-224): per-route auth.
app.use(schoolMenuRoutes)
// Menú inteligente: comparación a ciegas en los hogares de prueba (PRO-256).
app.use(blindComparisonRoutes)
app.use(recipeRoutes)
app.use(ingredientRoutes)
// pushRoutes is mostly auth-protected (per-route authMiddleware) but the
// `GET /push/public-key` endpoint is intentionally public — must be
// mounted BEFORE userRoutes so the catch-all auth there doesn't block it.
app.use(pushRoutes)
// «Avisos» in Perfil (PRO-237): per-route auth.
app.use(notificationRoutes)
app.use(usageRoutes)
// Per-route authMiddleware (no catch-all) — kept next to pushRoutes for the
// same mount-order reason.
app.use(whatsappRoutes)
// Mimo on Telegram (PRO-313): public webhook (secret header) + per-route auth; 404 while off.
app.use(telegramRoutes)
// GET /admin/metrics accepts `x-metrics-token` instead of a JWT, so it must
// be mounted before the catch-all `router.use(authMiddleware)` routers below.
app.use(metricsRoutes)
// Same reason: GET /admin/errors also accepts `x-metrics-token`.
app.use(appErrorsRoutes)
// Same reason: GET /admin/waitlist accepts `x-metrics-token` (invite is admin JWT only).
app.use(adminWaitlistRouter)
app.use(inviteCampaignRoutes)
app.use(userRoutes)
app.use(menuRoutes)
app.use(shoppingRoutes)
app.use(advisorRoutes)
app.use(assistantRoutes)
app.use(ttsRoutes)
app.use(sttRoutes)
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
app.use(shopOrdersRoutes)

// Error handler — captureServerErrors records the error, then hands it to
// errorHandler unchanged.
app.use(captureServerErrors)
app.use(errorHandler)

app.listen(env.PORT, () => {
  console.log(`Mimoia API running on port ${env.PORT}`)
  // How many extra `?ref=` labels for the read token were dropped (never which).
  warnDroppedExtraRefSources()
  // Notification scheduler — periodic poll over `notification_schedule`
  // dispatches due prep alerts via Web Push. Started once at boot;
  // idempotent if startup runs twice. See PR-D / notifications spec.
  startScheduler()
  // PRO-205: the one-off «Afina tu menú» notice (once per database and household).
  startAfinaNotice()
  // A catalogue import left «running» died with the previous process (a deploy).
  void interruptStaleCatalogImports()
  // Catalogue photos are made before a recipe goes out (and for any published without one).
  startCatalogPhotos()
})

export default app
