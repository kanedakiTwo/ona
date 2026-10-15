import type { Metadata } from "next"
import { PricingPage } from "@/components/billing/PricingPage"

export const metadata: Metadata = {
  title: "Precios · Mimoia",
  description: "Esencial, 4,99 €/mes, o Plus, 8,99 €/mes, para todo tu hogar. Qué incluye cada plan y en qué se diferencian.",
}

export default function Page() {
  return <PricingPage />
}
