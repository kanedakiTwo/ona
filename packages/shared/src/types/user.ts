import { z } from 'zod'
import type { ActivityLevel, CookingFrequency, HouseholdSize, Priority, Sex } from '../constants/enums.js'

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
  favoriteDishes: z.array(z.string()).min(1).max(5),
  priority: z.enum(['quick', 'varied', 'healthy', 'cheap']),
  /**
   * The separate, unticked health-data box (RGPD art. 9, PRO-21). Without it
   * `restrictions` is not stored.
   */
  healthConsent: z.boolean().optional(),
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
