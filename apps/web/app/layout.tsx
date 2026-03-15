import type { Metadata } from 'next'
import './globals.css'
import { TRPCProvider } from '@/components/providers/trpc-provider'
import { Sidebar } from '@/components/nav/sidebar'

export const metadata: Metadata = {
  title: 'Traceforge',
  description: 'AI agent observability',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="flex bg-gray-50 dark:bg-gray-900 min-h-screen">
        <TRPCProvider>
          <Sidebar />
          <main className="flex-1 overflow-auto">
            {children}
          </main>
        </TRPCProvider>
      </body>
    </html>
  )
}
