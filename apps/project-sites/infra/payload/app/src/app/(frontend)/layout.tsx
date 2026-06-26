import React from 'react'
import type { Metadata } from 'next'
import { SERVER_URL } from '@/lib/payload'
import './styles.css'

export const metadata: Metadata = {
  metadataBase: new URL(SERVER_URL),
  title: { default: 'ProjectSites', template: '%s · ProjectSites' },
  description: 'AI-built websites, delivered.',
  alternates: { types: { 'application/rss+xml': `${SERVER_URL}/feed.xml` } },
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-nav">
          <a href="/" className="brand">
            ProjectSites
          </a>
          <nav>
            <a href="/posts">Blog</a>
            <a href="/admin">Admin</a>
          </nav>
        </header>
        {children}
        <footer className="site-footer">
          <p>© {new Date().getFullYear()} ProjectSites · built on Payload</p>
        </footer>
      </body>
    </html>
  )
}
