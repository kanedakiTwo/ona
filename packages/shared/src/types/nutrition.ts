export interface Macros {
  protein: number
  carbohydrates: number
  fat: number
  fiber?: number
}

export interface Vitamins {
  A?: number
  C?: number
  D?: number
  E?: number
  K?: number
  B1?: number
  B2?: number
  B3?: number
  B5?: number
  B6?: number
  B9?: number
  B12?: number
  [key: string]: number | undefined
}

export interface Minerals {
  calcium?: number
  iron?: number
  iodine?: number
  magnesium?: number
  zinc?: number
  selenium?: number
  sodium?: number
  potassium?: number
  phosphorus?: number
  [key: string]: number | undefined
}

export interface AminoAcids {
  [key: string]: number | undefined
}

export interface FatAcids {
  saturated?: number
  monounsaturated?: number
  polyunsaturated?: number
  omega3?: number
  omega6?: number
  trans?: number
  cholesterol?: number
  [key: string]: number | undefined
}

export interface CarbTypes {
  sugars?: number
  starch?: number
  fiber?: number
  [key: string]: number | undefined
}

export interface NutrientBalance {
  protein: number
  carbohydrates: number
  fat: number
}
