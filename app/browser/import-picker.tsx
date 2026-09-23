import { clientEntry, css, on, ref } from 'remix/ui'

export type ImportPickerProps = {
  // Hrefs are built on the server so the route contract stays the one source of
  // URL shapes; `rowToken` is the placeholder in them this swaps for a row id.
  candidatesTemplate: string
  resolveTemplate: string
  rowToken: string
}

type Candidate = {
  externalId: string
  title: string
  year: number | null
  creator: string | null
  posterUrl: string | null
  // The line number of another row in this batch already using this film.
  claimedByRow: number | null
}

type PickerData = {
  rowIndex: number
  title: string
  year: number | null
  query: string
  suggestedExternalId: string | null
  candidates: Candidate[]
}

// Matches the autosuggest already in the app, so typing here behaves the way
// typing in the search box does.
const DEBOUNCE_MS = 250
const MIN_QUERY = 2

// One picker for the whole page rather than one modal per row: a 400-row import
// would otherwise render hundreds of dialogs to open at most a handful.
export const ImportPicker = clientEntry<ImportPickerProps>(import.meta.url, function ImportPicker(handle) {
  let openRowId: number | null = null
  let data: PickerData | null = null
  let loading = false
  let query = ''

  let debounce: ReturnType<typeof setTimeout> | undefined
  let inflight: AbortController | undefined

  function hrefFor(template: string, rowId: number): string {
    return template.replace(handle.props.rowToken, String(rowId))
  }

  function close() {
    openRowId = null
    data = null
    loading = false
    query = ''
    clearTimeout(debounce)
    inflight?.abort()
    handle.update()
  }

  async function load(rowId: number, search?: string) {
    inflight?.abort()
    const controller = new AbortController()
    inflight = controller

    loading = true
    handle.update()

    try {
      const url = new URL(hrefFor(handle.props.candidatesTemplate, rowId), window.location.origin)
      if (search) url.searchParams.set('q', search)

      const response = await fetch(url, { signal: controller.signal })
      if (!response.ok) throw new Error(String(response.status))

      data = (await response.json()) as PickerData
      if (search === undefined) query = data.query
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      data = null
    } finally {
      if (!controller.signal.aborted) {
        loading = false
        handle.update()
      }
    }
  }

  function search(value: string) {
    query = value
    clearTimeout(debounce)

    const trimmed = value.trim()
    if (trimmed.length < MIN_QUERY || openRowId == null) return

    const rowId = openRowId
    debounce = setTimeout(() => void load(rowId, trimmed), DEBOUNCE_MS)
  }

  // Picking is the answer: it submits straight away rather than asking for a
  // second confirmation, which is what made the first draft of this feel like
  // two steps for one decision.
  function choose(candidate: Candidate) {
    if (openRowId == null) return

    const form = document.createElement('form')
    form.method = 'post'
    form.action = hrefFor(handle.props.resolveTemplate, openRowId)

    const action = document.createElement('input')
    action.type = 'hidden'
    action.name = 'action'
    action.value = 'repoint'
    form.appendChild(action)

    const external = document.createElement('input')
    external.type = 'hidden'
    external.name = 'external_id'
    external.value = candidate.externalId
    form.appendChild(external)

    document.body.appendChild(form)
    form.submit()
  }

  return () => {
    const open = openRowId != null

    return (
      <div
        mix={[
          ref((_node, signal) => {
            // Delegated, so buttons rendered anywhere on the page open this
            // without every card needing its own hydration root.
            document.addEventListener(
              'click',
              (event) => {
                const target = event.target as HTMLElement | null
                const trigger = target?.closest?.('[data-import-picker]') as HTMLElement | null
                if (!trigger) return

                event.preventDefault()
                const rowId = Number(trigger.getAttribute('data-import-picker'))
                if (!Number.isFinite(rowId)) return

                openRowId = rowId
                data = null
                query = ''
                handle.update()
                void load(rowId)
              },
              { signal },
            )

            document.addEventListener(
              'keydown',
              (event) => {
                if (openRowId == null) return

                if (event.key === 'Escape') {
                  close()
                  return
                }

                // Number keys pick, because a long review is a lot of rows and
                // reaching for the mouse each time is most of the work.
                const index = Number(event.key)
                if (!Number.isInteger(index) || index < 1) return
                const candidate = data?.candidates[index - 1]
                if (!candidate) return
                if (document.activeElement instanceof HTMLInputElement) return

                event.preventDefault()
                choose(candidate)
              },
              { signal },
            )
          }),
          css({ display: open ? 'block' : 'none' }),
        ]}
      >
        {open && (
          <div
            mix={[
              css({
                position: 'fixed',
                inset: 0,
                background: 'rgba(0, 0, 0, 0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '16px',
                zIndex: 1000,
              }),
              on('click', (event) => {
                if (event.target === event.currentTarget) close()
              }),
            ]}
          >
            <div
              mix={css({
                background: '#fdf7f1',
                borderRadius: '8px',
                padding: '24px',
                maxWidth: '560px',
                width: '100%',
                maxHeight: '90vh',
                overflowY: 'auto',
              })}
            >
              <div
                mix={css({
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '12px',
                })}
              >
                <h3 mix={css({ margin: 0, fontWeight: 400 })}>
                  {data ? `Which film is row ${data.rowIndex}?` : 'Find this film'}
                </h3>
                <button
                  type="button"
                  class="bare"
                  aria-label="Close"
                  mix={[css({ fontSize: '20px' }), on('click', close)]}
                >
                  ✕
                </button>
              </div>

              {data && (
                <p mix={css({ fontSize: '13.5px', color: '#555', margin: '4px 0 14px' })}>
                  Your row: <b mix={css({ fontWeight: 400 })}>{data.title}</b>
                  {data.year ? ` · ${data.year}` : ''}
                </p>
              )}

              <input
                type="text"
                value={query}
                placeholder="Search the catalog…"
                autocomplete="off"
                mix={[
                  css({ width: '100%', marginBottom: '6px' }),
                  on('input', (event) => search((event.target as HTMLInputElement).value)),
                ]}
              />
              <p mix={css({ fontSize: '13px', color: '#888', margin: '0 0 14px' })}>
                {loading
                  ? 'Searching…'
                  : data
                    ? `${data.candidates.length} results · searched with your row's year`
                    : 'No results'}
              </p>

              <div mix={css({ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px' })}>
                {(data?.candidates ?? []).map((candidate, i) => (
                  <button
                    key={candidate.externalId}
                    type="button"
                    mix={[
                      css({
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                        background: 'none',
                        border: 0,
                        padding: 0,
                        cursor: 'pointer',
                        textAlign: 'left',
                        position: 'relative',
                      }),
                      on('click', () => choose(candidate)),
                    ]}
                  >
                    <span mix={css({ position: 'relative', display: 'block' })}>
                      {candidate.posterUrl ? (
                        <img
                          src={candidate.posterUrl}
                          alt=""
                          mix={css({
                            width: '100%',
                            aspectRatio: '2 / 3',
                            objectFit: 'cover',
                            borderRadius: '3px',
                          })}
                        />
                      ) : (
                        <span
                          mix={css({
                            display: 'block',
                            width: '100%',
                            aspectRatio: '2 / 3',
                            background: '#f0e9df',
                            borderRadius: '3px',
                          })}
                        />
                      )}
                      <span
                        mix={css({
                          position: 'absolute',
                          top: '4px',
                          left: '4px',
                          background: '#fdf7f1',
                          border: '1px solid #3c3c3c',
                          borderRadius: '4px',
                          fontSize: '11px',
                          padding: '0 5px',
                        })}
                      >
                        {i + 1}
                      </span>
                      {candidate.externalId === data?.suggestedExternalId && (
                        <span
                          mix={css({
                            // Along the bottom rather than beside the number:
                            // at four to a row there is not width for both at
                            // the top, and they overlapped.
                            position: 'absolute',
                            bottom: '4px',
                            left: '4px',
                            right: '4px',
                            background: '#3E5C76',
                            color: '#fff',
                            borderRadius: '4px',
                            fontSize: '10px',
                            padding: '1px 6px',
                            textAlign: 'center',
                          })}
                        >
                          suggested
                        </span>
                      )}
                      {/* Says which other row already holds this film, so
                            picking it can't silently recreate the duplicate
                            this was opened to fix. */}
                      {candidate.claimedByRow != null && (
                        <span
                          mix={css({
                            position: 'absolute',
                            top: '32px',
                            left: '4px',
                            right: '4px',
                            background: '#8a7a5c',
                            color: '#fff',
                            borderRadius: '4px',
                            fontSize: '10px',
                            padding: '1px 6px',
                            textAlign: 'center',
                          })}
                        >
                          row {candidate.claimedByRow} has this
                        </span>
                      )}
                    </span>
                    <span mix={css({ fontSize: '13.5px', lineHeight: 1.25 })}>
                      {candidate.title} <span mix={css({ color: '#888' })}>{candidate.year ?? ''}</span>
                    </span>
                    {candidate.creator && (
                      <span mix={css({ fontSize: '12px', color: '#888', lineHeight: 1.25 })}>
                        {candidate.creator}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              <p mix={css({ fontSize: '12px', color: '#8d8579', margin: '18px 0 0', textAlign: 'right' })}>
                1–{Math.min(9, data?.candidates.length ?? 0)} to pick · Esc to close
              </p>
            </div>
          </div>
        )}
      </div>
    )
  }
})
