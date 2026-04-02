import { z } from 'zod'
import type { ActivityLevel, CookingFrequency, HouseholdSize, Priority, Sex } from '../constants/enums.js'

export interface User {
  id: string
  username: string
  email: string
  sex?: Sex
  age?: number
  weight?: number
  height?: number
  activityLevel: ActivityLevel
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
  householdSize: HouseholdSize
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
})

export const loginSchema = z.object({
  username: z.string(),
  password: z.string(),
})

export const onboardingSchema = z.object({
  householdSize: z.enum(['solo', 'couple', 'family_with_kids', 'family_no_kids']),
  cookingFreq: z.enum(['daily', '3_4_times', 'rarely']),
  restrictions: z.array(z.string()),
  favoriteDishes: z.array(z.string()).min(1).max(5),
  priority: z.enum(['quick', 'varied', 'healthy', 'cheap']),
})

export const updateProfileSchema = z.object({
  sex: z.enum(['male', 'female']).optional(),
  age: z.number().int().min(1).max(120).optional(),
  weight: z.number().min(20).max(300).optional(),
  height: z.number().min(50).max(250).optional(),
  activityLevel: z.enum(['none', 'light', 'moderate', 'high']).optional(),
  restrictions: z.array(z.string()).optional(),
  priority: z.enum(['quick', 'varied', 'healthy', 'cheap']).optional(),
})
