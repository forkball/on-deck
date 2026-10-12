import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { MediaSummaries } from '../../data/mediaSummary.ts'
import type { TasteProfileSettings } from '../../data/recommendations/tasteProfile.ts'
import {
  ACTIVE_MEDIA_TYPES,
  DEFAULT_MEDIA_TYPE,
  MEDIA_TYPE_UI,
  type ActiveMediaType,
} from '../../mediaTypes.ts'
import type { listUserMediaLog } from '../../data/mediaItems.ts'
import { Toast } from '../../ui/components/toast.tsx'
import { PART_NAMES } from '../../data/profileTitles/catalog.ts'
import { CreditGroups, TITLES_TAB, type Credit } from '../../ui/components/credit-tiles.tsx'
import { UserTitle } from '../../ui/components/user-title.tsx'
import { routes } from '../../routes.ts'
import { Page } from '../../ui/components/page.tsx'
import { MediaTabs } from '../../ui/components/media-tabs.tsx'
import { MediaLogEditModal } from '../../ui/components/media-log-edit-modal.tsx'
import { WatchedListItem } from '../../ui/components/watched-list-item.tsx'
import { withReturnTo } from '../../ui/backLink.ts'
import { WaitingImports, type WaitingImport } from './waiting-imports.tsx'
import { Button, Link } from '../../ui/shared/form-controls.tsx'

type MediaLog = Awaited<ReturnType<typeof listUserMediaLog>>

export interface ProfilePageProps {
  // Keyed by media type rather than a prop per type — see loadMediaSummaries.
  media: MediaSummaries
  activeTab: ActiveMediaType | typeof TITLES_TAB
  bio: string
  followingCount: number
  followersCount: number
  saved?: boolean
  settings: TasteProfileSettings
  // Null when this account has no ceiling.
  rebuildsLeft: number | null
  rebuilt?: boolean
  rebuildError?: string
  // Imports still matching or waiting for review, each a way back to it.
  waitingImports: WaitingImport[]
  displayName: string
  // The title worn, already put into words, or null for none.
  title: string | null
  // Every credit, with yours marked and your progress on the rest, for the
  // Titles tab.
  credits: Credit[]
  // The keys worn now, so the Titles tab can mark them and swap one on a tap.
  worn: { adjective: string | null; noun: string | null }
  // Set when a title was just chosen from the Titles tab.
  titleSaved?: boolean
}

// What the settings amount to, in the words someone would use for their own
// log. Rebuild is a button that spends a model call, so it has to say what it
// would read before you press it — and the answer lives on another page.
function describeProfileSource(settings: TasteProfileSettings, mediaType: ActiveMediaType): string {
  const ui = MEDIA_TYPE_UI[mediaType]
  // Two different nouns from the registry, because the two phrasings want
  // different ones: "your whole movie log", but "your last 50 logged movies".
  const scope =
    settings.logLimit == null
      ? `your whole ${ui.attributive} log`
      : `your last ${settings.logLimit} logged ${ui.plural}`

  return settings.useNotes ? `${scope}, including the notes you've written` : `${scope}, without your notes`
}

function TasteProfileSummary(
  handle: Handle<{
    label: string
    summary: string
    updatedAt: number | null
    mediaType: ActiveMediaType
    settings: TasteProfileSettings
    // Counted the way the rebuild action counts it — rejections excluded. See
    // loadMediaSummaries.
    loggedCount: number
    rebuildsLeft: number | null
  }>,
) {
  return () => {
    const { label, summary, updatedAt, mediaType, settings, loggedCount, rebuildsLeft } = handle.props
    const nothingLogged = loggedCount === 0
    const outOfRebuilds = rebuildsLeft != null && rebuildsLeft <= 0
    const source = describeProfileSource(settings, mediaType)

    return (
      <details mix={css({ marginTop: '24px' })}>
        <summary class="tap-area" mix={css({ cursor: 'pointer' })}>
          <h2 mix={css({ display: 'inline' })}>{label}</h2>
        </summary>
        <div
          mix={css({
            border: '1px solid var(--rule)',
            borderRadius: '8px',
            padding: '16px',
            marginTop: '12px',
          })}
        >
          {summary ? (
            <>
              <p mix={css({ margin: 0 })}>{summary}</p>
              {updatedAt && (
                <p
                  mix={css({
                    margin: '8px 0 0',
                    fontSize: '12px',
                    color: 'var(--muted)',
                  })}
                >
                  Written from {source}, as your log stood on {new Date(updatedAt).toLocaleDateString()}. It's
                  rewritten next time you generate, if you've logged anything since.
                </p>
              )}
            </>
          ) : (
            <>
              <p mix={css({ margin: 0, color: 'var(--soft)' })}>
                Nothing yet — <Link href={routes.recommendations.index.href()}>get recommendations</Link> to
                have one written from what you've logged.
              </p>
              {/* Said in the future tense here, because there's nothing yet to
                  describe — but it's still what the button below would read. */}
              <p
                mix={css({
                  margin: '8px 0 0',
                  fontSize: '12px',
                  color: 'var(--muted)',
                })}
              >
                It'll be written from {source}.
              </p>
            </>
          )}

          {/* On a touch screen the link's tap area reaches 15px around it,
              2px more than the gap down to Rebuild below. Padding, because a
              margin here would only merge with the form's own. */}
          <p
            mix={css({
              margin: '8px 0 0',
              fontSize: '12px',
              '@media (pointer: coarse)': { paddingBottom: '4px' },
            })}
          >
            <Link href={routes.profile.edit.index.href()} tapArea>
              Change what it's written from →
            </Link>
          </p>

          <form
            method="post"
            action={routes.profile.rebuild.href({ mediaType })}
            mix={css({
              marginTop: '12px',
              display: 'flex',
              gap: '10px',
              alignItems: 'baseline',
            })}
          >
            {/* The action refuses both of these too. This only saves someone
                spending a click, and a rebuild, on finding that out. */}
            <Button type="submit" disabled={nothingLogged || outOfRebuilds}>
              Rebuild now
            </Button>
            {(nothingLogged || rebuildsLeft != null) && (
              <span mix={css({ fontSize: '12px', color: 'var(--muted)' })}>
                {nothingLogged
                  ? `Nothing logged to write one from`
                  : outOfRebuilds
                    ? 'No rebuilds left today'
                    : `${rebuildsLeft} rebuild${rebuildsLeft === 1 ? '' : 's'} left today`}
              </span>
            )}
          </form>
        </div>
      </details>
    )
  }
}

function LoggedList(
  handle: Handle<{
    log: MediaLog
    total: number
    detailHref: (mediaItemId: number) => string
    seeAllHref?: string
    emptyHref: string
    emptyLabel: string
    returnTo: string
    mediaType: ActiveMediaType
  }>,
) {
  return () => {
    const { log, total, detailHref, seeAllHref, emptyHref, emptyLabel, returnTo, mediaType } = handle.props

    if (log.length === 0) {
      return (
        <p>
          Nothing logged yet — <Link href={emptyHref}>{emptyLabel}</Link> to get started.
        </p>
      )
    }

    return (
      <>
        <ul
          mix={css({
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          })}
        >
          {log.map(({ interaction, item }) => (
            <WatchedListItem
              key={interaction.id}
              interaction={interaction}
              item={item}
              detailHref={item ? detailHref(item.id) : '#'}
              actions={
                <MediaLogEditModal
                  interaction={interaction}
                  title={item?.title ?? 'Unknown title'}
                  returnTo={returnTo}
                  mediaType={mediaType}
                />
              }
            />
          ))}
        </ul>
        {seeAllHref && total > log.length && (
          <p mix={css({ marginTop: '16px' })}>
            <Link href={seeAllHref}>See all →</Link>
          </p>
        )}
      </>
    )
  }
}

export function ProfilePage(handle: Handle<ProfilePageProps>) {
  return () => {
    const {
      media,
      activeTab,
      bio,
      followingCount,
      followersCount,
      saved,
      settings,
      rebuildsLeft,
      rebuilt,
      rebuildError,
      waitingImports,
      displayName,
      title,
      credits,
      worn,
      titleSaved,
    } = handle.props
    const profileHref = routes.profile.index.href()
    const savedReturnTo = `${profileHref}?saved=1`

    return (
      <Page title="My profile" heading={displayName} displayName={displayName}>
        {/* One at a time: these arrive as query params on a redirect, and no
            action sets more than one of them. */}
        {rebuildError ? (
          <Toast message={rebuildError} variant="error" />
        ) : rebuilt ? (
          <Toast message="Taste profile rewritten." />
        ) : saved ? (
          <Toast message="Saved." />
        ) : titleSaved ? (
          <Toast message="Title saved." />
        ) : null}
        <UserTitle title={title} />
        <p mix={css({ margin: '-8px 0 16px', color: 'var(--soft)' })}>
          <Link href={routes.profile.following.href()}>{followingCount} following</Link> ·{' '}
          <Link href={routes.profile.followers.href()}>
            {followersCount} follower{followersCount === 1 ? '' : 's'}
          </Link>
        </p>

        <WaitingImports imports={waitingImports} />

        {/* Rendered the way other people see it on users/show-page —
              editing it lives under Settings in the nav. */}
        {bio && <p mix={css({ whiteSpace: 'pre-wrap' })}>{bio}</p>}

        <MediaTabs
          idPrefix="profile"
          active={activeTab}
          extraTabs={[
            {
              id: TITLES_TAB,
              label: 'Titles',
              end: true,
              panel: (
                <>
                  <p mix={css({ margin: 0, color: 'var(--soft)' })}>
                    Tap a {PART_NAMES.adjective.one.toLowerCase()} and a {PART_NAMES.noun.one.toLowerCase()}{' '}
                    you've earned to wear them.
                  </p>
                  <CreditGroups
                    credits={credits}
                    picking={{
                      ...worn,
                      returnTo: `${profileHref}?tab=${TITLES_TAB}`,
                    }}
                  />
                </>
              ),
            },
          ]}
          panels={Object.fromEntries(
            ACTIVE_MEDIA_TYPES.map((type) => {
              const ui = MEDIA_TYPE_UI[type]
              const { summary, profileUpdatedAt, log, total } = media[type]
              const seeAllHref =
                type === DEFAULT_MEDIA_TYPE
                  ? routes.profile.watched.href()
                  : `${routes.profile.watched.href()}?type=${type}`

              return [
                type,
                <>
                  <h2>What I've {ui.pastParticiple}</h2>
                  <LoggedList
                    log={log}
                    total={total}
                    // Carries the tab, so "back" returns to the one you left.
                    detailHref={(id) => withReturnTo(ui.hrefs.show(id), `${profileHref}?tab=${type}`)}
                    seeAllHref={seeAllHref}
                    emptyHref={ui.hrefs.search()}
                    emptyLabel={`search for a ${ui.itemNoun}`}
                    returnTo={savedReturnTo}
                    mediaType={type}
                  />
                  {/* Under the log: what you've logged is what you come here for, and the
                      profile written from it is something to check now and then. */}
                  <TasteProfileSummary
                    label={`My ${ui.attributive} taste profile`}
                    summary={summary}
                    updatedAt={profileUpdatedAt}
                    mediaType={type}
                    settings={settings}
                    loggedCount={total}
                    rebuildsLeft={rebuildsLeft}
                  />
                </>,
              ]
            }),
          )}
        />

        {/* Below the log rather than up by the counts: it's a one-off, and the
            top of the page is for what you come back to. */}
        <p
          mix={css({
            borderTop: '1px solid var(--rule)',
            marginTop: '32px',
            paddingTop: '16px',
            fontSize: '14px',
            color: 'var(--soft)',
          })}
        >
          Logged things somewhere else?{' '}
          <Link href={routes.profile.import.href()}>Import from Letterboxd, Goodreads or Steam →</Link>
        </p>
      </Page>
    )
  }
}
