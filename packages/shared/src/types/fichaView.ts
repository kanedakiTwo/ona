/**
 * «Tu ficha» (PRO-317, D-064, D-110): what the API sends the profile screen.
 * Sentences are built on the server, in Spanish and for whoever reads them
 * («Te encanta la cuchara», «No os gusta el cilantro»); nothing technical
 * (confidence numbers, ids of other tables, raw evidence) goes out, except in
 * the export. Design: https://claude.ai/artifact/9WPRprGUFk2gJQHKvJd6yY
 */

export const FICHA_PATH = '/household/profile'

/** «Apunta que…» from Mimo (PRO-319): `POST { type, value, about, personId?, validUntil? }`. */
export const FICHA_FACTS_PATH = '/household/profile/facts'

/** Mimo asks the pending question (PRO-319): `POST` → `FichaAskView`. */
export const FICHA_QUESTION_ASK_PATH = '/household/profile/question/ask'

/** Mimo asks at most one pending question a week to each person (PRO-319). */
export const FICHA_QUESTION_EVERY_DAYS = 7

/** What `POST …/question/ask` answers: the question to ask now, or why not. */
export interface FichaAskView {
  question: FichaQuestionView | null
  /** Why there is none: nothing pending, already asked this week, or WhatsApp outside its 24 h window. */
  reason: 'asked' | 'none' | 'weekly_cap' | 'outside_window'
}

/** Topics the facts are grouped in, in screen order. */
export const FICHA_TOPICS = [
  'como_comeis',
  'en_la_cocina',
  'tiempo_y_compra',
  'gustos',
  'como_comes',
  'la_casa',
  'salud',
  'notas',
] as const
export type FichaTopic = (typeof FICHA_TOPICS)[number]

export const FICHA_TOPIC_LABELS: Record<FichaTopic, string> = {
  como_comeis: 'Cómo coméis',
  en_la_cocina: 'En la cocina',
  tiempo_y_compra: 'Tiempo y compra',
  gustos: 'Gustos',
  como_comes: 'Cómo comes',
  la_casa: 'La casa',
  salud: 'Salud',
  notas: 'Otras notas',
}

/** Where a fact comes from, in the reader's words. */
export type FichaOrigin = 'tu' | 'otra_persona' | 'alta' | 'deducido'

export type FichaSubject =
  | { kind: 'household' }
  | { kind: 'user'; userId: string }
  | { kind: 'person'; personId: string }

/** «casa», «u:<userId>», «p:<personId>»: the chip a fact belongs to. */
export type FichaPersonKey = string

export interface FichaFactView {
  id: string
  subjectKey: FichaPersonKey
  type: string
  topic: FichaTopic
  /** One sentence for the reader («Pizza los viernes en la cena»). */
  sentence: string
  origin: FichaOrigin
  /** «Lo dijiste tú» · «Lo dijo Marta» · «Del alta» · «Lo he deducido». */
  originLabel: string
  /** A temporary situation, or a fact with an end date. */
  temporary: boolean
  validUntil: string | null
  health: boolean
  /** The reader may confirm, correct or forget it (the household, themselves, a person without an account; never another member's). */
  canEdit: boolean
  updatedAt: string
}

export interface FichaPersonView {
  key: FichaPersonKey
  kind: 'household' | 'user' | 'person'
  /** «La casa», «Tú», the member's name, or the alias of a person without an account. */
  label: string
  /** People without an account: '0-2' | '3-5' | '6-12' | '13-17' | 'adulto'. */
  ageBand: string | null
  isViewer: boolean
  /** The reader may edit this person (people without an account). */
  canEdit: boolean
}

export interface FichaQuestionView {
  id: string
  question: string
  subjectKey: FichaPersonKey
  /** The fact the question is about, when there is one (yes keeps it, no forgets it). */
  factId: string | null
}

export type FichaChangeAction = 'added' | 'updated' | 'retired' | 'portrait'

export interface FichaChangeView {
  id: string
  /** The fact it changed (null for the portrait). */
  factId: string | null
  at: string
  action: FichaChangeAction
  /** «He apuntado» · «He cambiado» · «He dejado de pensar» · «Corregiste» · «Olvidaste» · «He reescrito». */
  verb: string
  sentence: string
  /** Mimo did it; the reader did it. */
  byMimo: boolean
  /** Mimo did it and the fact (or the portrait) is still as it left it. */
  canUndo: boolean
}

export interface FichaView {
  householdId: string
  portrait: { text: string; updatedAt: string } | null
  people: FichaPersonView[]
  facts: FichaFactView[]
  question: FichaQuestionView | null
  /** The last 14 days, newest first (at most 5; the full list is `…/changes`). */
  recent: FichaChangeView[]
  /** The reader paused «Aprender de lo que hago». */
  learningPaused: boolean
  /** The reader is a `child` member: they see nothing. */
  readOnly: boolean
}

export interface FichaWhyView {
  fact: FichaFactView
  /** «Casi seguro» · «Bastante seguro» · «Es una sospecha»; null when the reader said it. */
  confidence: string | null
  /** When the household first learnt it (AAAA-MM-DD). */
  since: string
  /** What Mimoia saw, newest first, in plain sentences. */
  evidence: Array<{ date: string; text: string }>
  /** «Cómo lo uso». */
  howIUse: string
}

/** Pure: the confidence word for a deduced fact. */
export function fichaConfidenceWord(confidence: number): string {
  if (confidence >= 0.85) return 'Casi seguro'
  if (confidence >= 0.6) return 'Bastante seguro'
  return 'Es una sospecha'
}
