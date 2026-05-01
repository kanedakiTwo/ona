'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, apiFetch } from '@/lib/api'

export type RealtimeStatus = 'idle' | 'connecting' | 'connected' | 'error' | 'closed'

export interface RealtimeTurn {
  role: 'user' | 'assistant'
  content: string
}

interface UseRealtimeSessionOptions {
  userId: string
  initialContext?: RealtimeTurn[]
}

interface UseRealtimeSessionReturn {
  status: RealtimeStatus
  error: string | null
  transcripts: RealtimeTurn[]
  partialUserText: string
  partialAssistantText: string
  lastToolName: string | null
  lastActivityAt: number
  connect: () => Promise<void>
  disconnect: () => void
  sendUserText: (text: string) => void
}

interface SessionResponse {
  client_secret: { value: string; expires_at?: number }
  model: string
  voice: string
}

const REALTIME_URL = 'https://api.openai.com/v1/realtime'

export function useRealtimeSession(options: UseRealtimeSessionOptions): UseRealtimeSessionReturn {
  const { userId, initialContext } = options

  const [status, setStatus] = useState<RealtimeStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [transcripts, setTranscripts] = useState<RealtimeTurn[]>([])
  const [partialUserText, setPartialUserText] = useState('')
  const [partialAssistantText, setPartialAssistantText] = useState('')
  const [lastToolName, setLastToolName] = useState<string | null>(null)
  const [lastActivityAt, setLastActivityAt] = useState(Date.now())

  const pcRef = useRef<RTCPeerConnection | null>(null)
  const dcRef = useRef<RTCDataChannel | null>(null)
  const audioElRef = useRef<HTMLAudioElement | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const sessionStartRef = useRef<number>(0)
  const closedRef = useRef(false)
  const reconnectAttemptedRef = useRef(false)

  const sendEvent = useCallback((event: any) => {
    const dc = dcRef.current
    if (dc && dc.readyState === 'open') {
      dc.send(JSON.stringify(event))
    }
  }, [])

  const handleEvent = useCallback(async (event: any) => {
    setLastActivityAt(Date.now())

    switch (event.type) {
      case 'conversation.item.input_audio_transcription.delta': {
        if (typeof event.delta === 'string') {
          setPartialUserText(prev => prev + event.delta)
        }
        break
      }
      case 'conversation.item.input_audio_transcription.completed': {
        const text = String(event.transcript ?? '').trim()
        if (text) {
          setTranscripts(prev => [...prev, { role: 'user', content: text }])
        }
        setPartialUserText('')
        break
      }
      case 'response.audio_transcript.delta': {
        if (typeof event.delta === 'string') {
          setPartialAssistantText(prev => prev + event.delta)
        }
        break
      }
      case 'response.audio_transcript.done': {
        const text = String(event.transcript ?? '').trim()
        if (text) {
          setTranscripts(prev => [...prev, { role: 'assistant', content: text }])
        }
        setPartialAssistantText('')
        break
      }
      case 'response.function_call_arguments.done': {
        const name = String(event.name ?? '')
        const callId = String(event.call_id ?? '')
        let parsed: any = {}
        try {
          parsed = event.arguments ? JSON.parse(event.arguments) : {}
        } catch {}
        setLastToolName(name)

        let outputText: string
        try {
          const result = await api.post<{ summary?: string; data?: any }>(
            `/realtime/${userId}/tool`,
            { name, params: parsed },
          )
          outputText = result?.summary ?? JSON.stringify(result?.data ?? {})
        } catch (err: any) {
          outputText = `Error ejecutando ${name}: ${err?.message ?? 'desconocido'}`
        }

        sendEvent({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: callId,
            output: outputText,
          },
        })
        sendEvent({ type: 'response.create' })
        break
      }
      case 'error': {
        setError(event.error?.message || 'Error en la sesion de voz.')
        break
      }
    }
  }, [sendEvent, userId])

  const disconnect = useCallback(() => {
    if (closedRef.current) return
    closedRef.current = true

    const minutes = sessionStartRef.current
      ? Math.max(0, (Date.now() - sessionStartRef.current) / 60000)
      : 0
    if (minutes > 0) {
      apiFetch(`/realtime/${userId}/usage`, { method: 'POST', body: { minutes } }).catch(() => {})
    }

    try {
      dcRef.current?.close()
    } catch {}
    try {
      pcRef.current?.close()
    } catch {}
    try {
      localStreamRef.current?.getTracks().forEach(t => t.stop())
    } catch {}
    if (audioElRef.current) {
      audioElRef.current.pause()
      audioElRef.current.srcObject = null
    }
    pcRef.current = null
    dcRef.current = null
    localStreamRef.current = null
    setStatus('closed')
  }, [userId])

  const connect = useCallback(async () => {
    if (status === 'connecting' || status === 'connected') return
    closedRef.current = false
    setError(null)
    setStatus('connecting')

    try {
      const session = await api.post<SessionResponse>(`/realtime/${userId}/session`, {})
      const ephemeralKey = session.client_secret?.value
      if (!ephemeralKey) throw new Error('No se recibio token efimero.')

      if (typeof RTCPeerConnection === 'undefined') {
        throw new Error('Tu navegador no soporta WebRTC.')
      }
      const pc = new RTCPeerConnection()
      pcRef.current = pc

      if (!audioElRef.current) {
        const el = document.createElement('audio')
        el.autoplay = true
        audioElRef.current = el
      }
      pc.ontrack = (e) => {
        if (audioElRef.current) {
          audioElRef.current.srcObject = e.streams[0]
        }
      }
      pc.addEventListener('connectionstatechange', () => {
        const state = pc.connectionState
        if ((state === 'failed' || state === 'disconnected') && !closedRef.current) {
          if (!reconnectAttemptedRef.current) {
            reconnectAttemptedRef.current = true
            disconnect()
            setTimeout(() => {
              closedRef.current = false
              connect().catch(() => {})
            }, 250)
          } else {
            setError('Se perdió la conexión de voz.')
            disconnect()
          }
        }
      })

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      localStreamRef.current = stream
      stream.getTracks().forEach(track => pc.addTrack(track, stream))

      const dc = pc.createDataChannel('oai-events')
      dcRef.current = dc
      dc.addEventListener('message', (e) => {
        try {
          const event = JSON.parse(e.data)
          handleEvent(event)
        } catch (err) {
          console.warn('[realtime] failed to parse event', err)
        }
      })
      dc.addEventListener('open', () => {
        if (initialContext && initialContext.length > 0) {
          for (const turn of initialContext) {
            sendEvent({
              type: 'conversation.item.create',
              item: {
                type: 'message',
                role: turn.role,
                content: [{ type: turn.role === 'user' ? 'input_text' : 'text', text: turn.content }],
              },
            })
          }
        }
      })

      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)

      const sdpResponse = await fetch(`${REALTIME_URL}?model=${encodeURIComponent(session.model)}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${ephemeralKey}`,
          'Content-Type': 'application/sdp',
        },
        body: offer.sdp,
      })

      if (!sdpResponse.ok) {
        const text = await sdpResponse.text()
        throw new Error(`SDP exchange failed: ${sdpResponse.status} ${text}`)
      }

      const answerSdp = await sdpResponse.text()
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })

      sessionStartRef.current = Date.now()
      reconnectAttemptedRef.current = false
      setStatus('connected')
      setLastActivityAt(Date.now())
    } catch (err: any) {
      setError(err?.message ?? 'No se pudo conectar a Realtime.')
      setStatus('error')
      disconnect()
    }
  }, [status, userId, initialContext, handleEvent, sendEvent, disconnect])

  const sendUserText = useCallback((text: string) => {
    sendEvent({
      type: 'conversation.item.create',
      item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
    })
    sendEvent({ type: 'response.create' })
  }, [sendEvent])

  useEffect(() => {
    return () => disconnect()
  }, [disconnect])

  return {
    status,
    error,
    transcripts,
    partialUserText,
    partialAssistantText,
    lastToolName,
    lastActivityAt,
    connect,
    disconnect,
    sendUserText,
  }
}
