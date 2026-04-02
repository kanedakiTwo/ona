import PublicNavbar from "@/components/shared/PublicNavbar"
import Footer from "@/components/shared/Footer"

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PublicNavbar />
      {children}
      <Footer />
    </>
  )
}
