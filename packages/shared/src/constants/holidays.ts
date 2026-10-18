/**
 * Festivos nacionales y autonómicos (PRO-226, D-069).
 *
 * Fuente: la resolución anual de la Dirección General de Trabajo con la
 * relación de fiestas laborales, anexo «Fiestas laborales» del BOE:
 *   - 2026: Resolución de 17 de octubre de 2025, BOE núm. 259 de 28-10-2025,
 *     BOE-A-2025-21667 (https://www.boe.es/boe/dias/2025/10/28/pdfs/BOE-A-2025-21667.pdf)
 *   - 2027: Resolución de 8 de octubre de 2026, BOE núm. 254 de 13-10-2026,
 *     BOE-A-2026-21254 (https://www.boe.es/boe/dias/2026/10/13/pdfs/BOE-A-2026-21254.pdf)
 *
 * Cada fila es una fecha del anexo con las comunidades donde es fiesta
 * (`'todas'` = las 17 comunidades más Ceuta y Melilla). Los códigos son los de
 * ISO 3166-2:ES. No están: los festivos locales (dos por municipio, en cada
 * boletín provincial), las fiestas insulares de Canarias (nota 1 del anexo)
 * ni la sustitución del Arán (nota 2). Para añadir un año: copiar su anexo
 * aquí y en el test (`holidays.test.ts`).
 */

export const SPANISH_REGIONS = {
  AN: 'Andalucía',
  AR: 'Aragón',
  AS: 'Asturias',
  IB: 'Illes Balears',
  CN: 'Canarias',
  CB: 'Cantabria',
  CM: 'Castilla-La Mancha',
  CL: 'Castilla y León',
  CT: 'Cataluña',
  EX: 'Extremadura',
  GA: 'Galicia',
  MD: 'Comunidad de Madrid',
  MC: 'Región de Murcia',
  NC: 'Navarra',
  PV: 'País Vasco',
  RI: 'La Rioja',
  VC: 'Comunitat Valenciana',
  CE: 'Ceuta',
  ML: 'Melilla',
} as const

export type SpanishRegion = keyof typeof SPANISH_REGIONS
export const SPANISH_REGION_CODES = Object.keys(SPANISH_REGIONS) as SpanishRegion[]

export function isSpanishRegion(v: unknown): v is SpanishRegion {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(SPANISH_REGIONS, v)
}

export interface PublicHoliday {
  /** `YYYY-MM-DD`. */
  date: string
  name: string
  regions: 'todas' | readonly SpanishRegion[]
}

/** Years with the whole BOE annex in `PUBLIC_HOLIDAYS`. */
export const HOLIDAY_YEARS = [2026, 2027] as const

export const PUBLIC_HOLIDAYS: Record<(typeof HOLIDAY_YEARS)[number], readonly PublicHoliday[]> = {
  2026: [
    { date: '2026-01-01', name: 'Año Nuevo', regions: 'todas' },
    { date: '2026-01-06', name: 'Epifanía del Señor', regions: 'todas' },
    { date: '2026-02-28', name: 'Día de Andalucía', regions: ['AN'] },
    { date: '2026-03-02', name: 'Lunes siguiente al Día de les Illes Balears', regions: ['IB'] },
    { date: '2026-03-19', name: 'San José', regions: ['GA', 'MC', 'NC', 'PV', 'VC'] },
    { date: '2026-03-20', name: 'Fiesta del Eid Fitr', regions: ['ML'] },
    { date: '2026-04-02', name: 'Jueves Santo', regions: ['AN', 'AR', 'AS', 'IB', 'CN', 'CB', 'CM', 'CL', 'EX', 'GA', 'MD', 'MC', 'NC', 'PV', 'RI', 'CE', 'ML'] },
    { date: '2026-04-03', name: 'Viernes Santo', regions: 'todas' },
    { date: '2026-04-06', name: 'Lunes de Pascua', regions: ['IB', 'CM', 'CT', 'NC', 'PV', 'RI', 'VC'] },
    { date: '2026-04-23', name: 'San Jorge/Día de Aragón', regions: ['AR'] },
    { date: '2026-04-23', name: 'Fiesta de Castilla y León', regions: ['CL'] },
    { date: '2026-05-01', name: 'Fiesta del Trabajo', regions: 'todas' },
    { date: '2026-05-02', name: 'Fiesta de la Comunidad de Madrid', regions: ['MD'] },
    { date: '2026-05-27', name: 'Fiesta Sacrificio-Eidul Adha', regions: ['CE'] },
    { date: '2026-05-27', name: 'Fiesta Sacrificio-Aid al Adha', regions: ['ML'] },
    { date: '2026-05-30', name: 'Día de Canarias', regions: ['CN'] },
    { date: '2026-06-04', name: 'Corpus Christi', regions: ['CM'] },
    { date: '2026-06-09', name: 'Día de la Región de Murcia', regions: ['MC'] },
    { date: '2026-06-09', name: 'Día de la Rioja', regions: ['RI'] },
    { date: '2026-06-24', name: 'San Juan', regions: ['CT', 'GA', 'VC'] },
    { date: '2026-07-25', name: 'Santiago Apóstol/Día Nacional de Galicia', regions: ['GA', 'PV'] },
    { date: '2026-07-28', name: 'Día de las Instituciones de Cantabria', regions: ['CB'] },
    { date: '2026-08-05', name: 'Nuestra Señora de África', regions: ['CE'] },
    { date: '2026-08-15', name: 'Asunción de la Virgen', regions: 'todas' },
    { date: '2026-09-02', name: 'Día de Ceuta', regions: ['CE'] },
    { date: '2026-09-08', name: 'Día de Asturias', regions: ['AS'] },
    { date: '2026-09-08', name: 'Día de Extremadura', regions: ['EX'] },
    { date: '2026-09-11', name: 'Fiesta Nacional de Cataluña', regions: ['CT'] },
    { date: '2026-09-15', name: 'La Bien Aparecida', regions: ['CB'] },
    { date: '2026-10-09', name: 'Día de la Comunitat Valenciana', regions: ['VC'] },
    { date: '2026-10-12', name: 'Fiesta Nacional de España', regions: 'todas' },
    { date: '2026-11-02', name: 'Día siguiente a Todos los Santos', regions: ['AN', 'AR', 'AS', 'CN', 'CM', 'CL', 'EX', 'MD', 'NC'] },
    { date: '2026-12-07', name: 'Lunes siguiente al Día de la Constitución', regions: ['AN', 'AR', 'AS', 'CB', 'CL', 'EX', 'MD', 'MC', 'RI', 'ML'] },
    { date: '2026-12-08', name: 'Inmaculada Concepción', regions: 'todas' },
    { date: '2026-12-25', name: 'Natividad del Señor', regions: 'todas' },
    { date: '2026-12-26', name: 'San Esteban', regions: ['IB', 'CT'] },
  ],
  2027: [
    { date: '2027-01-01', name: 'Año Nuevo', regions: 'todas' },
    { date: '2027-01-06', name: 'Epifanía del Señor', regions: 'todas' },
    { date: '2027-03-01', name: 'Día de Andalucía', regions: ['AN'] },
    { date: '2027-03-01', name: 'Día de les Illes Balears', regions: ['IB'] },
    { date: '2027-03-10', name: 'Fiesta del Eid Fitr', regions: ['ML'] },
    { date: '2027-03-19', name: 'San José', regions: ['GA', 'MD', 'MC', 'NC', 'VC'] },
    { date: '2027-03-25', name: 'Jueves Santo', regions: ['AN', 'AR', 'AS', 'IB', 'CN', 'CB', 'CM', 'CL', 'EX', 'GA', 'MD', 'MC', 'NC', 'PV', 'RI', 'CE', 'ML'] },
    { date: '2027-03-26', name: 'Viernes Santo', regions: 'todas' },
    { date: '2027-03-29', name: 'Lunes de Pascua', regions: ['IB', 'CT', 'NC', 'PV', 'RI', 'VC'] },
    { date: '2027-04-23', name: 'San Jorge/Día de Aragón', regions: ['AR'] },
    { date: '2027-04-23', name: 'Fiesta de Castilla y León', regions: ['CL'] },
    { date: '2027-05-01', name: 'Fiesta del Trabajo', regions: 'todas' },
    { date: '2027-05-17', name: 'Día de las Letras Gallegas', regions: ['GA'] },
    { date: '2027-05-17', name: 'Eidul Adha-Fiesta Sacrificio', regions: ['CE'] },
    { date: '2027-05-17', name: 'Fiesta Sacrificio-Aid Al Adha', regions: ['ML'] },
    { date: '2027-05-27', name: 'Corpus Christi', regions: ['CM'] },
    { date: '2027-05-31', name: 'Día de Castilla-La Mancha', regions: ['CM'] },
    { date: '2027-06-09', name: 'Día de la Región de Murcia', regions: ['MC'] },
    { date: '2027-06-09', name: 'Día de La Rioja', regions: ['RI'] },
    { date: '2027-06-24', name: 'Día de San Juan', regions: ['CT'] },
    { date: '2027-07-28', name: 'Día de las Instituciones de Cantabria', regions: ['CB'] },
    { date: '2027-08-05', name: 'Nuestra Señora de África', regions: ['CE'] },
    { date: '2027-08-16', name: 'Lunes siguiente a asunción de la Virgen', regions: ['AN', 'AR', 'AS', 'CN', 'CL', 'MD'] },
    { date: '2027-09-08', name: 'Día de Asturias', regions: ['AS'] },
    { date: '2027-09-08', name: 'Día de Extremadura', regions: ['EX'] },
    { date: '2027-09-11', name: 'Fiesta Nacional de Cataluña', regions: ['CT'] },
    { date: '2027-09-15', name: 'La Bien Aparecida', regions: ['CB'] },
    { date: '2027-10-07', name: 'Aniversario 1er Gobierno Euskadi', regions: ['PV'] },
    { date: '2027-10-09', name: 'Día de la Comunitat Valenciana', regions: ['VC'] },
    { date: '2027-10-11', name: 'Sustitución 15 de agosto', regions: ['EX'] },
    { date: '2027-10-12', name: 'Fiesta Nacional de España', regions: 'todas' },
    { date: '2027-11-01', name: 'Todos los Santos', regions: 'todas' },
    { date: '2027-12-06', name: 'Día de la Constitución Española', regions: 'todas' },
    { date: '2027-12-08', name: 'Inmaculada Concepción', regions: 'todas' },
    { date: '2027-12-25', name: 'Natividad del Señor', regions: 'todas' },
  ],
}

/** The holiday on `date` in `region`, or null (also for a year not in the table). */
export function holidayOn(date: string, region: SpanishRegion | null | undefined): PublicHoliday | null {
  if (!region) return null
  const year = Number(date.slice(0, 4)) as (typeof HOLIDAY_YEARS)[number]
  const list = PUBLIC_HOLIDAYS[year]
  if (!list) return null
  const day = date.slice(0, 10)
  return list.find((h) => h.date === day && (h.regions === 'todas' || h.regions.includes(region))) ?? null
}

/**
 * The holidays of the week that starts on `weekStart` (a Monday,
 * `YYYY-MM-DD`) in `region`, as day indexes 0 (Monday) … 6 (Sunday).
 */
export function weekHolidays(weekStart: string, region: SpanishRegion | null | undefined): { dayIndex: number; date: string; name: string }[] {
  if (!region) return []
  const [y, m, d] = weekStart.slice(0, 10).split('-').map(Number)
  const out: { dayIndex: number; date: string; name: string }[] = []
  for (let i = 0; i < 7; i++) {
    const date = new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10)
    const h = holidayOn(date, region)
    if (h) out.push({ dayIndex: i, date, name: h.name })
  }
  return out
}
