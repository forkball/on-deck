import type { Handle, RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

import { ImportPicker } from '../../../browser/import-picker.tsx'
import type { ConflictEntry, DuplicateEntry, ReviewModel, ReviewRow } from '../../../data/imports/review.ts'
import type { LogValues } from '../../../data/imports/classify.ts'
import type { ImportBatch } from '../../../data/schema.ts'
import { routes } from '../../../routes.ts'
import { Document } from '../../../ui/components/document.tsx'
import { Nav } from '../../../ui/components/nav.tsx'
import { StarRatingDisplay } from '../../../ui/components/star-rating.tsx'

export interface ImportReviewPageProps {
  displayName: string
  batch: ImportBatch
  model: ReviewModel
  saved?: boolean
  error?: string
}

const ACCENT = '#3E5C76'

// Stands in for a row id inside the hrefs handed to the picker, which swaps it
// per row rather than building URLs of its own.
const ROW_TOKEN = '__row__'

function formatDate(at: number | null): string {
  if (at == null) return 'no date'
  return new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function Poster(handle: Handle<{ url: string | null; size?: number }>) {
  return () => {
    const { url, size = 44 } = handle.props
    const style = css({
      width: `${size}px`,
      height: `${Math.round(size * 1.45)}px`,
      flex: '0 0 auto',
      borderRadius: '3px',
      background: '#f0e9df',
      objectFit: 'cover',
    })

    return url ? <img src={url} alt="" mix={style} /> : <span mix={style} />
  }
}

// The rating as it reads in a log line: a score, an explicit dislike, or
// nothing at all — three different things, and "unrated" is not zero stars.
function Rated(handle: Handle<{ values: LogValues }>) {
  return () => {
    const { rating, disliked } = handle.props.values

    if (disliked) return <span>Not for me</span>
    if (rating == null) return <span mix={css({ color: '#888' })}>unrated</span>
    return <StarRatingDisplay value={rating} />
  }
}

function Flag(handle: Handle<{ title: string; count: number; children?: RemixNode }>) {
  return () => {
    const { title, count, children } = handle.props

    return (
      <section
        mix={css({
          border: '1px solid #d9cfbe',
          borderLeft: `4px solid ${ACCENT}`,
          borderRadius: '8px',
          background: '#fbf4ea',
          padding: '16px 18px',
          marginBottom: '18px',
        })}
      >
        <h2 mix={css({ margin: '0 0 4px' })}>
          {title} <span mix={css({ color: '#888', fontSize: '14px' })}>({count})</span>
        </h2>
        {children}
      </section>
    )
  }
}

function Card(handle: Handle<{ children?: RemixNode; attention?: boolean }>) {
  return () => {
    const { children, attention } = handle.props

    return (
      <div
        mix={css({
          border: `1px solid ${attention ? '#e3c9a3' : '#e2d8c8'}`,
          borderRadius: '8px',
          background: attention ? '#fdf6ec' : '#fffcf8',
          padding: '11px 13px',
          marginBottom: '8px',
        })}
      >
        {children}
      </div>
    )
  }
}

function ResolveForm(handle: Handle<{ batchId: string; rowId: number; action: string; label: string; primary?: boolean }>) {
  return () => {
    const { batchId, rowId, action, label, primary } = handle.props

    return (
      <form method="post" action={routes.profile.imports.resolve.href({ batchId, rowId: String(rowId) })}>
        <input type="hidden" name="action" value={action} />
        <button type="submit" mix={css({ fontSize: '13px' })}>
          {label}
        </button>
      </form>
    )
  }
}

// Opens the picker for one row. A plain button rather than a link: the modal is
// a single client entry for the whole page, and this is how it is told which
// row to open on.
function PickerButton(handle: Handle<{ rowId: number; label: string; primary?: boolean }>) {
  return () => {
    const { rowId, label, primary } = handle.props

    return (
      <button
        type="button"
        data-import-picker={String(rowId)}
        mix={css({ fontSize: '13px' })}
      >
        {label}
      </button>
    )
  }
}

function Actions(handle: Handle<{ children?: RemixNode }>) {
  return () => (
    <div mix={css({ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginTop: '8px' })}>
      {handle.props.children}
    </div>
  )
}

function ConflictCard(handle: Handle<{ batchId: string; entry: ConflictEntry }>) {
  return () => {
    const { batchId, entry } = handle.props
    const highlight = (field: 'rating' | 'watched' | 'notes') =>
      entry.fields.includes(field)
        ? css({ background: '#f2e4cb', borderRadius: '3px', padding: '0 3px' })
        : css({})

    const line = (label: string, values: LogValues) => (
      <div mix={css({ display: 'flex', gap: '10px', fontSize: '13.5px', lineHeight: 1.7 })}>
        <span
          mix={css({
            flex: '0 0 68px',
            color: '#8d8579',
            fontSize: '11px',
            letterSpacing: '.07em',
            textTransform: 'uppercase',
          })}
        >
          {label}
        </span>
        <span>
          <span mix={highlight('rating')}>
            <Rated values={values} />
          </span>
          {' · watched '}
          <span mix={highlight('watched')}>{formatDate(values.consumedAt)}</span>
          {values.notes ? (
            <span mix={highlight('notes')}> · has a note</span>
          ) : (
            <span mix={css({ color: '#888' })}> · no note</span>
          )}
        </span>
      </div>
    )

    return (
      <Card>
        <div mix={css({ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '8px' })}>
          <Poster url={entry.item.posterUrl} size={32} />
          <span>
            {entry.item.title} <span mix={css({ color: '#888' })}>{entry.item.releaseYear ?? ''}</span>
          </span>
        </div>
        {line('On Deck', entry.existing)}
        {line('Import', entry.incoming)}
        <Actions>
          {/* Per-row overrides sit under the bulk switch above; both write the
              same choice, so a row decided here follows the batch default. */}
          {/* Per-row overrides of the switch above. Keeping is not skipping:
              the row stays out of the log because it is already in it. */}
          <ResolveForm batchId={batchId} rowId={entry.row.id} action="keep" label="Keep" />
          <ResolveForm batchId={batchId} rowId={entry.row.id} action="take" label="Take" primary />
        </Actions>
      </Card>
    )
  }
}

function DuplicateCard(handle: Handle<{ batchId: string; entry: DuplicateEntry }>) {
  return () => {
    const { batchId, entry } = handle.props
    const { item, verdict } = entry

    const pair = (tag: string, title: string, year: number | null, extra?: string) => (
      <div
        mix={css({
          display: 'flex',
          gap: '10px',
          alignItems: 'baseline',
          fontSize: '13.5px',
          lineHeight: 1.6,
          marginBottom: '2px',
        })}
      >
        <span mix={css({ flex: '0 0 58px', color: '#8d8579', fontSize: '11px' })}>{tag}</span>
        <span mix={css({ flex: '1 1 auto', minWidth: 0 })}>
          {title} <span mix={css({ color: '#888' })}>{year ?? 'no year'}</span>
          {extra ? <span mix={css({ color: '#888' })}> · {extra}</span> : null}
        </span>
      </div>
    )

    return (
      <Card>
        <div mix={css({ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '8px' })}>
          <Poster url={item.posterUrl} size={32} />
          <span>
            Both matched to <b>{item.title}</b>{' '}
            <span mix={css({ color: '#888' })}>
              {item.releaseYear ?? ''}
              {item.creator ? ` · ${item.creator}` : ''}
            </span>
          </span>
        </div>

        {verdict.kind === 'different_films' ? (
          <>
            {pair(`Row ${verdict.anchor.index}`, verdict.anchor.title, verdict.anchor.year)}
            {pair(`Row ${verdict.move.index}`, verdict.move.title, verdict.move.year)}
            <p mix={css({ fontSize: '13.5px', color: ACCENT, margin: '10px 0 8px' })}>
              Your two rows disagree on the year, so these are almost certainly different films. Row{' '}
              {verdict.anchor.index} matches its own year, so row {verdict.move.index} is the one to move.
            </p>
            <Actions>
              <PickerButton rowId={verdict.move.id} label={`Find the right film for row ${verdict.move.index}`} primary />
            </Actions>
            <div mix={css({ margin: '16px 0 0' })}>
              <form
                method="post"
                action={routes.profile.imports.resolve.href({ batchId, rowId: String(verdict.move.id) })}
              >
                <input type="hidden" name="action" value="skip" />
                <button type="submit" class="linkish">
                  Actually the same film — leave row {verdict.move.index} out
                </button>
              </form>
            </div>
          </>
        ) : (
          <>
            {pair(`Row ${verdict.keep.index}`, verdict.keep.title, verdict.keep.year, formatDate(verdict.keep.consumedAt))}
            {pair(`Row ${verdict.drop.index}`, verdict.drop.title, verdict.drop.year, formatDate(verdict.drop.consumedAt))}
            <p mix={css({ fontSize: '13.5px', color: ACCENT, margin: '10px 0 8px' })}>
              Same title and year in both rows, so this looks like one film logged twice — a rewatch,
              most likely.
            </p>
            <Actions>
              <ResolveForm
                batchId={batchId}
                rowId={verdict.drop.id}
                action="skip"
                label={`Keep the ${formatDate(verdict.keep.consumedAt)} watch`}
                primary
              />
              <ResolveForm
                batchId={batchId}
                rowId={verdict.keep.id}
                action="skip"
                label={`Keep the ${formatDate(verdict.drop.consumedAt)} watch`}
              />
            </Actions>
          </>
        )}
      </Card>
    )
  }
}

function UncertainCard(handle: Handle<{ batchId: string; entry: ReviewRow }>) {
  return () => {
    const { batchId, entry } = handle.props
    const { row, item, chip } = entry

    return (
      <Card attention>
        <div mix={css({ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-start' })}>
          <div mix={css({ flex: '1 1 210px', minWidth: 0 })}>
            <div mix={css({ fontSize: '11px', letterSpacing: '.08em', textTransform: 'uppercase', color: '#8d8579' })}>
              Your CSV row
            </div>
            <div>
              {row.title} <span mix={css({ color: '#888' })}>{row.year ?? 'no year'}</span>
            </div>
            <div mix={css({ color: '#888', fontSize: '13px' })}>
              <Rated values={row} /> · watched {formatDate(row.consumedAt)}
            </div>
          </div>
          <div mix={css({ alignSelf: 'center', color: '#b3aa9c' })}>→</div>
          <div mix={css({ flex: '1 1 210px', minWidth: 0 })}>
            <div mix={css({ fontSize: '11px', letterSpacing: '.08em', textTransform: 'uppercase', color: '#8d8579' })}>
              We matched
            </div>
            <div mix={css({ display: 'flex', gap: '10px' })}>
              <Poster url={item?.posterUrl ?? null} />
              <span>
                {item?.title ?? 'nothing'} <span mix={css({ color: '#888' })}>{item?.releaseYear ?? ''}</span>
                {item?.creator ? (
                  <>
                    <br />
                    <span mix={css({ color: '#888' })}>{item.creator}</span>
                  </>
                ) : null}
              </span>
            </div>
          </div>
        </div>

        {chip ? (
          <div mix={css({ marginTop: '10px' })}>
            <span
              mix={css({
                display: 'inline-block',
                fontSize: '11.5px',
                padding: '1px 8px',
                borderRadius: '999px',
                border: '1px solid #d9cfbe',
                color: '#7a6f5d',
                background: '#f6efe3',
              })}
            >
              {chip}
            </span>
          </div>
        ) : null}

        <Actions>
          <ResolveForm batchId={batchId} rowId={row.id} action="confirm" label="Looks right" primary />
          <PickerButton rowId={row.id} label="Change" />
          <ResolveForm batchId={batchId} rowId={row.id} action="skip" label="Don't save" />
        </Actions>
      </Card>
    )
  }
}

export function ImportReviewPage(handle: Handle<ImportReviewPageProps>) {
  return () => {
    const { displayName, batch, model, saved, error } = handle.props
    const { counts } = model
    const batchId = batch.id

    return (
      <Document title="Review your import | On Deck">
        <Nav authed={true} displayName={displayName} />
        <main mix={css({ maxWidth: '720px', margin: '0 auto', padding: '32px 24px' })}>
          {saved ? (
            <>
              <h1>Added {counts.save} films</h1>
              <p mix={css({ color: '#15803d' })}>They're in your log now.</p>
              <ul mix={css({ color: '#555' })}>
                <li>{model.confidentCount} matched without help</li>
                <li>{counts.unchanged} already logged and left as they were</li>
                <li>{counts.leftOut} left out</li>
              </ul>
              <p>
                <a href={routes.profile.watched.href()}>See my log</a>
                {' · '}
                <a href={routes.profile.importMovies.index.href()}>Import another file</a>
              </p>
            </>
          ) : (
            <>
              <h1>Review before saving</h1>
              {error ? <p mix={css({ color: '#b91c1c' })}>{error}</p> : null}
              <p mix={css({ fontSize: '15px', margin: '0 0 4px' })}>
                {counts.total} rows. <b mix={css({ fontWeight: 400 })}>{model.confidentCount} matched cleanly</b>,{' '}
                {model.uncertain.length} worth a look, and {model.notFound.length} we couldn't find.
              </p>
              <p mix={css({ fontSize: '13px', color: ACCENT, marginBottom: '20px' })}>
                Everything saves unless you say otherwise — except the decisions below, which would
                change or drop something you already have.
              </p>

              {model.conflicts.length > 0 && (
                <Flag title="Already in your log" count={model.conflicts.length}>
                  <p mix={css({ fontSize: '14px', color: '#555', margin: '0 0 12px' })}>
                    You've logged these before, and the import disagrees. Rows matching what you
                    already have aren't listed — there's nothing to decide.
                  </p>
                  <form
                    method="post"
                    action={routes.profile.imports.conflicts.href({ batchId })}
                    mix={css({ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '14px' })}
                  >
                    <span mix={css({ fontSize: '13px', color: '#8d8579' })}>For all {model.conflicts.length}</span>
                    <button
                      type="submit"
                      name="choice"
                      value="keep"
                     
                      mix={css({ fontSize: '13px' })}
                    >
                      Keep what's on On Deck
                    </button>
                    <button
                      type="submit"
                      name="choice"
                      value="take"
                     
                      mix={css({ fontSize: '13px' })}
                    >
                      Take the import
                    </button>
                  </form>
                  {model.conflicts.slice(0, 10).map((entry) => (
                    <ConflictCard key={entry.row.id} batchId={batchId} entry={entry} />
                  ))}
                  {model.conflicts.length > 10 && (
                    <p mix={css({ fontSize: '13px', color: '#888', margin: '10px 0 0' })}>
                      {model.conflicts.length - 10} more — only the fields that differ are highlighted.
                    </p>
                  )}
                </Flag>
              )}

              {model.duplicates.length > 0 && (
                <Flag title="Two rows, one film" count={model.duplicates.length}>
                  <p mix={css({ fontSize: '14px', color: '#555', margin: '0 0 12px' })}>
                    Two rows landed on the same film, and your log keeps one entry per film. Usually
                    that means they're two different films sharing a name and one row matched wrong.
                  </p>
                  {model.duplicates.map((entry, i) => (
                    <DuplicateCard key={`${entry.item.id}-${i}`} batchId={batchId} entry={entry} />
                  ))}
                  <p mix={css({ fontSize: '13px', color: '#888', margin: '10px 0 0' })}>
                    Until you decide, the weaker match of each pair is held back rather than
                    overwriting the other.
                  </p>
                </Flag>
              )}

              {model.uncertain.length > 0 && (
                <>
                  <h2>
                    Worth a look <span mix={css({ color: '#888', fontSize: '14px' })}>({model.uncertain.length})</span>
                  </h2>
                  <p mix={css({ fontSize: '13px', color: '#888', marginBottom: '10px' })}>
                    Least certain first. These will be saved either way; the chip says what we're
                    unsure about.
                  </p>
                  {model.uncertain.slice(0, 25).map((entry) => (
                    <UncertainCard key={entry.row.id} batchId={batchId} entry={entry} />
                  ))}
                  {model.bulkAcceptable > 0 && (
                    <form
                      method="post"
                      action={routes.profile.imports.bulk.href({ batchId })}
                      mix={css({
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        flexWrap: 'wrap',
                        border: '1px dashed #cfc5b6',
                        borderRadius: '8px',
                        padding: '11px 14px',
                        background: '#fbf6ee',
                        marginTop: '10px',
                      })}
                    >
                      <span mix={css({ flex: '1 1 220px', fontSize: '14px' })}>
                        {model.bulkAcceptable} of these are within a year of your CSV — usually a
                        festival or re-release date.
                      </span>
                      <button type="submit" mix={css({ fontSize: '13px' })}>
                        Accept all {model.bulkAcceptable}
                      </button>
                    </form>
                  )}
                </>
              )}

              {model.notFound.length > 0 && (
                <>
                  <hr />
                  <h2>
                    Couldn't find <span mix={css({ color: '#888', fontSize: '14px' })}>({model.notFound.length})</span>
                  </h2>
                  <p mix={css({ fontSize: '13px', color: '#888', marginBottom: '10px' })}>
                    No catalog result under that name. <b>These won't be saved</b> unless you track
                    them down.
                  </p>
                  {model.notFound.slice(0, 25).map(({ row }) => (
                    <Card key={row.id}>
                      <div>
                        {row.title} <span mix={css({ color: '#888' })}>{row.year ?? 'no year'}</span>
                      </div>
                      <Actions>
                        <PickerButton rowId={row.id} label="Find it" primary />
                        <ResolveForm batchId={batchId} rowId={row.id} action="skip" label="Leave out" />
                      </Actions>
                    </Card>
                  ))}
                </>
              )}

              <div
                mix={css({
                  borderTop: '1px solid #ddd',
                  marginTop: '24px',
                  paddingTop: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '14px',
                  flexWrap: 'wrap',
                })}
              >
                <span mix={css({ fontSize: '13px', color: '#888' })}>
                  {counts.save} new · {counts.unchanged} unchanged · {counts.leftOut} left out
                </span>
                <span mix={css({ flex: '1 1 auto' })} />
                <a href={routes.profile.index.href()} mix={css({ fontSize: '14px' })}>
                  Decide later
                </a>
                <form method="post" action={routes.profile.imports.save.href({ batchId })}>
                  <button type="submit">
                    Save {counts.save} films to my log
                  </button>
                </form>
              </div>

              <ImportPicker
                candidatesTemplate={routes.profile.imports.candidates.href({ batchId, rowId: ROW_TOKEN })}
                resolveTemplate={routes.profile.imports.resolve.href({ batchId, rowId: ROW_TOKEN })}
                rowToken={ROW_TOKEN}
              />
            </>
          )}
        </main>
      </Document>
    )
  }
}
