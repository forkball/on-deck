import type { Handle, RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

import { ImportPicker } from '../../../browser/import-picker.tsx'
import { InPlaceForms } from '../../../browser/in-place-forms.tsx'
import { LazyList } from '../../../browser/lazy-list.tsx'
import type {
  ConflictEntry,
  DuplicateEntry,
  ReviewModel,
  ReviewRow,
  SectionKey,
} from '../../../data/imports/review.ts'
import { normalizeTitle, reasonGroup, type BulkKind, type LogValues } from '../../../data/imports/classify.ts'
import type { ImportBatch } from '../../../data/schema.ts'
import { mediaTypeUiFor } from '../../../mediaTypes.ts'
import type { MediaType } from '../../../data/mediaItems.ts'
import { routes } from '../../../routes.ts'
import { Document } from '../../../ui/components/document.tsx'
import { Modal } from '../../../ui/components/modal.tsx'
import { Nav } from '../../../ui/components/nav.tsx'
import { Collapsible } from '../../../ui/shared/collapsible.tsx'
import { count } from '../../../ui/shared/count.ts'
import { Field } from '../../../ui/shared/field.tsx'
import { StarRatingDisplay } from '../../../ui/components/star-rating.tsx'

export interface ImportReviewPageProps {
  displayName: string
  batch: ImportBatch
  model: ReviewModel
  saved?: boolean
  // Offer the Letterboxd diary feed after saving.
  offerFeed?: boolean
  reviewsOnly?: boolean
  error?: string
}

const ACCENT = '#3E5C76'

// Placeholder for a row id in the hrefs handed to the picker.
const ROW_TOKEN = '__row__'

// Every row is rendered; LazyList hides the tail until you scroll to it.
const CONFLICTS_VISIBLE = 10
const ROWS_VISIBLE = 25

const SAVE_ANCHOR = 'import-save'

// Where a no-JS redirect lands after each card: the card after it, or the save bar.
function nextAnchors(ordered: { row: { id: number } }[]): Map<number, string> {
  const next = new Map<number, string>()
  ordered.forEach(({ row }, i) => {
    const following = ordered[i + 1]
    next.set(row.id, following ? rowAnchor(following.row.id) : SAVE_ANCHOR)
  })
  return next
}

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

function Card(handle: Handle<{ children?: RemixNode; attention?: boolean; id?: string }>) {
  return () => {
    const { children, attention, id } = handle.props

    return (
      <div
        id={id}
        mix={css({
          scrollMarginTop: '12px',
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

// Posts in place (InPlaceForms); without JS, `anchor` is where the redirect lands.
function ResolveForm(
  handle: Handle<{
    batchId: string
    rowId: number
    action: string
    label: string
    variant?: ButtonVariant
    anchor?: string
    // For `repoint`: the catalog entry to point the row at.
    externalId?: string
  }>,
) {
  return () => {
    const { batchId, rowId, action, label, variant, anchor, externalId } = handle.props

    return (
      <form
        method="post"
        action={routes.profile.imports.resolve.href({ batchId, rowId: String(rowId) })}
        data-in-place
      >
        <input type="hidden" name="action" value={action} />
        {anchor && <input type="hidden" name="anchor" value={anchor} />}
        {externalId && <input type="hidden" name="external_id" value={externalId} />}
        <button type="submit" class={variant} mix={css({ fontSize: '13px' })}>
          {label}
        </button>
      </form>
    )
  }
}

type ButtonVariant = 'primary' | 'linkish' | 'compact'

function rowAnchor(rowId: number): string {
  return `row-${rowId}`
}

// Opens the page's one picker on this row.
function PickerButton(handle: Handle<{ rowId: number; label: string; variant?: ButtonVariant }>) {
  return () => {
    const { rowId, label, variant } = handle.props

    return (
      <button
        type="button"
        data-import-picker={String(rowId)}
        class={variant}
        mix={css({ fontSize: '13px' })}
      >
        {label}
      </button>
    )
  }
}

function Actions(handle: Handle<{ children?: RemixNode; gap?: string }>) {
  return () => (
    <div
      mix={css({
        display: 'flex',
        gap: handle.props.gap ?? '8px 12px',
        flexWrap: 'wrap',
        alignItems: 'center',
        marginTop: '8px',
      })}
    >
      {handle.props.children}
    </div>
  )
}

function ConflictCard(handle: Handle<{ batchId: string; entry: ConflictEntry; pastParticiple: string }>) {
  return () => {
    const { batchId, entry, pastParticiple } = handle.props
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
          {` · ${pastParticiple} `}
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
      <Card id={rowAnchor(entry.row.id)}>
        <div mix={css({ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '8px' })}>
          <Poster url={entry.item.posterUrl} size={32} />
          <span>
            {entry.item.title} <span mix={css({ color: '#888' })}>{entry.item.releaseYear ?? ''}</span>
          </span>
        </div>
        {line('On Deck', entry.existing)}
        {line('Import', entry.incoming)}
        <Actions>
          {/* Per-row overrides of the switch above. Neither is primary: taking overwrites. */}
          <ResolveForm
            batchId={batchId}
            rowId={entry.row.id}
            action="keep"
            label="Keep"
            anchor={rowAnchor(entry.row.id)}
          />
          <ResolveForm
            batchId={batchId}
            rowId={entry.row.id}
            action="take"
            label="Take"
            anchor={rowAnchor(entry.row.id)}
          />
        </Actions>
      </Card>
    )
  }
}

function DuplicateCard(
  handle: Handle<{
    batchId: string
    entry: DuplicateEntry
    singular: string
    plural: string
    pastParticiple: string
  }>,
) {
  return () => {
    const { batchId, entry, singular, plural, pastParticiple } = handle.props
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
              Your two rows disagree on the year, so these are almost certainly different {plural}. Row{' '}
              {verdict.anchor.index} matches its own year, so row {verdict.move.index} is the one to move.
            </p>
            <Actions>
              <PickerButton
                rowId={verdict.move.id}
                label={`Find the right ${singular} for row ${verdict.move.index}`}
                variant="primary"
              />
            </Actions>
            <div mix={css({ margin: '16px 0 0' })}>
              <ResolveForm
                batchId={batchId}
                rowId={verdict.move.id}
                action="skip"
                label={`Actually the same ${singular} — leave row ${verdict.move.index} out`}
                variant="linkish"
              />
            </div>
          </>
        ) : (
          <>
            {pair(
              `Row ${verdict.keep.index}`,
              verdict.keep.title,
              verdict.keep.year,
              formatDate(verdict.keep.consumedAt),
            )}
            {pair(
              `Row ${verdict.drop.index}`,
              verdict.drop.title,
              verdict.drop.year,
              formatDate(verdict.drop.consumedAt),
            )}
            <p mix={css({ fontSize: '13.5px', color: ACCENT, margin: '10px 0 8px' })}>
              Same title and year in both rows, so this looks like one {singular} logged twice — a rewatch,
              most likely.
            </p>
            <Actions>
              <ResolveForm
                batchId={batchId}
                rowId={verdict.drop.id}
                action="skip"
                label={`Keep the ${formatDate(verdict.keep.consumedAt)} watch`}
                variant="primary"
              />
              <ResolveForm
                batchId={batchId}
                rowId={verdict.keep.id}
                action="skip"
                label={`Keep the ${formatDate(verdict.drop.consumedAt)} ${pastParticiple}`}
              />
            </Actions>
          </>
        )}
      </Card>
    )
  }
}

function UncertainCard(
  handle: Handle<{
    batchId: string
    entry: ReviewRow
    pastParticiple: string
    next?: string
  }>,
) {
  return () => {
    const { batchId, entry, pastParticiple, next } = handle.props
    const { row, item, chip } = entry
    // No-year rows ask "which one?": the namesakes matching kept, else its own pick.
    const choices =
      row.reason !== 'no_year'
        ? null
        : (row.alternates ??
          (item && row.matchedExternalId
            ? [{ externalId: row.matchedExternalId, title: item.title, releaseYear: item.releaseYear }]
            : null))

    return (
      <Card attention id={rowAnchor(row.id)}>
        <div
          mix={css({
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'baseline',
            columnGap: '10px',
            rowGap: '2px',
          })}
        >
          <span mix={css({ flex: '1 1 auto', minWidth: 0 })}>
            {row.title} <span mix={css({ color: '#888' })}>{row.year ?? 'no year'}</span>
          </span>
          {chip ? (
            <span
              mix={css({
                fontSize: '11.5px',
                padding: '1px 8px',
                borderRadius: '999px',
                border: '1px solid #d9cfbe',
                color: '#7a6f5d',
                background: '#f6efe3',
                whiteSpace: 'nowrap',
              })}
            >
              {chip}
            </span>
          ) : null}
        </div>
        <div mix={css({ color: '#888', fontSize: '13px' })}>
          <Rated values={row} /> · {pastParticiple} {formatDate(row.consumedAt)}
        </div>

        {choices ? (
          <>
            <div mix={css({ fontSize: '13px', color: '#8d8579', marginTop: '10px' })}>Which one?</div>
            <Actions gap="6px">
              {/* None is primary: without a year our pick is a guess. */}
              {choices.map((choice) => {
                const ours = choice.externalId === row.matchedExternalId
                return (
                  <ResolveForm
                    key={choice.externalId}
                    batchId={batchId}
                    rowId={row.id}
                    action={ours ? 'confirm' : 'repoint'}
                    externalId={ours ? undefined : choice.externalId}
                    label={choiceLabel(choice.releaseYear)}
                    variant="compact"
                    anchor={next}
                  />
                )
              })}
            </Actions>
            <Actions>
              <PickerButton rowId={row.id} label="Something else…" variant="linkish" />
              <ResolveForm
                batchId={batchId}
                rowId={row.id}
                action="skip"
                label="Don't save"
                variant="linkish"
                anchor={next}
              />
            </Actions>
          </>
        ) : (
          <MatchedAnswers batchId={batchId} row={row} item={item} next={next} />
        )}
      </Card>
    )
  }
}

function NotFoundCard(handle: Handle<{ batchId: string; row: ReviewRow['row']; next?: string }>) {
  return () => {
    const { batchId, row, next } = handle.props
    return (
      <Card id={rowAnchor(row.id)}>
        <div>
          {row.title} <span mix={css({ color: '#888' })}>{row.year ?? 'no year'}</span>
        </div>
        <Actions>
          <PickerButton rowId={row.id} label="Find it" variant="primary" />
          <ResolveForm
            batchId={batchId}
            rowId={row.id}
            action="skip"
            label="Leave out"
            variant="linkish"
            anchor={next}
          />
        </Actions>
      </Card>
    )
  }
}

// A section's answered rows, one line each, opening back into the card so the
// answer can be changed. Collapsed, at the top of the section.
function AnsweredList(
  handle: Handle<{
    batchId: string
    section: SectionKey
    entries: ReviewRow[]
    pastParticiple: string
    // A finished section's accept, hidden from the drawer, so it can be unticked here.
    accepted?: DrawerSection['bulk']
  }>,
) {
  return () => {
    const { batchId, section, entries, pastParticiple, accepted } = handle.props
    if (entries.length === 0) return null

    return (
      <div mix={css({ margin: '0 0 10px', fontSize: '14px' })}>
        <Collapsible summary={<span mix={css({ color: '#6b6459' })}>{entries.length} answered</span>}>
          {accepted && (
            <div mix={css({ margin: '6px 0 2px' })}>
              <BulkAccept batchId={batchId} {...accepted} />
            </div>
          )}
          <ul mix={css({ listStyle: 'none', margin: '6px 0 0', padding: 0 })}>
            {entries.map((entry) => {
              const { row, item } = entry
              const dropped = row.state === 'skipped'
              return (
                // A block, so DoodleCSS's "* " list marker doesn't show.
                <li key={row.id} mix={css({ display: 'block', borderBottom: '1px solid #eee4d6' })}>
                  <details data-close-on-submit>
                    <summary
                      mix={css({
                        display: 'flex',
                        alignItems: 'baseline',
                        gap: '8px',
                        padding: '6px 0',
                        cursor: 'pointer',
                        listStyle: 'none',
                        '&::-webkit-details-marker': { display: 'none' },
                      })}
                    >
                      <span
                        aria-hidden="true"
                        mix={css({ width: '1em', color: dropped ? '#a8a097' : '#15803d' })}
                      >
                        {dropped ? '✕' : '✓'}
                      </span>
                      <span mix={css({ flex: '1 1 auto', minWidth: 0 })}>
                        {row.title}
                        <span mix={css({ color: '#888' })}>
                          {dropped ? ' · not saving' : item ? ` → ${answeredMatch(row.title, item)}` : ''}
                        </span>
                      </span>
                      <span mix={css({ color: '#6b6459', fontSize: '13px', textDecoration: 'underline' })}>
                        Change
                      </span>
                    </summary>
                    {section === 'not_found' ? (
                      <NotFoundCard batchId={batchId} row={row} />
                    ) : (
                      <UncertainCard batchId={batchId} entry={entry} pastParticiple={pastParticiple} />
                    )}
                  </details>
                </li>
              )
            })}
          </ul>
        </Collapsible>
      </div>
    )
  }
}

// The year alone when the title is the file's own, else the catalog title too.
function answeredMatch(title: string, item: NonNullable<ReviewRow['item']>): string {
  const year = item.releaseYear == null ? '' : String(item.releaseYear)
  if (normalizeTitle(item.title) === normalizeTitle(title)) return year || item.title
  return year ? `${item.title} ${year}` : item.title
}

function choiceLabel(year: number | null): string {
  return year == null ? 'Undated' : String(year)
}

function MatchedAnswers(
  handle: Handle<{ batchId: string; row: ReviewRow['row']; item: ReviewRow['item']; next?: string }>,
) {
  return () => {
    const { batchId, row, item, next } = handle.props

    return (
      <>
        <div mix={css({ display: 'flex', gap: '10px', alignItems: 'center', margin: '8px 0 0' })}>
          <Poster url={item?.posterUrl ?? null} size={32} />
          <span mix={css({ fontSize: '14px', minWidth: 0 })}>
            <span mix={css({ color: '#8d8579', fontSize: '12px' })}>Matched to </span>
            {item?.title ?? 'nothing'} <span mix={css({ color: '#888' })}>{item?.releaseYear ?? ''}</span>
            {item?.creator ? <span mix={css({ color: '#888' })}> · {item.creator}</span> : null}
          </span>
        </div>

        <Actions>
          <ResolveForm
            batchId={batchId}
            rowId={row.id}
            action="confirm"
            label="Looks right"
            variant="primary"
            anchor={next}
          />
          <PickerButton rowId={row.id} label="Change" />
          <ResolveForm
            batchId={batchId}
            rowId={row.id}
            action="skip"
            label="Don't save"
            variant="linkish"
            anchor={next}
          />
        </Actions>
      </>
    )
  }
}

function leftOutReason(state: string): string {
  if (state === 'not_found') return 'not found in the catalog'
  if (state === 'skipped') return 'you left it out'
  return 'held back as a duplicate'
}

const savedListStyle = css({ margin: 0, paddingLeft: '18px', fontSize: '14px' })

function groupAnchor(key: SectionKey): string {
  return `group-${key}`
}

// The pinned drawer: a checklist of the sections and the one Save, which asks
// first only when something would go in unchecked or be left out. CSS-only: a
// hidden checkbox opens it, and its state survives in-place reloads.
const DRAWER_TOGGLE = 'import-drawer-toggle'
const CONFIRM_TOGGLE = 'import-confirm-toggle'

// Checked means "not the default": open on a phone, closed on desktop.
const drawerOpen = `&:has(#${DRAWER_TOGGLE}:checked)`
const drawerStyle = css({
  position: 'sticky',
  bottom: 0,
  zIndex: 10,
  background: '#FDF7F1',
  borderTop: '1px solid #ddd',
  boxShadow: '0 -6px 12px -10px rgba(0, 0, 0, 0.35)',
  marginTop: '24px',
  padding: '8px 0',
  '& .drawer-check': { position: 'absolute', width: 0, height: 0, opacity: 0, pointerEvents: 'none' },
  '& .drawer-panel': { display: 'none', maxHeight: '45vh', overflowY: 'auto', padding: '4px 0 10px' },
  '& .drawer-arrow::before': { content: '"▲"' },
  // Here, not in its own css(): each css() is its own cascade layer.
  '& .drawer-row': { display: 'flex', alignItems: 'center', gap: '8px 12px', padding: '8px 0' },
  [`${drawerOpen} .drawer-panel`]: { display: 'block' },
  [`${drawerOpen} .drawer-arrow::before`]: { content: '"▼"' },
  '@media (min-width: 720px)': {
    '& .drawer-panel': { display: 'block' },
    '& .drawer-arrow::before': { content: '"▼"' },
    [`${drawerOpen} .drawer-panel`]: { display: 'none' },
    [`${drawerOpen} .drawer-arrow::before`]: { content: '"▲"' },
  },
} as Parameters<typeof css>[0])

interface DrawerSection {
  key: SectionKey
  title: string
  href: string
  total: number
  open: number
  bulk: { kind: BulkKind; count: number; accepted: number; what: string } | null
}

function ReviewDrawer(
  handle: Handle<{
    batchId: string
    sections: DrawerSection[]
    unchecked: number
    leftOut: number
    save: number
    singular: string
    plural: string
  }>,
) {
  return () => {
    const { batchId, sections, unchecked, leftOut, save, singular, plural } = handle.props
    const needsConfirm = unchecked > 0 || leftOut > 0
    const saveLabel = save > 0 ? 'Save' : 'Finish'
    const confirmLabel = save > 0 ? `Yes, save ${count(save, singular, plural)}` : 'Yes, finish'

    const progress =
      sections.length === 0 ? 'Nothing to review' : unchecked > 0 ? `${unchecked} unchecked` : 'All checked'

    const saveForm = (label: string) => (
      <form method="post" action={routes.profile.imports.save.href({ batchId })}>
        <button type="submit" class="primary">
          {label}
        </button>
      </form>
    )

    return (
      <div id={SAVE_ANCHOR} mix={drawerStyle}>
        <input
          type="checkbox"
          id={DRAWER_TOGGLE}
          class="drawer-check"
          aria-label="Show the review checklist"
        />

        <div class="drawer-panel">
          <ul mix={css({ listStyle: 'none', margin: 0, padding: 0 })}>
            {sections.map((section) => (
              <li
                key={section.key}
                mix={css({
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'baseline',
                  gap: '4px 8px',
                  padding: '4px 0',
                  fontSize: '14px',
                  borderBottom: '1px solid #eee4d6',
                })}
              >
                <span
                  aria-hidden="true"
                  mix={css({ width: '1em', color: section.open ? '#b3aa9c' : '#15803d' })}
                >
                  {section.open ? '○' : '✓'}
                </span>
                {section.open ? (
                  <a href={section.href} mix={css({ flex: '1 1 auto' })}>
                    {section.title}
                  </a>
                ) : (
                  <span mix={css({ flex: '1 1 auto', color: '#888' })}>{section.title}</span>
                )}
                <span mix={css({ color: '#888', fontSize: '13px', whiteSpace: 'nowrap' })}>
                  {section.open === 0
                    ? `all ${section.total} done`
                    : section.key === 'not_found'
                      ? `${section.open} left · not saved`
                      : `${section.open} of ${section.total} left`}
                </span>
                {/* A done section's ✓ says enough; its accept moves to the answered list. */}
                {section.open > 0 &&
                  section.bulk &&
                  (section.bulk.count > 0 || section.bulk.accepted > 0) && (
                    <div mix={css({ flex: '1 0 100%', paddingLeft: 'calc(1em + 8px)' })}>
                      <BulkAccept batchId={batchId} {...section.bulk} />
                    </div>
                  )}
              </li>
            ))}
          </ul>
        </div>

        <div class="drawer-row">
          <label
            for={DRAWER_TOGGLE}
            mix={css({
              flex: '1 1 auto',
              minWidth: 0,
              whiteSpace: 'nowrap',
              cursor: 'pointer',
              fontSize: '13px',
              color: '#555',
            })}
          >
            <span
              class="drawer-arrow"
              aria-hidden="true"
              mix={css({ marginRight: '6px', color: '#8d8579' })}
            />
            {progress}
          </label>
          {needsConfirm ? (
            // Opens the Modal below; styled on the span because DoodleCSS pads <label>.
            <label for={CONFIRM_TOGGLE} mix={css({ cursor: 'pointer', flex: '0 0 auto' })}>
              <span class="doodle-border primary">{saveLabel}</span>
            </label>
          ) : (
            saveForm(saveLabel)
          )}
        </div>

        {needsConfirm && (
          <Modal
            id={CONFIRM_TOGGLE}
            closeButton={false}
            title={unchecked > 0 ? `Save with ${unchecked} unchecked?` : 'Save the rest?'}
          >
            <p mix={css({ margin: '0 0 16px' })}>
              {save > 0
                ? `${count(save, singular, plural)} go into your log.`
                : 'Nothing new goes into your log.'}
              {unchecked > 0 && ` ${unchecked} of them unchecked, saved as we matched them.`}
              {leftOut > 0 && ` ${leftOut} left out.`}
            </p>
            <div
              mix={css({
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '10px',
              })}
            >
              {saveForm(confirmLabel)}
              <label
                for={CONFIRM_TOGGLE}
                mix={css({ cursor: 'pointer', color: '#6b6459', textDecoration: 'underline' })}
              >
                Go back
              </label>
            </div>
          </Modal>
        )}
      </div>
    )
  }
}

// Each section's one-tap accept; which rows it covers is bulkKind's call.
const SECTION_BULK: Partial<Record<SectionKey, { kind: BulkKind; what: string }>> = {
  title_differs: { kind: 'subtitle', what: 'your title plus a subtitle' },
  no_year: { kind: 'sole', what: 'the only film by that name' },
  year_drift: { kind: 'year', what: 'within a year of your file' },
}

function bulkFor(key: SectionKey, model: ReviewModel): DrawerSection['bulk'] {
  const offer = SECTION_BULK[key]
  if (!offer) return null
  return { ...offer, count: model.bulk[offer.kind].length, accepted: model.accepted[offer.kind].length }
}

function acceptedBy(key: SectionKey, model: ReviewModel): DrawerSection['bulk'] {
  const bulk = bulkFor(key, model)
  return bulk && bulk.accepted > 0 ? bulk : null
}

// A submit button drawn as a checkbox, so it works without JS. Pressed again
// once ticked, it unticks and the accepted rows come back as cards.
function BulkAccept(
  handle: Handle<{
    batchId: string
    kind: BulkKind
    count: number
    accepted: number
    what: string
  }>,
) {
  return () => {
    const { batchId, kind, count, accepted, what } = handle.props
    const ticked = accepted > 0
    const n = ticked ? accepted : count
    return (
      <form method="post" action={routes.profile.imports.bulk.href({ batchId })} data-in-place>
        <input type="hidden" name="kind" value={kind} />
        {ticked && <input type="hidden" name="undo" value="1" />}
        <button
          type="submit"
          class={ticked ? 'checkline ticked' : 'checkline'}
          aria-pressed={ticked ? 'true' : 'false'}
        >
          <span class="checkline-box" aria-hidden="true" />
          Accept {n} · {what}
        </button>
      </form>
    )
  }
}

const REVIEW_SECTIONS = ['title_differs', 'no_year', 'year_drift'] as const

// A section stays once all its cards are answered: its answered list is where
// an answer gets changed.
function reviewGroups(model: ReviewModel, singular: string, plural: string) {
  return REVIEW_SECTIONS.map((key) => ({
    key,
    ...reasonGroup(key, singular, plural),
    entries: model.uncertain.filter(({ row }) => row.reason === key),
  })).filter((group) => group.entries.length > 0 || model.answered[group.key].length > 0)
}

export function ImportReviewPage(handle: Handle<ImportReviewPageProps>) {
  return () => {
    const { displayName, batch, model, saved, offerFeed, reviewsOnly, error } = handle.props
    const { counts } = model
    const { singular, plural, pastParticiple, hrefs } = mediaTypeUiFor(batch.media_type as MediaType)
    const batchId = batch.id
    const answeredCount = Object.values(model.answered).reduce((sum, rows) => sum + rows.length, 0)
    const uncertainGroups = reviewGroups(model, singular, plural)
    const next = nextAnchors([...uncertainGroups.flatMap((group) => group.entries), ...model.notFound])
    return (
      <Document title="Review your import | On Deck">
        <Nav authed={true} displayName={displayName} />
        <main mix={css({ maxWidth: '720px', margin: '0 auto', padding: '32px 24px' })}>
          {saved ? (
            <>
              <h1>Saved {count(counts.save, singular, plural)} to your log</h1>
              <p mix={css({ color: '#15803d' })}>They're in your log now.</p>
              <ul mix={css({ color: '#555' })}>
                <li>{model.confidentCount} matched without help</li>
                {model.confirmedCount > 0 && <li>{model.confirmedCount} you checked or picked</li>}
                {model.uncertain.length > 0 && (
                  <li>{model.uncertain.length} saved as we matched them, unchecked</li>
                )}
                {counts.unchanged > 0 && (
                  <li>{counts.unchanged} already in your log and left as they were</li>
                )}
                {counts.leftOut > 0 && <li>{counts.leftOut} left out</li>}
              </ul>

              {/* Named, with a link to each, so a wrong match can still be fixed. */}
              {model.uncertain.length > 0 && (
                <Collapsible summary={`The ${model.uncertain.length} saved as we matched them`} boxed>
                  <p mix={css({ fontSize: '13px', color: '#888', margin: '0 0 8px' })}>
                    We weren't sure about these. If one is the wrong {singular}, open it, remove it from your
                    log, and log the right one.
                  </p>
                  <ul mix={savedListStyle}>
                    {model.uncertain.map(({ row, item }) => (
                      <li key={row.id} mix={css({ marginBottom: '4px' })}>
                        {item ? (
                          <a href={hrefs.show(item.id)}>
                            {item.title} {item.releaseYear ?? ''}
                          </a>
                        ) : (
                          row.title
                        )}
                      </li>
                    ))}
                  </ul>
                </Collapsible>
              )}
              {model.leftOutRows.length > 0 && (
                <Collapsible summary={`The ${model.leftOutRows.length} left out`} boxed>
                  <ul mix={savedListStyle}>
                    {model.leftOutRows.map((row) => (
                      <li key={row.id} mix={css({ marginBottom: '4px' })}>
                        {row.title} {row.year ?? ''}{' '}
                        <span mix={css({ color: '#888' })}>· {leftOutReason(row.state)}</span>
                      </li>
                    ))}
                  </ul>
                </Collapsible>
              )}
              <p>
                <a href={routes.profile.watched.href()}>See my log</a>
                {' · '}
                <a href={routes.profile.importMovies.index.href()}>Import another file</a>
              </p>

              {/* An export is a snapshot; the feed keeps it current. Offered, not done for them. */}
              {offerFeed && (
                <section
                  mix={css({
                    border: '1px solid #d9cfbe',
                    borderRadius: '8px',
                    padding: '16px 18px',
                    marginTop: '24px',
                  })}
                >
                  <h2 mix={css({ marginTop: 0, fontSize: '15px' })}>Keep it up to date?</h2>
                  <p mix={css({ fontSize: '13px', color: '#555', marginTop: 0 })}>
                    This file is a snapshot. Connect your diary and what you log on Letterboxd from here on
                    follows on its own.
                  </p>
                  <form
                    method="post"
                    action={routes.profile.letterboxd.connect.href()}
                    mix={css({ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '12px' })}
                  >
                    <Field
                      label="Letterboxd username"
                      hint="The last part of your profile URL — letterboxd.com/yourname/"
                    >
                      <input
                        type="text"
                        name="username"
                        placeholder="yourname"
                        autocomplete="off"
                        spellcheck={false}
                      />
                    </Field>
                    <button type="submit">Connect</button>
                  </form>
                </section>
              )}
            </>
          ) : (
            <>
              {/* One wrapper, so the drawer keeps its position (and open state) across reloads. */}
              <div>
                <h1>Review before saving</h1>
                {error ? <p mix={css({ color: '#b91c1c' })}>{error}</p> : null}
                <p mix={css({ fontSize: '15px', margin: '0 0 4px' })}>
                  {counts.total} rows.{' '}
                  {model.alreadyLoggedIds.length > 0 &&
                    `${model.alreadyLoggedIds.length} already in your log, `}
                  <b mix={css({ fontWeight: 400 })}>{model.confidentCount} matched cleanly</b>
                  {answeredCount > 0 && `, ${answeredCount} answered`}, {model.uncertain.length} worth a look,
                  and {model.notFound.length} we couldn't find.
                </p>
                {reviewsOnly && (
                  <p
                    mix={css({
                      fontSize: '13px',
                      color: '#8a5a1e',
                      background: '#fdf3e3',
                      border: '1px solid #f0dcbb',
                      borderRadius: '4px',
                      padding: '10px 12px',
                      margin: '0 0 16px',
                    })}
                  >
                    This is only the films you reviewed — <b mix={css({ fontWeight: 600 })}>reviews.csv</b>{' '}
                    carries nothing about the rest of what you've watched. Upload the whole export zip instead
                    if you want your full history.
                  </p>
                )}
                <p mix={css({ fontSize: '13px', color: ACCENT, marginBottom: '20px' })}>
                  Everything saves unless you say otherwise — except the decisions below, which would change
                  or drop something you already have.
                </p>

                {model.conflicts.length > 0 && (
                  <Flag title="Already in your log" count={model.conflicts.length}>
                    <p mix={css({ fontSize: '14px', color: '#555', margin: '0 0 12px' })}>
                      You've logged these before, and the import disagrees. Rows matching what you already
                      have aren't listed — there's nothing to decide.
                    </p>
                    <form
                      method="post"
                      action={routes.profile.imports.conflicts.href({ batchId })}
                      data-in-place
                      mix={css({
                        display: 'flex',
                        gap: '8px',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        marginBottom: '14px',
                      })}
                    >
                      <span mix={css({ fontSize: '13px', color: '#8d8579' })}>
                        For all {model.conflicts.length}
                      </span>
                      <button
                        type="submit"
                        name="choice"
                        value="keep"
                        class={batch.conflict_choice === 'keep' ? 'primary' : undefined}
                        mix={css({ fontSize: '13px' })}
                      >
                        Keep what's on On Deck
                      </button>
                      <button
                        type="submit"
                        name="choice"
                        value="take"
                        class={batch.conflict_choice === 'take' ? 'primary' : undefined}
                        mix={css({ fontSize: '13px' })}
                      >
                        Take the import
                      </button>
                    </form>
                    <div id="import-conflicts">
                      {model.conflicts.map((entry) => (
                        <ConflictCard
                          key={entry.row.id}
                          batchId={batchId}
                          entry={entry}
                          pastParticiple={pastParticiple}
                        />
                      ))}
                    </div>
                    <LazyList
                      listId="import-conflicts"
                      initial={CONFLICTS_VISIBLE}
                      step={CONFLICTS_VISIBLE}
                    />
                    <p mix={css({ fontSize: '13px', color: '#888', margin: '10px 0 0' })}>
                      Only the fields that differ are highlighted.
                    </p>
                  </Flag>
                )}

                {model.duplicates.length > 0 && (
                  <Flag title={`Two rows, one ${singular}`} count={model.duplicates.length}>
                    <p mix={css({ fontSize: '14px', color: '#555', margin: '0 0 12px' })}>
                      Two rows landed on the same {singular}, and your log keeps one entry per {singular}.
                      Usually that means they're two different {plural} sharing a name and one row matched
                      wrong.
                    </p>
                    {model.duplicates.map((entry, i) => (
                      <DuplicateCard
                        key={`${entry.item.id}-${i}`}
                        batchId={batchId}
                        entry={entry}
                        singular={singular}
                        plural={plural}
                        pastParticiple={pastParticiple}
                      />
                    ))}
                    <p mix={css({ fontSize: '13px', color: '#888', margin: '10px 0 0' })}>
                      Until you decide, the weaker match of each pair is held back rather than overwriting the
                      other.
                    </p>
                  </Flag>
                )}

                {uncertainGroups.length > 0 && (
                  <>
                    <h2>
                      Worth a look{' '}
                      <span mix={css({ color: '#888', fontSize: '14px' })}>({model.uncertain.length})</span>
                    </h2>
                    <p mix={css({ fontSize: '13px', color: '#888', marginBottom: '10px' })}>
                      Least certain first. These save as matched unless you say otherwise.
                    </p>
                    {uncertainGroups.map((group) => (
                      <section
                        key={group.key}
                        id={groupAnchor(group.key)}
                        mix={css({ marginBottom: '18px', scrollMarginTop: '12px' })}
                      >
                        <h3 mix={css({ margin: '14px 0 2px', fontSize: '16px' })}>
                          {group.title}{' '}
                          <span mix={css({ color: '#888', fontSize: '13px', fontWeight: 400 })}>
                            ({group.entries.length})
                          </span>
                        </h3>
                        {group.blurb && (
                          <p mix={css({ fontSize: '13px', color: '#888', margin: '0 0 8px' })}>
                            {group.blurb}
                          </p>
                        )}
                        <AnsweredList
                          batchId={batchId}
                          section={group.key}
                          entries={model.answered[group.key]}
                          pastParticiple={pastParticiple}
                          accepted={group.entries.length === 0 ? acceptedBy(group.key, model) : null}
                        />
                        <div id={`import-uncertain-${group.key}`}>
                          {group.entries.map((entry) => (
                            <UncertainCard
                              key={entry.row.id}
                              batchId={batchId}
                              entry={entry}
                              pastParticiple={pastParticiple}
                              next={next.get(entry.row.id)}
                            />
                          ))}
                        </div>
                        <LazyList
                          listId={`import-uncertain-${group.key}`}
                          initial={ROWS_VISIBLE}
                          step={ROWS_VISIBLE}
                        />
                      </section>
                    ))}
                  </>
                )}

                {(model.notFound.length > 0 || model.answered.not_found.length > 0) && (
                  <>
                    <hr />
                    <h2 id={groupAnchor('not_found')} mix={css({ scrollMarginTop: '12px' })}>
                      Couldn't find{' '}
                      <span mix={css({ color: '#888', fontSize: '14px' })}>({model.notFound.length})</span>
                    </h2>
                    <p mix={css({ fontSize: '13px', color: '#888', marginBottom: '10px' })}>
                      No catalog result under that name. <b>These won't be saved</b> unless you track them
                      down.
                    </p>
                    <AnsweredList
                      batchId={batchId}
                      section="not_found"
                      entries={model.answered.not_found}
                      pastParticiple={pastParticiple}
                    />
                    <div id="import-not-found">
                      {model.notFound.map(({ row }) => (
                        <NotFoundCard key={row.id} batchId={batchId} row={row} next={next.get(row.id)} />
                      ))}
                    </div>
                    <LazyList listId="import-not-found" initial={ROWS_VISIBLE} step={ROWS_VISIBLE} />
                  </>
                )}
              </div>

              <ReviewDrawer
                batchId={batchId}
                sections={model.sections.map((section) => ({
                  ...section,
                  title:
                    section.key === 'not_found'
                      ? "Couldn't find"
                      : reasonGroup(section.key, singular, plural).title,
                  href: `#${groupAnchor(section.key)}`,
                  bulk: bulkFor(section.key, model),
                }))}
                unchecked={model.uncertain.length}
                leftOut={counts.leftOut}
                save={counts.save}
                singular={singular}
                plural={plural}
              />

              <InPlaceForms />
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
