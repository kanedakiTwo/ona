/**
 * ONA's nutritional philosophy.
 * These principles guide the advisor (Layer 3) and optionally the menu generator.
 * They are explicit but never imposed on the user.
 */
export const ONA_PRINCIPLES = [
  {
    id: 'reduce_processed',
    title: 'Reducir alimentos procesados y de absorcion rapida de glucosa',
    rationale: 'Los alimentos procesados elevan la insulina rapidamente y contribuyen a la resistencia insulinica a largo plazo.',
  },
  {
    id: 'anti_inflammatory',
    title: 'Priorizar alimentos antiinflamatorios',
    rationale: 'La inflamacion sistemica es el mecanismo subyacente de la mayoria de enfermedades cronicas. La dieta es el principal factor modificable.',
  },
  {
    id: 'seasonal',
    title: 'Respetar la estacionalidad',
    rationale: 'Los ingredientes de temporada tienen mejor perfil nutricional y son mas sostenibles.',
  },
  {
    id: 'variety',
    title: 'La variedad es salud',
    rationale: 'Un menu diverso asegura un espectro amplio de micronutrientes. ONA penaliza la monotonia en el algoritmo de generacion.',
  },
  {
    id: 'pleasure',
    title: 'El placer tambien importa',
    rationale: 'ONA no excluye platos que no son optimos nutricionalmente. El equilibrio semanal importa mas que la perfeccion diaria.',
  },
] as const
