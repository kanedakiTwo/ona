import { env } from '../../config/env.js'

interface UsageEntry {
  utcDate: string
  minutes: number
}

const usage = new Map<string, UsageEntry>()

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

function getEntry(userId: string): UsageEntry {
  const today = todayUtc()
  const existing = usage.get(userId)
  if (!existing || existing.utcDate !== today) {
    const fresh: UsageEntry = { utcDate: today, minutes: 0 }
    usage.set(userId, fresh)
    return fresh
  }
  return existing
}

export function checkQuota(userId: string): { ok: true } | { ok: false; usedMinutes: number; limitMinutes: number } {
  const entry = getEntry(userId)
  if (entry.minutes >= env.REALTIME_DAILY_MINUTES_PER_USER) {
    return { ok: false, usedMinutes: entry.minutes, limitMinutes: env.REALTIME_DAILY_MINUTES_PER_USER }
  }
  return { ok: true }
}

export function recordSessionMinutes(userId: string, minutes: number): void {
  const entry = getEntry(userId)
  entry.minutes += minutes
}
