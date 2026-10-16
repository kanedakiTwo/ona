import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { eq, or } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/connection.js'
import { users } from '../db/schema.js'
import { validate } from '../middleware/validate.js'
import { registerSchema, loginSchema, WAITLIST_NEWSLETTER_CONSENT_VERSION } from '@ona/shared'
import {
  REGISTRATION_INVITE_REQUIRED,
  consumeCampaignUse,
  findUsableCampaign,
  isHouseholdInviteUsable,
  registrationAccess,
} from '../services/inviteCampaigns.js'
import { env } from '../config/env.js'
import { consumeToken } from '../services/passwordReset.js'
import { rateLimit } from '../middleware/rateLimit.js'
import { markWaitlistJoined } from '../services/waitlist.js'
import {
  WAITLIST_INVITE_ERRORS,
  checkWaitlistInvite,
  consumeWaitlistInvite,
  releaseWaitlistInvite,
  waitlistInviteForEmail,
} from '../services/waitlistInvites.js'
import { trackEvent } from '../services/usageEvents.js'
import { accountReferralUrl, ensureReferralCode, inviterCodeForSignup } from '../services/accountReferrals.js'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import { welcomeKind } from '../services/accountEmails.js'
import { defaultAccountMailerDeps, requestPasswordReset, sendWelcomeEmail } from '../services/accountMailer.js'

const router = Router()

// Anti-abuse limits on the public auth surface, keyed by client IP. Generous
// enough that a real user (or the smoke suite) never trips them, tight enough
// to stop mass registration and credential-stuffing. See middleware/rateLimit.
// Test harnesses (CI, apps/web/scripts/test-e2e.sh) set RATE_LIMIT_DISABLED=true
// because the e2e suite registers one user per test from localhost; that flag
// is ignored on a deployed runtime (NODE_ENV=production or Railway).
const registerLimiter = rateLimit({
  max: 10,
  windowMs: 60 * 60 * 1000, // 10 new accounts per IP per hour
  message: 'Demasiados registros desde esta red. Inténtalo más tarde.',
})
const loginLimiter = rateLimit({
  max: 20,
  windowMs: 5 * 60 * 1000, // 20 login attempts per IP per 5 minutes
  message: 'Demasiados intentos de inicio de sesión. Espera unos minutos.',
})

// POST /register
router.post('/register', registerLimiter, validate(registerSchema), async (req, res) => {
  try {
    const { username, password, inviteCode, householdInviteToken, newsletterOptIn, waitlistToken, invitedBy } = req.body
    // With a waitlist link the email is the one on the list (lowercase, fixed on the form).
    const email: string = waitlistToken ? String(req.body.email).trim().toLowerCase() : req.body.email

    // Check username/email unique
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(or(eq(users.username, username), eq(users.email, email)))
      .limit(1)

    if (existing.length > 0) {
      res.status(409).json({ error: 'Username or email already exists' })
      return
    }

    // One-time link from the waitlist invitation (PRO-97): it must be valid,
    // unused and for this same email. It is used up below, with the account.
    if (waitlistToken) {
      const state = await checkWaitlistInvite(waitlistToken, email)
      if (state !== 'ok') {
        res.status(state === 'used' ? 410 : 403).json(WAITLIST_INVITE_ERRORS[state])
        return
      }
    }

    // Closed beta (PRO-27): only with an invitation unless REGISTRATION_MODE=open.
    // A valid campaign link is recorded on the account in either mode.
    const campaign = await findUsableCampaign(inviteCode)
    const listInvite =
      env.REGISTRATION_MODE === 'invite' && !campaign && !waitlistToken ? await waitlistInviteForEmail(email) : null
    const access = registrationAccess({
      mode: env.REGISTRATION_MODE,
      isAdminEmail: env.ADMIN_EMAILS.includes(String(email).trim().toLowerCase()),
      campaignOk: campaign != null,
      // The link, or (invited before PRO-97, no link exists) the email alone.
      waitlistInvited: !!waitlistToken || listInvite === 'legacy',
      householdInviteOk:
        env.REGISTRATION_MODE === 'invite' && !campaign ? await isHouseholdInviteUsable(householdInviteToken) : false,
    })
    if (!access) {
      // Invited from the list but came without the link: say how to get in.
      res.status(403).json(listInvite === 'needs_link' ? WAITLIST_INVITE_ERRORS.link_required : REGISTRATION_INVITE_REQUIRED)
      return
    }
    // Use the link up now; if someone used it meanwhile, it no longer lets you in.
    if (waitlistToken && !(await consumeWaitlistInvite(waitlistToken))) {
      res.status(410).json(WAITLIST_INVITE_ERRORS.used)
      return
    }
    // Take the use now; if it ran out meanwhile, the link no longer lets you in.
    const campaignId = campaign && (await consumeCampaignUse(campaign.id)) ? campaign.id : null
    if (access === 'campaign' && !campaignId) {
      if (waitlistToken) await releaseWaitlistInvite(waitlistToken)
      res.status(403).json(REGISTRATION_INVITE_REQUIRED)
      return
    }

    const passwordHash = await bcrypt.hash(password, 10)
    // «Invitar a otro hogar» (PRO-162): the inviter's code (never their email)
    // and where the visit came from. Never blocks or fails the sign-up.
    const invitedByCode = await inviterCodeForSignup(invitedBy, { email, householdInviteToken })
    const { signupSource, utmSource, utmMedium, utmCampaign } = req.body
    const hasAttribution = [signupSource, utmSource, utmMedium, utmCampaign].some((v) => v != null)

    const [user] = await db
      .insert(users)
      .values({
        username,
        email,
        passwordHash,
        ageConfirmedAt: new Date(),
        inviteCampaignId: campaignId,
        invitedByCode,
        signupAttribution: hasAttribution
          ? { source: signupSource ?? null, utmSource: utmSource ?? null, utmMedium: utmMedium ?? null, utmCampaign: utmCampaign ?? null }
          : null,
        // «Primeros pasos» on the first /menu visit (PRO-07): only new sign-ups.
        firstStepsPending: true,
        // Friday newsletter, a separate unticked box (PRO-95, specs/newsletter.md).
        ...(newsletterOptIn === true
          ? {
              newsletterOptIn: true,
              newsletterConsentAt: new Date(),
              newsletterConsentVersion: WAITLIST_NEWSLETTER_CONSENT_VERSION,
            }
          : {}),
      })
      .returning()
      .catch(async (err) => {
        // The account wasn't created (e.g. a concurrent duplicate): give the link back.
        if (waitlistToken) await releaseWaitlistInvite(waitlistToken)
        throw err
      })

    // Auto-create a solo household so every authed read has a valid scope.
    // Falls back silently if the helper can't run (e.g. migration not yet
    // applied) — the auth middleware will catch the missing primary
    // household with code: 'NO_HOUSEHOLD' rather than failing register.
    try {
      const { createSoloHouseholdForNewUser } = await import('../services/householdStore.js')
      await createSoloHouseholdForNewUser(user.id)
    } catch (e) {
      console.error('[register] solo household creation failed (continuing):', e)
    }

    // Their own invitation code (reuses their waitlist code if they had one).
    try {
      await ensureReferralCode(user.id)
    } catch (e: any) {
      console.error('[register] referral code failed (continuing):', e?.message ?? e)
    }

    // Someone from the waitlist (invited or not) has arrived: mark the entry
    // joined. Never blocks or fails the registration (specs/waitlist.md).
    void markWaitlistJoined(email)
    // Product analytics (specs/metrics.md): how they got in, never who.
    trackEvent('signup_completed', { userId: user.id, channel: 'web', props: { access } })
    // Welcome email (specs/email.md): beta, joining a home, or open sign-up.
    // Fire and forget: it never delays or fails the registration.
    void sendWelcomeEmail(
      { email: user.email, kind: welcomeKind({ access, joiningHousehold: !!householdInviteToken }) },
      defaultAccountMailerDeps(),
    ).catch((e) => console.error('[register] welcome email failed (continuing):', e?.message ?? e))

    const token = jwt.sign({ userId: user.id }, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    })
    const { passwordHash: _, ...userWithoutPassword } = user

    res.status(201).json({ token, user: userWithoutPassword })
  } catch (err: any) {
    console.error('Register error:', err)
    res.status(500).json({ error: err?.message || 'Internal server error' })
  }
})

// GET /referrals/me — the account's «Invitar a otro hogar» link (PRO-162).
router.get('/referrals/me', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const code = await ensureReferralCode(req.userId!)
    res.json({ code, link: accountReferralUrl(code) })
  } catch (err: any) {
    console.error('[referrals] me failed:', err?.message ?? err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// POST /login
router.post('/login', loginLimiter, validate(loginSchema), async (req, res) => {
  try {
    const { username, password } = req.body

    // Support login with username OR email
    const [user] = await db
      .select()
      .from(users)
      .where(or(eq(users.username, username), eq(users.email, username)))
      .limit(1)

    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' })
      return
    }

    const valid = await bcrypt.compare(password, user.passwordHash)
    if (!valid) {
      res.status(401).json({ error: 'Invalid credentials' })
      return
    }

    if (user.suspendedAt) {
      res.status(403).json({
        error:
          'Tu cuenta está suspendida. Contacta con el equipo de Mimoia si crees que es un error.',
        code: 'SUSPENDED',
      })
      return
    }

    // Reconcile role from ADMIN_EMAILS on every login. Source of truth is
    // the env var; admin status survives only if the email is still listed.
    const desiredRole = env.ADMIN_EMAILS.includes(user.email.toLowerCase())
      ? 'admin'
      : 'user'
    let role = user.role
    if (role !== desiredRole) {
      const [updated] = await db
        .update(users)
        .set({ role: desiredRole })
        .where(eq(users.id, user.id))
        .returning({ role: users.role })
      role = updated.role
    }

    const token = jwt.sign({ userId: user.id }, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    })

    const { passwordHash, ...userWithoutPassword } = user
    userWithoutPassword.role = role

    res.json({ token, user: userWithoutPassword })
  } catch (err) {
    console.error('Login error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// POST /auth/reset
// Public: trades a one-time password-reset token for a new password.
// Returns 400 with `code: 'TOKEN_INVALID'` if the token is missing,
// already used, or expired — the same shape regardless of which case so the
// page never reveals why a token failed.
const resetSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(6),
})

router.post('/auth/reset', loginLimiter, async (req, res) => {
  try {
    const parsed = resetSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({
        code: 'INVALID_BODY',
        error: 'Datos inválidos.',
        issues: parsed.error.issues,
      })
      return
    }

    await consumeToken(parsed.data.token, parsed.data.password)
    res.json({ ok: true })
  } catch (err) {
    if ((err as { code?: string })?.code === 'TOKEN_INVALID') {
      res.status(400).json({
        code: 'TOKEN_INVALID',
        error: 'El enlace no es válido o ha caducado.',
      })
      return
    }
    console.error('Reset error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// POST /auth/forgot { email }
// Public: «¿Has olvidado la contraseña?». Emails a one-time /reset link valid
// for 1 hour when the email has an active account. Always answers the same
// 200, at once (the email goes out in the background), so the response says
// nothing about whether the account exists.
const forgotSchema = z.object({ email: z.string().trim().email().max(320) })
const forgotLimiter = rateLimit({
  max: 5,
  windowMs: 15 * 60 * 1000, // 5 requests per IP per 15 minutes
  message: 'Demasiadas peticiones. Espera unos minutos.',
})

router.post('/auth/forgot', forgotLimiter, (req, res) => {
  const parsed = forgotSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ code: 'INVALID_EMAIL', error: 'Escribe un email válido.' })
    return
  }
  void requestPasswordReset(parsed.data.email, defaultAccountMailerDeps()).catch((e) =>
    console.error('[auth/forgot] failed:', e?.message ?? e),
  )
  res.json({ ok: true })
})

export default router
