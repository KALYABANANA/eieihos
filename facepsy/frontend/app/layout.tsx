import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Bangkok Hospital Ratchasima - Mental Wellness Screening',
  description: 'AI-powered facial behavior analysis for mental health screening - โรงพยาบาลกรุงเทพราชสีมา',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="th">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@300;400;500;600;700&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
        <link rel="icon" href="https://www.bangkokhospital.com/favicon.ico" />
      </head>
      <body style={{
        margin: 0,
        fontFamily: '"Noto Sans Thai", "Inter", system-ui, sans-serif',
        background: 'linear-gradient(180deg, #f0fafa 0%, #e0f2f1 100%)',
        minHeight: '100vh'
      }}>
        {children}
      </body>
    </html>
  )
}
