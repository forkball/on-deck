import type { Handle, RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

import type { BackLink } from '../backLink.ts'
import { Document } from './document.tsx'
import { Nav } from './nav.tsx'

// The three column widths a page comes in. `wide` is the 720 the nav uses, for
// pages whose content is itself wide — tabs, result grids, a poster beside its
// details. `narrow` is a lone form.
const WIDTHS = {
  narrow: '420px',
  default: '640px',
  wide: '720px',
} as const

export type PageWidth = keyof typeof WIDTHS

export interface PageProps {
  children?: RemixNode
  // The document title, before the " | On Deck" suffix. Omitted, the tab reads
  // just "On Deck".
  title?: string
  // The page's <h1>. Left out by a page that places its heading inside its own
  // layout (a poster beside the title, a heading that changes with the state
  // the page is in); `.doodle main h1` in app.css still puts it at the same
  // height as everyone else's.
  heading?: RemixNode
  // Where "back" goes, above the heading, when the page was opened from
  // somewhere worth returning to.
  back?: BackLink | null
  width?: PageWidth
  // Signed-out pages say so; everything else is behind login.
  authed?: boolean
  displayName?: string
  // Anything that belongs in <head> beyond the title (a page's own script).
  head?: RemixNode
  // A toast from the redirect that landed here. Toasts are position: fixed,
  // so this only decides where the markup goes, not where it shows.
  toast?: RemixNode
}

// Every page's frame: nav, the centred column, the back link and the heading,
// in that order, so no page arranges them its own way and puts its title at a
// different height from the next one.
export function Page(handle: Handle<PageProps>) {
  return () => {
    const {
      children,
      title,
      heading,
      back,
      width = 'default',
      authed = true,
      displayName,
      head,
      toast,
    } = handle.props

    return (
      <Document title={title == null ? undefined : `${title} | On Deck`} head={head}>
        <Nav authed={authed} displayName={displayName} />
        {toast}
        <main mix={css({ maxWidth: WIDTHS[width], margin: '0 auto', padding: '32px 24px' })}>
          {back && (
            <p mix={css({ margin: '0 0 16px' })}>
              <a href={back.href}>{back.label}</a>
            </p>
          )}
          {heading != null && <h1>{heading}</h1>}
          {children}
        </main>
      </Document>
    )
  }
}
