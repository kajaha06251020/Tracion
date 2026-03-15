import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'

export default async function RootPage() {
  const cookieStore = await cookies()
  const session =
    cookieStore.get('better-auth.session_token') ??
    cookieStore.get('__Secure-better-auth.session_token')

  if (session) {
    redirect('/dashboard')
  } else {
    redirect('/login')
  }
}
