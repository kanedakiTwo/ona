import { redirect } from 'next/navigation'

// TODO(2026-07-03): drop /curator redirect once enough time has passed.
export default function CuratorRedirect() {
  redirect('/admin')
}
