"use client"

import { useEffect, useState } from "react"
import { getPending } from "./offlineQueue"

interface OnlineStatus {
  online: boolean
  pendingCount: number
  pendingResourceIds: Set<string>
}

const INITIAL_STATE: OnlineStatus = {
  online: true,
  pendingCount: 0,
  pendingResourceIds: new Set<string>(),
}

export function useOnlineStatus(): OnlineStatus {
  const [state, setState] = useState<OnlineStatus>(INITIAL_STATE)

  useEffect(() => {
    let cancelled = false

    async function refreshPending() {
      const queue = await getPending()
      if (cancelled) return
      const ids = new Set<string>()
      for (const item of queue) {
        if (item.resourceId) ids.add(item.resourceId)
      }
      setState((prev) => ({
        ...prev,
        pendingCount: queue.length,
        pendingResourceIds: ids,
      }))
    }

    function handleOnline() {
      setState((prev) => ({ ...prev, online: true }))
    }

    function handleOffline() {
      setState((prev) => ({ ...prev, online: false }))
    }

    function handleQueueChanged() {
      void refreshPending()
    }

    // Initial sync from window state + IDB queue
    setState((prev) => ({ ...prev, online: navigator.onLine }))
    void refreshPending()

    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)
    window.addEventListener("ona-queue-changed", handleQueueChanged)

    return () => {
      cancelled = true
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
      window.removeEventListener("ona-queue-changed", handleQueueChanged)
    }
  }, [])

  return state
}
