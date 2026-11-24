import { Router } from 'express'
import { claimOptInReoffer, withReofferLine } from '../services/whatsapp/optInOffer.js'
import { db } from '../db/connection.js'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import { chat } from '../services/assistant/engine.js'
import type { ChatMessage } from '../services/assistant/types.js'
import { BUDGET_WARNING_LINE, checkAdvisorBudget, crossesBudgetWarning, recordAdvisorUsage } from '../services/advisorBudget.js'
import { spendCapStatus } from '../services/spendCap.js'
import { capHitThisMonth, recordCapHit, type CapKind } from '../services/capHits.js'
import { asksSomething, capNoticeApp, capNoticeAppShort, reachesCap } from '../services/capNotice.js'
import { API_SALDO_REPLY, API_SALDO_TYPE, noteApiBalanceError } from '../services/apiSaldo.js'
import { requirePaidPlan } from '../services/accountAccess.js'
import { asc, eq } from 'drizzle-orm'
import { recipes, recipeSteps } from '../db/schema.js'
import { cookStepOf, describePage, pageContextNote, withPageContext } from '../services/assistant/pageContext.js'
import { canViewRecipe } from '../services/recipeVisibility.js'
import type { AssistantMode } from '../services/assistant/systemPrompt.js'
import { recordWebChatTurn } from '../services/chatMessages.js'
import { generatedMenuThisTurn, withSnowballLine } from '../services/menuText.js'
import { generatedWeeksOf } from '../services/menuWeek.js'
import { listCodeReply, menuCodeReply, recognizeCodeIntent, stepCodeReply, type CodeReplyKind } from '../services/assistant/codeReply.js'
import { channelOfMode, trackEvent } from '../services/usageEvents.js'
import type { AssistantResponse } from '../services/assistant/types.js'

/** Web modes: the companion's chat and voice, and the voice onboarding. WhatsApp has its own route. */
const WEB_MODES: AssistantMode[] = ['text', 'voice', 'onboarding']

const router = Router()

// All routes require auth
router.use(authMiddleware)

// POST /assistant/:userId/chat
router.post('/assistant/:userId/chat', requirePaidPlan(), async (req: AuthRequest, res) => {
  try {
    const userId = String(req.params.userId)

    // A caller may only chat as themselves — the chat loads this user's
    // context and bills this user's budget, so a mismatched id is a 403.
    if (userId !== req.userId) {
      res.status(403).json({ error: 'No puedes usar el asistente de otro usuario.' })
      return
    }

    const { message, history } = req.body
    const mode: AssistantMode = WEB_MODES.includes(req.body?.mode) ? req.body.mode : 'text'
    const path = typeof req.body?.context?.path === 'string' ? req.body.context.path.slice(0, 200) : null
    const cookStep = cookStepOf(req.body?.context?.cookStep)

    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'Message is required' })
      return
    }

    // PRO-1292: «¿qué hay hoy?», «mándame el menú», «la lista» (PRO-1302) and,
    // in cook mode, «siguiente» / «anterior» / «repite» are answered by the
    // code — no model, no cost, also with the monthly cap used up (PRO-1302:
    // the caps are checked after this). Anything more goes on below.
    if (mode !== 'onboarding') {
      try {
        const coded = await answerByCode(userId, message, mode, describePage(path), cookStep)
        if (coded) {
          trackEvent('mimo_code_reply', { userId, channel: channelOfMode(mode), props: { kind: coded.kind } })
          try {
            await recordWebChatTurn({ userId, userMessage: message, response: coded.response, mode, path, ms: 0 }, db)
          } catch (e) {
            console.warn('[assistant] recordWebChatTurn failed (continuing):', e)
          }
          res.json(coded.response)
          return
        }
      } catch (e) {
        console.warn('[assistant] code reply failed (the model answers):', e)
      }
    }

    const chatHistory: ChatMessage[] = Array.isArray(history) ? history : []

    // Monthly caps, before spending any tokens: the one on all paid AI
    // (spendCap.ts, admins exempt) and Mimo's own € budget. Reset next month.
    const budget = await checkAdvisorBudget(userId, db)
    const capped = await capReached(userId, req.user?.role === 'admin', budget)
    // PRO-1302: the turn that reached the cap ended asking something (and
    // nobody has been told yet): this answer finishes it, once.
    let grace = false
    if (capped) {
      const lastWords = [...chatHistory].reverse().find((m) => m?.role === 'assistant')?.content
      grace = mode !== 'onboarding' && asksSomething(lastWords) && !(await capHitThisMonth(userId, new Date(), db))
      if (!grace) {
        // PRO-1090: the first time this month, a cap_hits row (admins
        // excluded) — PRO-1302: and the whole notice; after that, one line.
        const first = await recordCapHit({ userId, cap: capped.cap, spentEur: capped.spentEur, capEur: capped.capEur, channel: 'app' })
        res.status(429).json({
          error: first ? capNoticeApp(capped.capEur) : capNoticeAppShort(capped.capEur),
          code: capped.code,
          spentEur: Math.round(capped.spentEur * 100) / 100,
          capEur: capped.capEur,
        })
        return
      }
    }

    // Floating companion (D-023): what the user is looking at travels with the message.
    const page = describePage(path)
    let recipeName: string | null = null
    if (page.recipeId) {
      const [r] = await db.select({ name: recipes.name, authorId: recipes.authorId }).from(recipes).where(eq(recipes.id, page.recipeId)).limit(1)
      // Only recipes this user may see: someone else's private recipe stays unnamed.
      recipeName = r && (await canViewRecipe(userId, r.authorId)) ? r.name : null
    }
    const modelMessage = mode === 'onboarding' ? message : withPageContext(message, pageContextNote(page, recipeName, page.kind === 'cooking' ? cookStep : null))

    const startedAt = Date.now()
    const { usage, ...response } = await chat(userId, modelMessage, chatHistory, db, { mode, page: page.kind })

    // «Efecto bola de nieve» (PRO-170): after generating a menu in the
    // household's first generated weeks, the reply opens with the same line
    // WhatsApp puts above «Listo: …». No count → no line; the reply still goes.
    if (generatedMenuThisTurn(response.toolsUsed)) {
      try {
        response.message = withSnowballLine(response.message, await generatedWeeksOf(userId, db))
      } catch (e) {
        console.warn('[assistant] generated weeks count failed (no snowball line):', e)
      }
    }

    // PRO-248: whoever has WhatsApp linked and never answered the avisos
    // question hears it one more time, here or on WhatsApp (whichever comes
    // first), after their first week with a menu and the list.
    // Never in the same reply as an invite offer.
    if (mode !== 'onboarding' && !response.offerAdded) {
      try {
        if (await claimOptInReoffer(userId, new Date(), db)) response.message = withReofferLine(response.message)
      } catch (e) {
        console.warn('[assistant] avisos re-offer check failed (continuing):', e)
      }
    }

    // Meter this turn's real token cost against the monthly budget. Awaited so
    // the next request sees the updated total, but a metering failure must not
    // fail the chat the user already paid for — swallow and log.
    try {
      const added = await recordAdvisorUsage(userId, usage, db)
      // PRO-1302: the turn that reaches the cap ends whole, with the notice
      // (once a month) — unless it asks something: the answer finishes it.
      if (grace || (reachesCap(budget.spentMicros, added, budget.budgetMicros) && !asksSomething(response.message))) {
        const capEur = capped?.capEur ?? budget.budgetMicros / 1_000_000
        const spentEur = capped?.spentEur ?? (budget.spentMicros + added) / 1_000_000
        if (await recordCapHit({ userId, cap: capped?.cap ?? 'asistente', spentEur, capEur, channel: 'app' }, db)) {
          response.message = `${response.message}\n\n${capNoticeApp(capEur)}`
        }
      } else if (crossesBudgetWarning(budget.spentMicros, added, budget.budgetMicros)) {
        // 18-nov: the turn that takes the month past 80 % of the cap says so, once.
        response.message = `${response.message}\n\n${BUDGET_WARNING_LINE}`
      }
    } catch (e) {
      console.warn('[assistant] recordAdvisorUsage failed (continuing):', e)
    }

    // Keep the turn server-side for 90 days (PRO-148): the user's own words
    // (without the page note) and Mimo's reply with what it did. A failure
    // here must not fail the chat — swallow and log.
    try {
      await recordWebChatTurn({ userId, userMessage: message, response, mode, path, ms: Date.now() - startedAt }, db)
    } catch (e) {
      console.warn('[assistant] recordWebChatTurn failed (continuing):', e)
    }

    res.json(response)
  } catch (err: any) {
    console.error('Assistant chat error:', err.message)
    // PRO-1101: Anthropic sin saldo → Mimo lo dice con su texto, no un error genérico (y queda apuntado).
    if (noteApiBalanceError(err)) {
      res.json({ message: API_SALDO_REPLY, actionTaken: false, corrections: [API_SALDO_TYPE] })
      return
    }
    res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * The cap this user has used up this month, or null: first the one on all paid
 * AI (spendCap.ts; admins exempt), then Mimo's own € budget.
 */
async function capReached(
  userId: string,
  isAdmin: boolean,
  budget: { exceeded: boolean; spentMicros: number; budgetMicros: number },
): Promise<{ cap: CapKind; code: 'SPEND_CAP_EXCEEDED' | 'ADVISOR_BUDGET_EXCEEDED'; spentEur: number; capEur: number } | null> {
  if (!isAdmin) {
    const all = await spendCapStatus(userId)
    if (all.exceeded) return { cap: 'ia', code: 'SPEND_CAP_EXCEEDED', spentEur: all.spentEur, capEur: all.capEur }
  }
  if (budget.exceeded) return { cap: 'asistente', code: 'ADVISOR_BUDGET_EXCEEDED', spentEur: budget.spentMicros / 1_000_000, capEur: budget.budgetMicros / 1_000_000 }
  return null
}

/**
 * PRO-1292: the reply the code gives (and its kind for `mimo_code_reply`), or
 * null when the model has to answer. The step is read from the recipe on
 * screen, only if this user may see it and the step the web sent fits it.
 */
async function answerByCode(
  userId: string,
  message: string,
  mode: AssistantMode,
  page: ReturnType<typeof describePage>,
  cookStep: ReturnType<typeof cookStepOf>,
): Promise<{ kind: CodeReplyKind; response: AssistantResponse } | null> {
  const cooking = page.kind === 'cooking' && !!page.recipeId && !!cookStep
  const intent = recognizeCodeIntent(message, { cooking })
  if (!intent) return null
  if (intent.kind === 'ver_menu') {
    const response = await menuCodeReply(intent, { userId, db, channel: mode })
    return response ? { kind: 'ver_menu', response } : null
  }
  if (intent.kind === 'ver_lista') {
    const response = await listCodeReply({ userId, db, channel: mode })
    return response ? { kind: 'ver_lista', response } : null
  }
  const [r] = await db.select({ authorId: recipes.authorId }).from(recipes).where(eq(recipes.id, page.recipeId!)).limit(1)
  if (!r || !(await canViewRecipe(userId, r.authorId))) return null
  const steps = await db.select({ text: recipeSteps.text }).from(recipeSteps).where(eq(recipeSteps.recipeId, page.recipeId!)).orderBy(asc(recipeSteps.index))
  if (steps.length !== cookStep!.total) return null
  const response = stepCodeReply(steps.map((s: { text: string }) => s.text), cookStep!, intent.direction)
  return response ? { kind: 'paso_cocina', response } : null
}

export default router
