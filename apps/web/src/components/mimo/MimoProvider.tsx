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
import { emitCookingCommand, getCookStep } from '@/lib/cookingCommands'
import { handsFreeAfterSilence, leavesCookMode, turnSilenceMs } from '@/lib/mimoHandsFree'
import { recipeRefsFrom, type RecipeRef } from '@/lib/mimoRecipeLinks'
import { mimoOptions } from '@/lib/mimoOptions'
import { createPendingListen } from '@/lib/pendingListen'
import { withAttachmentMarker } from '@/lib/mimoAttachment'
import MimoPanel from './MimoPanel'
import MimoButton from './MimoButton'
import { useFloatingButtonsHidden } from '@/hooks/useFloatingButtonsHidden'

/** PRO-1302: the API's 429s for the month's cap; their text is Mimo's notice. */
const CAP_CODES = new Set(['ADVISOR_BUDGET_EXCEEDED', 'SPEND_CAP_EXCEEDED'])
/** PRO-1336: the mic recorded something but the transcript came back empty (same words as the API's voiceEmptyReply). */
const VOICE_EMPTY_REPLY = 'No te he oído bien. ¿Me lo repites o me lo escribes?'

export interface MimoMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  uiHint?: string
  /** PRO-85: recipes this reply is about; their names render as links to their page. */
  recipes?: RecipeRef[]
  /** PRO-1305: a fixed allergy notice's buttons (permission, withdrawal); answered via `/health-consent`. */
  buttons?: HealthButton[]
  /** Set once one of `buttons` is tapped, so it can't be answered twice. */
  answered?: boolean
}

export interface HealthButton {
  id: string
  title: string
}

/** PRO-1305: fixed messages the code (not the model) writes about allergies said in the chat. */
interface HealthMessage {
  id: string
  text: string
  buttons?: HealthButton[]
}

interface AssistantResponse {
  message: string
  skillUsed?: string
  data?: any
  uiHint?: string
  actionTaken?: boolean
  healthMessages?: HealthMessage[]
}

export type MimoStatus = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking'

/** Text left in Mimo's box by `open({ draft })`; `n` tells two equal drafts apart. */
export interface MimoDraft {
  text: string
  n: number
  /** `open({ attach })`: the panel also opens the file picker (the nutritionist's diet, 2026-11-26). */
  attach?: boolean
}

interface MimoContextValue {
  isOpen: boolean
  /** `draft`: start the message for the person («Recuerda que en casa …», «Tu ficha»); they finish it and send. `attach`: and pick a file. */
  open: (opts?: { listen?: boolean; handsFree?: boolean; draft?: string; attach?: boolean }) => void
  /** The draft the panel should put in its box, until it takes it (`clearDraft`). */
  draft: MimoDraft | null
  clearDraft: () => void
  close: () => void
  messages: MimoMessage[]
  clear: () => void
  status: MimoStatus
  error: string | null
  /** `file`: one photo or PDF for Mimo to read this turn (never stored; the conversation keeps «[Adjunto]»). */
  send: (text: string, file?: File) => Promise<void>
  /** Answer an allergy notice's button; throws (and leaves it answerable) if it couldn't be saved. */
  answerButton: (messageId: string, button: HealthButton) => Promise<void>
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

/** Routes where Mimo has no button: sign-in, onboarding (it has its own voice flow), «Afina tu menú» (full screen), public pages. */
export function mimoHiddenOn(pathname: string | null): boolean {
  return /^\/(login|register|reset|onboarding|afinar|invites|lista|i\/|c\/|privacidad|terminos|aviso-legal|como-funciona|blog|receta-del-dia)(\/|$)/.test(pathname ?? '') || pathname === '/'
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
  const [draft, setDraft] = useState<MimoDraft | null>(null)

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

  /** The code's allergy notices, after Mimo's reply and in order. */
  const appendHealth = (list: HealthMessage[] | undefined) => {
    if (!list?.length) return
    setMessages((prev) =>
      [
        ...prev,
        ...list.map((h, i) => ({
          id: `h-${h.id || `${Date.now()}-${prev.length + i}`}`,
          role: 'assistant' as const,
          content: h.text,
          ...(h.buttons?.length ? { buttons: h.buttons } : {}),
        })),
      ].slice(-MAX_KEPT),
    )
  }

  const markAnswered = (messageId: string, answered: boolean) =>
    setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, answered } : m)))

  const answerButton = useCallback(
    async (messageId: string, button: HealthButton) => {
      if (!userId) return
      markAnswered(messageId, true)
      try {
        const res = await api.post<{ healthMessages?: HealthMessage[] }>(`/assistant/${userId}/health-consent`, {
          buttonId: button.id,
          title: button.title,
        })
        appendHealth(res.healthMessages)
        queryClient.invalidateQueries()
      } catch (err) {
        markAnswered(messageId, false)
        throw err
      }
    },
    [userId, queryClient],
  )

  const listenRef = useRef<() => void>(() => {})

  /** One turn with the assistant. `spoken` = it came from the mic (short spoken reply). `file`: a photo or PDF with it. */
  const ask = useCallback(
    async (text: string, spoken: boolean, file?: File) => {
      const question = text.trim()
      if ((!question && !file) || !userId || busyRef.current) return
      busyRef.current = true
      setError(null)
      voice.stopSpeaking()
      const history = messagesRef.current.slice(-20).map(({ role, content }) => ({ role, content }))
      append({ role: 'user', content: file ? withAttachmentMarker(question) : question })
      setStatus('thinking')
      let reply = ''
      try {
        const body = {
          message: question,
          history,
          mode: spoken ? 'voice' : 'text',
          context: { path: pathRef.current, ...(getCookStep() ? { cookStep: getCookStep() } : {}) },
        }
        let res: AssistantResponse
        if (file) {
          // Multipart: the file plus the same fields (history and context as JSON).
          const form = new FormData()
          form.append('message', body.message)
          form.append('history', JSON.stringify(body.history))
          form.append('mode', body.mode)
          form.append('context', JSON.stringify(body.context))
          form.append('file', file, file.name)
          res = await api.upload<AssistantResponse>(`/assistant/${userId}/chat`, form)
        } else {
          res = await api.post<AssistantResponse>(`/assistant/${userId}/chat`, body)
        }
        reply = res.message || 'No he podido responder.'
        const recipes = recipeRefsFrom(res.uiHint, res.data)
        append({ role: 'assistant', content: reply, uiHint: res.uiHint, ...(recipes.length ? { recipes } : {}) })
        appendHealth(res.healthMessages)

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
        if (CAP_CODES.has(err?.code)) {
          // PRO-1302: the month's cap is Mimo's own words (what still works and where), not an error.
          reply = msg
          append({ role: 'assistant', content: msg })
        } else {
          setError(msg)
          append({ role: 'assistant', content: `No he podido responder: ${msg}` })
        }
      } finally {
        busyRef.current = false
      }

      if (reply && (spoken || speakReplies)) {
        setStatus('speaking')
        // Out loud, the question without the `[[opciones: …]]` line (the buttons are on screen).
        await voice.speak(mimoOptions(reply).text)
      }
      setStatus('idle')
      if (spoken && handsFreeRef.current) listenRef.current()
    },
    [userId, voice, router, queryClient, speakReplies],
  )

  const send = useCallback((text: string, file?: File) => ask(text, false, file), [ask])

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
        // PRO-1336: something was recorded but no words came out: Mimo asks to repeat it.
        else append({ role: 'assistant', content: VOICE_EMPTY_REPLY })
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
    (opts: { listen?: boolean; handsFree?: boolean; draft?: string; attach?: boolean } = {}) => {
      setIsOpen(true)
      if (opts.draft) setDraft((prev) => ({ text: opts.draft!, n: (prev?.n ?? 0) + 1, ...(opts.attach ? { attach: true } : {}) }))
      if (opts.handsFree) setHandsFree(true)
      if (opts.listen) pendingListen.schedule(() => listenRef.current(), 150)
    },
    [setHandsFree, pendingListen],
  )
  const clearDraft = useCallback(() => setDraft(null), [])
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
      draft,
      clearDraft,
      messages,
      clear: () => setMessages([]),
      status,
      error,
      send,
      answerButton,
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
    [isOpen, open, close, draft, clearDraft, messages, status, error, send, answerButton, toggleListening, recorder.level, canListen, handsFree, setHandsFree, speakReplies, setSpeakReplies, voice, pendingListen],
  )

  // PRO-122: also out of the way while a sheet is open or the keyboard is up.
  const floatingHidden = useFloatingButtonsHidden()
  const showButton = !!userId && !isOpen && !mimoHiddenOn(pathname) && !floatingHidden

  return (
    <MimoContext.Provider value={value}>
      {children}
      {showButton && <MimoButton pathname={pathname} onOpen={() => open()} />}
      {userId && isOpen && <MimoPanel />}
    </MimoContext.Provider>
  )
}
