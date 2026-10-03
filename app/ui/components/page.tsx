import type { Handle, RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

import type { BackLink } from '../backLink.ts'
import { Document } from './document.tsx'
import { Nav, NAV_WIDTH } from './nav.tsx'

// The three column widths a page comes in. `wide` is the nav's own width, for
// pages whose content is itself wide — tabs, result grids, a poster beside its
// details. `narrow` is a lone form.
const MAIN_STYLES = {
  narrow: css({ maxWidth: '420px', margin: '0 auto', padding: '32px 24px' }),
  default: css({ maxWidth: '640px', margin: '0 auto', padding: '32px 24px' }),
  wide: css({ maxWidth: NAV_WIDTH, margin: '0 auto', padding: '32px 24px' }),
}

const backStyle = css({ margin: '0 0 16px' })

export type PageWidth = keyof typeof MAIN_STYLES

export interface PageProps {
  children?: RemixNode
  // The page's <h1>. Left out by a page that places its heading inside its own
  // layout (a poster beside the title); `.doodle main h1` in app.css still puts
  // it at the same height as everyone else's.
  heading?: string
  // The browser tab's title, before the app name is appended. Defaults to the
  // heading; null leaves the tab reading just the app name.
  title?: string | null
  // Where "back" goes, above the heading, when the page was opened from
  // somewhere worth returning to.
  back?: BackLink | null
  width?: PageWidth
  // The signed-in member's name for the nav. Absent on signed-out pages.
  displayName?: string
  // Anything that belongs in <head> beyond the title (a page's own script).
  head?: RemixNode
}

// Every page's frame: nav, the centred column, the back link and the heading,
// in that order, so no page arranges them its own way and puts its title at a
// different height from the next one.
export function Page(handle: Handle<PageProps>) {
  return () => {
    const { children, heading, title = heading, back, width = 'default', displayName, head } = handle.props

    return (
      <Document title={title ?? undefined} head={head}>
        <Nav authed={displayName !== undefined} displayName={displayName} />
        <main mix={MAIN_STYLES[width]}>
          {back && (
            <p mix={backStyle}>
              <a href={back.href} class="tap-area">
                {back.label}
              </a>
            </p>
          )}
          {heading !== undefined && <h1>{heading}</h1>}
          {children}
        </main>
      </Document>
    )
  }
}
