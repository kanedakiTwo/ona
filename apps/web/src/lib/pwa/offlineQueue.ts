"use client"

import { get, set } from "idb-keyval"
import { api } from "@/lib/api"

const QUEUE_KEY = "ona-offline-queue"

export interface QueuedMutation {
  id: string
  url: string
  method: "POST" | "PUT" | "DELETE"
  body?: unknown
  timestamp: number
  resourceId?: string
}

async function readQueue(): Promise<QueuedMutation[]> {
  try {
    const queue = await get<QueuedMutation[]>(QUEUE_KEY)
    return Array.isArray(queue) ? queue : []
  } catch {
    return []
  }
}

async function writeQueue(queue: QueuedMutation[]): Promise<void> {
  try {
    await set(QUEUE_KEY, queue)
  } catch {
    // IDB unavailable (private mode, SSR, etc.) — silently no-op
  }
}

export async function enqueue(mutation: QueuedMutation): Promise<void> {
  if (typeof window === "undefined") return
  const queue = await readQueue()
  queue.push(mutation)
  await writeQueue(queue)
}

export async function getPending(): Promise<QueuedMutation[]> {
  if (typeof window === "undefined") return []
  return readQueue()
}

let replaying: Promise<{ succeeded: number; failed: number }> | null = null

export async function replayAll(): Promise<{ succeeded: number; failed: number }> {
  if (replaying) return replaying
  replaying = (async () => {
    try {
      if (typeof window === "undefined") return { succeeded: 0, failed: 0 }

      const queue = await readQueue()
      if (queue.length === 0) return { succeeded: 0, failed: 0 }

      let succeeded = 0
      let failed = 0
      const remaining: QueuedMutation[] = []

      // FIFO: process in order, only retain failures (preserving their order)
      for (const mutation of queue) {
        try {
          if (mutation.method === "POST") {
            await api.post(mutation.url, mutation.body)
          } else if (mutation.method === "PUT") {
            await api.put(mutation.url, mutation.body)
          } else if (mutation.method === "DELETE") {
            await api.delete(mutation.url)
          }
          succeeded += 1
        } catch {
          failed += 1
          remaining.push(mutation)
        }
      }

      await writeQueue(remaining)

      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("ona-queue-changed"))
      }

      return { succeeded, failed }
    } finally {
      replaying = null
    }
  })()
  return replaying
}

// Module-level guard: register the online listener exactly once per page load
let registered = false

function registerOnlineListener(): void {
  if (registered) return
  if (typeof window === "undefined") return
  registered = true
  window.addEventListener("online", () => {
    void replayAll()
  })
}

registerOnlineListener()
