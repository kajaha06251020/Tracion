import type { Metadata } from 'next'
import './globals.css'
import { TRPCProvider } from '@/components/providers/trpc-provider'

export const metadata: Metadata = {
  title: 'Traceforge',
  description: 'AI agent observability',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <TRPCProvider>{children}</TRPCProvider>
      </body>
    </html>
  )
}
