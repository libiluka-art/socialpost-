import './globals.css'
import { ReactNode } from 'react'

export const metadata = {
  title: 'SocialPost',
  description: 'A minimal social posting app',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="min-h-screen bg-gray-50">
          <main className="max-w-3xl mx-auto py-8 px-4">{children}</main>
        </div>
      </body>
    </html>
  )
}
