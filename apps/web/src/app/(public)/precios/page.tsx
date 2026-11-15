import type { Metadata } from "next"
import { planByKey } from "@ona/shared"
import { PricingPage } from "@/components/billing/PricingPage"

export const metadata: Metadata = {
  title: "Precios · Mimoia",
  description: `Esencial, ${planByKey("esencial").prices.mensual.label}, o Plus, ${planByKey("plus").prices.mensual.label}, para todo tu hogar. Qué incluye cada plan y en qué se diferencian.`,
}

export default function Page() {
  return <PricingPage />
}
