import { z } from 'zod'
import { WEEKDAY_COOKING_CHOICES } from './cookingTime.js'
import type { ActivityLevel, CookingFrequency, HouseholdSize, Priority, Sex } from '../constants/enums.js'
import { cleanAttributionText, normalizeReferralCode, normalizeSource } from './waitlist.js'

export const ROLES = ['user', 'admin'] as const
export type Role = (typeof ROLES)[number]

export interface User {
  id: string
  username: string
  email: string
  /** Authorization role. `admin` is bootstrapped at login from `ADMIN_EMAILS`. */
  role: Role
  /** When set, the account is suspended and login + privileged endpoints reject. */
  suspendedAt?: Date | null
  sex?: Sex
  age?: number
  weight?: number
  height?: number
  activityLevel: ActivityLevel
  /**
   * Number of adults (and children > 10 years) in the household. Drives the
   * shopping-list multiplier together with `kidsCount`.
   */
  adults?: number
  /**
   * Number of children aged 2 to 10. Children <2 are not counted; children
   * >10 are counted as adults. Each kid adds 0.5 portions for shopping.
   */
  kidsCount?: number
  /** @deprecated Use `adults` + `kidsCount`. Kept for legacy reads only. */
  householdSize?: HouseholdSize
  cookingFreq?: CookingFrequency
  restrictions: string[]
  favoriteDishes: string[]
  priority?: Priority
  onboardingDone: boolean
  createdAt: Date
}

export interface UserSettings {
  id: string
  userId: string
  template: DayTemplate[]
}

export interface DayTemplate {
  [meal: string]: boolean
}

export interface OnboardingAnswers {
  adults: number
  kidsCount: number
  cookingFreq: CookingFrequency
  restrictions: string[]
  favoriteDishes: string[]
  priority: Priority
}

// Zod schemas for validation
export const registerSchema = z.object({
  username: z.string().min(3).max(30),
  email: z.string().email(),
  password: z.string().min(6),
  /** «Tengo 14 años o más» (LOPDGDD art. 7, PRO-23): required, must be ticked. */
  ageConfirmed: z.literal(true, {
    errorMap: () => ({ message: 'Para usar Mimoia tienes que tener 14 años o más.' }),
  }),
  /** Campaign invitation code from `mimoia.com/i/<code>` (PRO-27). */
  inviteCode: z.string().trim().toLowerCase().max(32).optional(),
  /** Household invitation token when signing up from `/invites/<token>` (PRO-27). */
  householdInviteToken: z.string().trim().max(128).optional(),
  /** One-time link from the waitlist invitation email, `/entrar/<token>` (PRO-97). */
  waitlistToken: z.string().trim().max(128).optional(),
  /** «Quiero recibir cada viernes el menú de la semana por email» (PRO-95): separate, optional, unticked. */
  newsletterOptIn: z.boolean().optional(),
  /**
   * Attribution carried from the landing (PRO-162): `?invita=<code>` of whoever
   * invited them, `?ref=` and `utm_*`. Bad values are dropped, never an error.
   */
  invitedBy: z.unknown().transform(normalizeReferralCode).optional(),
  signupSource: z.unknown().transform(normalizeSource).optional(),
  utmSource: z.unknown().transform((v) => cleanAttributionText(v, 100)).optional(),
  utmMedium: z.unknown().transform((v) => cleanAttributionText(v, 100)).optional(),
  utmCampaign: z.unknown().transform((v) => cleanAttributionText(v, 100)).optional(),
})

export const loginSchema = z.object({
  username: z.string(),
  password: z.string(),
})

export const onboardingSchema = z.object({
  adults: z.number().int().min(1).max(20),
  kidsCount: z.number().int().min(0).max(20),
  cookingFreq: z.enum(['daily', '3_4_times', 'rarely']),
  restrictions: z.array(z.string()),
  /** Legacy (PRO-146): «Afina tu menú» replaced the three favourite dishes; still accepted, no longer asked. */
  favoriteDishes: z.array(z.string()).max(5).default([]),
  priority: z.enum(['quick', 'varied', 'healthy', 'cheap']),
  /**
   * The separate, unticked health-data box (RGPD art. 9, PRO-21). Without it
   * `restrictions` is not stored.
   */
  healthConsent: z.boolean().optional(),
  /**
   * PRO-138: «Entre semana, ¿cómo te gusta cocinar?» — stored as
   * `time_available` in the memory. Optional: Mimo's WhatsApp onboarding
   * doesn't ask it.
   */
  weekdayCooking: z.enum(WEEKDAY_COOKING_CHOICES).optional(),
  /** «¿Algo más? Cuéntanos tu caso» — free text the AI reads into the memory. */
  cookingNote: z.string().trim().max(500).optional(),
})

export const updateProfileSchema = z.object({
  sex: z.enum(['male', 'female']).optional(),
  age: z.number().int().min(1).max(120).optional(),
  weight: z.number().min(20).max(300).optional(),
  height: z.number().min(50).max(250).optional(),
  activityLevel: z.enum(['none', 'light', 'moderate', 'high']).optional(),
  adults: z.number().int().min(1).max(20).optional(),
  kidsCount: z.number().int().min(0).max(20).optional(),
  restrictions: z.array(z.string()).optional(),
  priority: z.enum(['quick', 'varied', 'healthy', 'cheap']).optional(),
})
