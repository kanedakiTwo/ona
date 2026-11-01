/**
 * Catálogo de funciones (PRO-1023, D-122 punto 4): una entrada por truco de
 * la newsletter. Para cada una se guarda, por hogar, la primera y la última
 * vez y los usos en 30 días y en total. La pasada nocturna de la API
 * (`apps/api/src/services/featureUsage.ts`) lee aquí qué eventos de uso
 * (`usage_events`, specs/metrics.md) cuentan para cada función y guarda las
 * cifras en `household_feature_usage`. Spec: specs/feature-usage.md.
 *
 * - `kind: 'accion'`: cada evento es un uso.
 * - `kind: 'ajuste'`: algo que se deja puesto y actúa solo; cuenta una vez
 *   por semana (lunes a domingo, Europe/Madrid) en que actuó.
 * - `per: 'hogar'`: una fila por hogar; `'persona'`: una por persona y hogar.
 *
 * `events`: cuenta un evento si coincide con alguna regla: `name`, y si la
 * regla los trae, el `channel` y las `props` (todas las claves; un array es
 * «cualquiera de estos valores»).
 *
 * Añadir un truco = añadir una entrada (el id es estable: es la clave de las
 * filas guardadas). Los nombres de evento los comprueba un test de la API.
 */

export type FeatureKind = 'accion' | 'ajuste'
export type FeatureScope = 'hogar' | 'persona'

export interface FeatureEventRule {
  name: string
  channel?: 'web' | 'whatsapp' | 'voice'
  props?: Record<string, string | number | boolean | ReadonlyArray<string | number | boolean>>
}

export interface FeatureCatalogEntry {
  id: string
  /** Cómo se llama la función para un hogar (para la newsletter y los informes). */
  nombre: string
  kind: FeatureKind
  per: FeatureScope
  events: readonly FeatureEventRule[]
}

export const FEATURE_CATALOG = [
  { id: 'menu_semanal', nombre: 'Menú de la semana', kind: 'accion', per: 'hogar', events: [{ name: 'menu_generated' }] },
  { id: 'cambiar_plato', nombre: 'Cambiar un plato del menú', kind: 'accion', per: 'hogar', events: [{ name: 'meal_swapped' }] },
  { id: 'lista_compra', nombre: 'Lista de la compra', kind: 'accion', per: 'hogar', events: [{ name: 'shopping_list_viewed' }] },
  { id: 'marcar_lista', nombre: 'Tachar en la lista de la compra', kind: 'accion', per: 'hogar', events: [{ name: 'shopping_item_checked' }] },
  {
    id: 'receta_enlace',
    nombre: 'Guardar una receta desde un enlace',
    kind: 'accion',
    per: 'hogar',
    events: [{ name: 'recipe_imported', props: { source: ['url', 'whatsapp_url', 'social'] } }],
  },
  {
    id: 'receta_foto',
    nombre: 'Guardar una receta desde una foto',
    kind: 'accion',
    per: 'hogar',
    events: [{ name: 'recipe_imported', props: { source: ['photo', 'whatsapp_photo'] } }],
  },
  { id: 'receta_escrita', nombre: 'Escribir una receta', kind: 'accion', per: 'hogar', events: [{ name: 'recipe_created' }] },
  { id: 'modo_cocina', nombre: 'Modo cocina', kind: 'accion', per: 'hogar', events: [{ name: 'cook_mode_started' }] },
  { id: 'marcar_cocinado', nombre: 'Marcar lo que habéis comido', kind: 'accion', per: 'hogar', events: [{ name: 'meal_cooked' }] },
  { id: 'mimo_chat', nombre: 'Hablar con Mimo en la app', kind: 'accion', per: 'persona', events: [{ name: 'mimo_message', channel: 'web' }] },
  { id: 'mimo_whatsapp', nombre: 'Mimo por WhatsApp', kind: 'accion', per: 'persona', events: [{ name: 'mimo_message', channel: 'whatsapp' }] },
  { id: 'mimo_voz', nombre: 'Hablar con Mimo en voz alta', kind: 'accion', per: 'persona', events: [{ name: 'mimo_message', channel: 'voice' }] },
  {
    id: 'mimo_nota_voz',
    nombre: 'Notas de voz a Mimo por WhatsApp',
    kind: 'accion',
    per: 'persona',
    events: [{ name: 'mimo_message', channel: 'whatsapp', props: { kind: 'voice_note' } }],
  },
  { id: 'pedido_tiendas', nombre: 'Pedido a tus tiendas', kind: 'accion', per: 'hogar', events: [{ name: 'shop_order_prepared' }] },
  { id: 'pedido_carrefour', nombre: 'Pedido en Carrefour.es', kind: 'accion', per: 'hogar', events: [{ name: 'carrefour_click' }] },
  { id: 'cesta_extension', nombre: 'Cesta del súper con la extensión', kind: 'accion', per: 'hogar', events: [{ name: 'basket_extension_sent' }] },
  { id: 'afinar_menu', nombre: 'Afina tu menú', kind: 'accion', per: 'persona', events: [{ name: 'taste_tuning', props: { action: 'terminado' } }] },
  { id: 'invitar_hogar', nombre: 'Invitar a otro hogar', kind: 'accion', per: 'persona', events: [{ name: 'invite_shared' }] },
  // `app_opened_installed` se apunta una vez por hogar y día: por eso es del hogar.
  { id: 'app_instalada', nombre: 'La app instalada', kind: 'ajuste', per: 'hogar', events: [{ name: 'app_opened_installed' }] },
  { id: 'avisos', nombre: 'Avisos en el móvil', kind: 'ajuste', per: 'persona', events: [{ name: 'push_opened' }] },
] as const satisfies readonly FeatureCatalogEntry[]

export type FeatureId = (typeof FEATURE_CATALOG)[number]['id']

export const FEATURE_IDS: readonly FeatureId[] = FEATURE_CATALOG.map((f) => f.id)
