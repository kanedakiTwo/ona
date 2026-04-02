import { eq } from 'drizzle-orm'
import { userNutrientBalance, menuLogs } from '../db/schema.js'
import { updateNutrientBalance } from '@ona/shared'
import type { NutrientBalance } from '@ona/shared'

/**
 * Update the user's nutrient balance using Exponential Moving Average.
 *
 * 1. Get current balance from user_nutrient_balance
 * 2. Apply EMA: new = 0.7 * new + 0.3 * old
 * 3. Upsert the balance
 */
export async function updateBalance(
  userId: string,
  nutrients: NutrientBalance,
  db: any,
): Promise<NutrientBalance> {
  // 1. Get current balance
  const [existing] = await db
    .select()
    .from(userNutrientBalance)
    .where(eq(userNutrientBalance.userId, userId))
    .limit(1)

  const currentBalance = existing?.balance as NutrientBalance | undefined

  // 2. Apply EMA
  const newBalance = updateNutrientBalance(nutrients, currentBalance)

  // 3. Upsert
  if (existing) {
    await db
      .update(userNutrientBalance)
      .set({
        balance: newBalance,
        updatedAt: new Date(),
      })
      .where(eq(userNutrientBalance.userId, userId))
  } else {
    await db
      .insert(userNutrientBalance)
      .values({
        userId,
        balance: newBalance,
      })
  }

  return newBalance
}
