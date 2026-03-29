import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Finance Autopilot — Adversarial Investment Analysis',
  description: 'Red-teamed corporate finance analysis with live investor interrogation',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
