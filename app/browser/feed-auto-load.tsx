import { clientEntry, css, ref } from 'remix/ui'

export type FeedAutoLoadProps = {
  // Where to ask for the next page.
  feedHref: string
  // id of the server-rendered <ul> the new rows are appended to.
  listId: string
  // The cursor the first page ended on, already JSON. Opaque here: this only
  // hands it back to the server and stores whatever comes in return.
  cursor: string
  // Shown while a page is in flight, and as the "that's everything" line once
  // there is no cursor left. Server-rendered so it says something with JS off.
  statusId: string
  // What to put there on reaching the end. Passed in rather than read off the
  // status element: this only mounts when the *first* page had more to come, so
  // that element is empty at the time, and the line is needed later.
  endText: string
}

// How close to the sentinel the viewport has to get before the next page is
// asked for. A page's worth of margin means the rows are usually already there
// by the time the reader reaches the end of the current ones.
const ROOT_MARGIN = '600px'

// A page of rows arrives as a whole little document: the styles its components
// need in a <head>, then the rows. Both halves matter — a row whose kind wasn't
// on the first page brings CSS the document has never seen — so they are taken
// apart here and put where each belongs, rather than dropped into the list
// together and left to the fragment parser to sort out.
//
// Styles are keyed by the attribute the renderer stamps them with, so the ones
// already on the page are skipped instead of piling up a copy per page loaded.
function absorb(html: string, list: Element, seenStyles: Set<string>): void {
  const parsed = new DOMParser().parseFromString(html, 'text/html')

  for (const style of parsed.querySelectorAll('style[data-rmx]')) {
    const key = style.getAttribute('data-rmx')
    if (!key || seenStyles.has(key)) continue
    seenStyles.add(key)
    document.head.append(style)
  }

  list.append(...parsed.body.childNodes)
}

// Loads the rest of the activity feed as you reach the bottom of it.
//
// Appends server-rendered markup rather than building rows here: the row
// components live under app/ui and app/actions, which a client bundle can't
// import, and duplicating them in the browser is how the two drift apart. The
// route answers { html, cursor }; this puts the html in the list and keeps the
// cursor for the next ask.
//
// Deliberately doesn't render the list itself — client entry props are
// JSON-serialized, so an entry can't wrap server-rendered children. It renders
// a sentinel after the list and reaches for the list by id, the same way
// LazyList does.
//
// With JS off nothing observes anything and the feed is simply the first page,
// which is why the server renders a real page of rows rather than an empty list
// for this to fill.
export const FeedAutoLoad = clientEntry<FeedAutoLoadProps>(import.meta.url, function FeedAutoLoad(handle) {
  return () => {
    const { feedHref, listId, cursor, statusId, endText } = handle.props

    return (
      <div
        mix={[
          // Needs a little height so it can actually intersect the viewport.
          css({ height: '1px' }),
          ref((node, signal) => {
            const list = document.getElementById(listId)
            if (!list) return

            const status = document.getElementById(statusId)

            let next: string | null = cursor
            let loading = false

            // What the first render already put in the document, so a page's
            // styles are only added when they are genuinely new.
            const seenStyles = new Set<string>()
            for (const style of document.querySelectorAll('style[data-rmx]')) {
              const key = style.getAttribute('data-rmx')
              if (key) seenStyles.add(key)
            }

            const say = (text: string) => {
              if (status) status.textContent = text
            }

            // Nothing more to fetch: the server said so by sending no cursor.
            if (!next) return
            say('')

            const observer = new IntersectionObserver(
              (entries) => {
                if (loading || !next) return
                if (!entries.some((entry) => entry.isIntersecting)) return

                loading = true
                say('Loading…')

                void (async () => {
                  try {
                    const url = new URL(feedHref, window.location.href)
                    url.searchParams.set('cursor', next!)

                    const response = await fetch(url, {
                      signal,
                      headers: { Accept: 'application/json' },
                    })
                    if (!response.ok) throw new Error(String(response.status))

                    const page = (await response.json()) as { html: string; cursor: string | null }
                    if (signal.aborted) return

                    absorb(page.html, list, seenStyles)
                    next = page.cursor

                    if (!next) {
                      say(endText)
                      observer.disconnect()
                      return
                    }
                    say('')
                  } catch (error) {
                    if (error instanceof DOMException && error.name === 'AbortError') return
                    // A dropped page is not the end of the feed. The cursor is
                    // untouched, so scrolling past the sentinel tries again.
                    say('Could not load more — scroll to try again.')
                  } finally {
                    loading = false
                  }
                })()
              },
              { rootMargin: ROOT_MARGIN },
            )

            observer.observe(node)
            signal.addEventListener('abort', () => observer.disconnect())
          }),
        ]}
      />
    )
  }
})
