'use client'

/**
 * Mimo, the companion (D-023, specs/advisor.md): one assistant on every page.
 *
 *   - One brain: the same Claude assistant (`POST /assistant/:userId/chat`)
 *     for typing and talking. It gets the current page so "esta receta"
 *     or "siguiente" mean something.
 *   - Voice: record → `POST /stt` → the same chat in `mode: 'voice'` (short
 *     spoken replies) → read aloud (`POST /tts`, ElevenLabs, or the browser
 *     voice). In hands-free mode it listens again after speaking, until
 *     nobody talks — except in cook mode, where a silence just means
 *     "listen again" (lib/mimoHandsFree.ts) and leaving it ends hands-free.
 *   - The conversation survives navigation (sessionStorage), and pages
 *     refresh after Mimo changes something.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'
import { useVoice, type ServerVoice } from '@/hooks/useVoice'
import { recorderSupported, useRecorder } from '@/hooks/useRecorder'
import { emitCookingCommand } from '@/lib/cookingCommands'
import { handsFreeAfterSilence, leavesCookMode, turnSilenceMs } from '@/lib/mimoHandsFree'
import { recipeRefsFrom, type RecipeRef } from '@/lib/mimoRecipeLinks'
import { createPendingListen } from '@/lib/pendingListen'
import MimoPanel from './MimoPanel'
import MimoButton from './MimoButton'

export interface MimoMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  uiHint?: string
  /** PRO-85: recipes this reply is about; their names render as links to their page. */
  recipes?: RecipeRef[]
}

interface AssistantResponse {
  message: string
  skillUsed?: string
  data?: any
  uiHint?: string
  actionTaken?: boolean
}

export type MimoStatus = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking'

interface MimoContextValue {
  isOpen: boolean
  open: (opts?: { listen?: boolean; handsFree?: boolean }) => void
  close: () => void
  messages: MimoMessage[]
  clear: () => void
  status: MimoStatus
  error: string | null
  send: (text: string) => Promise<void>
  /** Tap the mic: start listening, or stop and send what was said. */
  toggleListening: () => void
  micLevel: number
  canListen: boolean
  handsFree: boolean
  setHandsFree: (v: boolean) => void
  speakReplies: boolean
  setSpeakReplies: (v: boolean) => void
  stopSpeaking: () => void
  voices: ServerVoice[]
  selectedVoice: string | null
  setVoice: (key: string) => void
  previewVoice: (key: string) => void
}

const MimoContext = createContext<MimoContextValue | undefined>(undefined)

export function useMimo(): MimoContextValue {
  const ctx = useContext(MimoContext)
  if (!ctx) throw new Error('useMimo must be used within MimoProvider')
  return ctx
}

/** Mimo when it's mounted, else undefined: cook mode also runs signed out, with the public shell and no MimoProvider (specs/recipes.md). */
export function useOptionalMimo(): MimoContextValue | undefined {
  return useContext(MimoContext)
}

const HISTORY_KEY = 'mimo.chat.v1'
const SPEAK_KEY = 'mimo.speak'
/**
 * Setting left by the retired "say a phrase to open Mimo" listener (D-032):
 * removed on start so nothing lingers. Split so a repo grep for the retired
 * feature stays empty.
 */
const LEGACY_LISTENER_KEY = 'ona.voice.wake' + 'word.enabled'
const MAX_KEPT = 40

/** Routes where Mimo has no button: sign-in, onboarding (it has its own voice flow), public pages. */
export function mimoHiddenOn(pathname: string | null): boolean {
  return /^\/(login|register|reset|onboarding|invites|lista|i\/|c\/|privacidad|terminos|aviso-legal|como-funciona|blog)(\/|$)/.test(pathname ?? '') || pathname === '/'
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export default function MimoProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const userId = user?.id ?? ''
  const router = useRouter()
  const pathname = usePathname()
  const queryClient = useQueryClient()

  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<MimoMessage[]>([])
  const [status, setStatus] = useState<MimoStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [handsFree, setHandsFreeState] = useState(false)
  const [speakReplies, setSpeakRepliesState] = useState(false)

  const messagesRef = useRef<MimoMessage[]>([])
  messagesRef.current = messages
  const handsFreeRef = useRef(false)
  handsFreeRef.current = handsFree
  const pathRef = useRef(pathname)
  pathRef.current = pathname
  const busyRef = useRef(false)
  /** The mic start `open({ listen })` leaves for 150 ms later; cancellable (PRO-79). */
  const pendingListenRef = useRef<ReturnType<typeof createPendingListen> | null>(null)
  if (!pendingListenRef.current) pendingListenRef.current = createPendingListen()
  const pendingListen = pendingListenRef.current

  const recorder = useRecorder()
  const voice = useVoice({ lang: 'es-ES' })

  // Restore the conversation and preferences.
  const [restored, setRestored] = useState(false)
  useEffect(() => {
    setMessages(readJson<MimoMessage[]>(HISTORY_KEY, []))
    setRestored(true)
    try {
      setSpeakRepliesState(localStorage.getItem(SPEAK_KEY) === '1')
      localStorage.removeItem(LEGACY_LISTENER_KEY)
    } catch {}
  }, [])
  // Only once restored: saving the initial empty list first would wipe the
  // stored conversation before a second mount (React StrictMode in dev) reads it.
  useEffect(() => {
    if (!restored) return
    try {
      sessionStorage.setItem(HISTORY_KEY, JSON.stringify(messages.slice(-MAX_KEPT)))
    } catch {}
  }, [messages, restored])

  // Desktop: the page makes room for the 400 px column instead of hiding under it.
  useEffect(() => {
    document.documentElement.style.setProperty('--mimo-panel-width', isOpen ? '400px' : '0px')
  }, [isOpen])

  // `?mimo=1` (e.g. the old /advisor) opens the panel.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    if (url.searchParams.get('mimo') === '1') {
      setIsOpen(true)
      url.searchParams.delete('mimo')
      window.history.replaceState(null, '', url.pathname + (url.search ? url.search : '') + url.hash)
    }
  }, [pathname])

  const setSpeakReplies = useCallback((v: boolean) => {
    setSpeakRepliesState(v)
    try {
      localStorage.setItem(SPEAK_KEY, v ? '1' : '0')
    } catch {}
    if (!v) voice.stopSpeaking()
  }, [voice])

  const setHandsFree = useCallback((v: boolean) => {
    setHandsFreeState(v)
    handsFreeRef.current = v
    if (!v) {
      pendingListen.cancel()
      recorder.cancel()
    }
  }, [recorder, pendingListen])

  const append = (m: Omit<MimoMessage, 'id'>) =>
    setMessages((prev) => [...prev, { ...m, id: `${m.role[0]}-${Date.now()}-${prev.length}` }].slice(-MAX_KEPT))

  const listenRef = useRef<() => void>(() => {})

  /** One turn with the assistant. `spoken` = it came from the mic (short spoken reply). */
  const ask = useCallback(
    async (text: string, spoken: boolean) => {
      const question = text.trim()
      if (!question || !userId || busyRef.current) return
      busyRef.current = true
      setError(null)
      voice.stopSpeaking()
      const history = messagesRef.current.slice(-20).map(({ role, content }) => ({ role, content }))
      append({ role: 'user', content: question })
      setStatus('thinking')
      let reply = ''
      try {
        const res = await api.post<AssistantResponse>(`/assistant/${userId}/chat`, {
          message: question,
          history,
          mode: spoken ? 'voice' : 'text',
          context: { path: pathRef.current },
        })
        reply = res.message || 'No he podido responder.'
        const recipes = recipeRefsFrom(res.uiHint, res.data)
        append({ role: 'assistant', content: reply, uiHint: res.uiHint, ...(recipes.length ? { recipes } : {}) })

        // Same dispatchers the cook mode listens to.
        const d = res.data
        if (res.uiHint === 'cooking_navigate' && d?.recipeId) {
          const qs = typeof d.servings === 'number' ? `?servings=${d.servings}` : ''
          router.push(`/recipes/${d.recipeId}/cook${qs}`)
        } else if (res.uiHint === 'cooking_timer' && typeof d?.minutes === 'number') {
          emitCookingCommand({ type: 'timer.start', minutes: d.minutes, label: d.label ?? null })
        } else if (res.uiHint === 'cooking_step' && typeof d?.direction === 'string') {
          emitCookingCommand({ type: 'step.advance', direction: d.direction })
        }
        // The page behind may show what Mimo just changed (menu, list, recipe).
        if (res.actionTaken) queryClient.invalidateQueries()
      } catch (err: any) {
        const msg = err?.message || 'No he podido conectar.'
        setError(msg)
        append({ role: 'assistant', content: `No he podido responder: ${msg}` })
      } finally {
        busyRef.current = false
      }

      if (reply && (spoken || speakReplies)) {
        setStatus('speaking')
        await voice.speak(reply)
      }
      setStatus('idle')
      if (spoken && handsFreeRef.current) listenRef.current()
    },
    [userId, voice, router, queryClient, speakReplies],
  )

  const send = useCallback((text: string) => ask(text, false), [ask])

  // ── Listening ──
  const canListen = typeof window !== 'undefined' && (recorderSupported() || voice.sttSupported)

  const listen = useCallback(async () => {
    if (!userId || busyRef.current) return
    voice.stopSpeaking()
    setError(null)
    if (!recorderSupported()) {
      // Old browsers: the built-in recogniser, then the same turn.
      setStatus('listening')
      voice.startListening()
      return
    }
    setStatus('listening')
    const blob = await recorder.start({ silenceMs: turnSilenceMs(handsFreeRef.current) })
    if (!blob) {
      setStatus('idle')
      const micError = recorder.lastError()
      if (micError) setError(micError)
      if (handsFreeRef.current) {
        // Nobody spoke (nothing is sent to transcribe). In cook mode: listen
        // again. Elsewhere: end the conversation quietly.
        if (handsFreeAfterSilence(pathRef.current, micError) === 'listen-again') {
          listenRef.current()
          return
        }
        setHandsFreeState(false)
        handsFreeRef.current = false
      }
      return
    }
    setStatus('transcribing')
    try {
      const form = new FormData()
      form.append('audio', blob, blob.type.includes('mp4') ? 'voz.m4a' : 'voz.webm')
      const { text } = await api.upload<{ text: string }>('/stt', form)
      if (!text?.trim()) {
        setStatus('idle')
        if (handsFreeRef.current) listenRef.current()
        return
      }
      await ask(text, true)
    } catch (err: any) {
      setStatus('idle')
      setError(err?.message || 'No te he entendido.')
    }
  }, [userId, voice, recorder, ask])
  listenRef.current = () => {
    void listen()
  }

  // Built-in recogniser fallback: its transcript becomes a spoken turn.
  useEffect(() => {
    if (!voice.isListening && status === 'listening' && !recorder.recording && voice.transcript) {
      void ask(voice.transcript, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.isListening])

  const toggleListening = useCallback(() => {
    if (status === 'listening') {
      if (recorder.recording) recorder.stop()
      else voice.stopListening()
      return
    }
    if (status === 'speaking') voice.stopSpeaking()
    void listen()
  }, [status, recorder, voice, listen])

  // Leaving cook mode ends a hands-free conversation (PRO-55).
  const prevPathRef = useRef(pathname)
  useEffect(() => {
    const previous = prevPathRef.current
    prevPathRef.current = pathname
    if (leavesCookMode(previous, pathname) && handsFreeRef.current) setHandsFree(false)
  }, [pathname, setHandsFree])

  // ── Open / close ──
  const open = useCallback(
    (opts: { listen?: boolean; handsFree?: boolean } = {}) => {
      setIsOpen(true)
      if (opts.handsFree) setHandsFree(true)
      if (opts.listen) pendingListen.schedule(() => listenRef.current(), 150)
    },
    [setHandsFree, pendingListen],
  )
  const close = useCallback(() => {
    pendingListen.cancel()
    setIsOpen(false)
    setHandsFree(false)
    recorder.cancel()
    voice.stopSpeaking()
    setStatus('idle')
  }, [recorder, voice, setHandsFree, pendingListen])
  useEffect(() => () => pendingListen.cancel(), [pendingListen])

  const value = useMemo<MimoContextValue>(
    () => ({
      isOpen,
      open,
      close,
      messages,
      clear: () => setMessages([]),
      status,
      error,
      send,
      toggleListening,
      micLevel: recorder.level,
      canListen,
      handsFree,
      setHandsFree,
      speakReplies,
      setSpeakReplies,
      stopSpeaking: () => {
        pendingListen.cancel()
        voice.stopSpeaking()
        setStatus('idle')
      },
      voices: voice.voices,
      selectedVoice: voice.selectedVoice,
      setVoice: voice.setVoice,
      previewVoice: (key: string) => {
        voice.setVoice(key)
        void voice.speak('Hola, soy Mimo. Así sueno con esta voz. ¿Qué cocinamos hoy?', key)
      },
    }),
    [isOpen, open, close, messages, status, error, send, toggleListening, recorder.level, canListen, handsFree, setHandsFree, speakReplies, setSpeakReplies, voice, pendingListen],
  )

  const showButton = !!userId && !isOpen && !mimoHiddenOn(pathname)

  return (
    <MimoContext.Provider value={value}>
      {children}
      {showButton && <MimoButton pathname={pathname} onOpen={() => open()} />}
      {userId && isOpen && <MimoPanel />}
    </MimoContext.Provider>
  )
}
