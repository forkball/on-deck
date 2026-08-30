import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { MediaSummaries } from '../../data/mediaSummary.ts'
import type { LuckyState } from '../../data/recommendations/lucky.ts'
import type { TasteProfileSettings } from '../../data/recommendations/tasteProfile.ts'
import {
  DEFAULT_MEDIA_TYPE,
  enabledMediaTypes,
  MEDIA_TYPE_UI,
  type ActiveMediaType,
} from '../../mediaTypes.ts'
import type { listUserMediaLog } from '../../data/mediaItems.ts'
import { Toast } from '../../ui/components/toast.tsx'
import { luckyRecommendationsHref, routes } from '../../routes.ts'
import { Document } from '../../ui/components/document.tsx'
import { MediaTabs } from '../../ui/components/media-tabs.tsx'
import { LuckyPickCard } from '../../ui/components/lucky-pick-card.tsx'
import { MediaLogEditModal } from '../../ui/components/media-log-edit-modal.tsx'
import { Nav } from '../../ui/components/nav.tsx'
import { WatchedListItem } from '../../ui/components/watched-list-item.tsx'
import { withReturnTo } from '../../ui/backLink.ts'

type MediaLog = Awaited<ReturnType<typeof listUserMediaLog>>

// TV has no equivalent worth importing.
const IMPORT_LINKS: Partial<Record<ActiveMediaType, { href: string; label: string }>> = {
  movie: { href: routes.profile.importMovies.index.href(), label: 'Import from Letterboxd' },
  book: { href: routes.profile.importBooks.index.href(), label: 'Import from Goodreads' },
  game: { href: routes.profile.importGames.index.href(), label: 'Import from Steam' },
}

export interface ProfilePageProps {
  // Keyed by media type rather than a prop per type — see loadMediaSummaries.
  media: MediaSummaries
  activeTab: ActiveMediaType
  bio: string
  followingCount: number
  followersCount: number
  saved?: boolean
  settings: TasteProfileSettings
  // Null when this account has no ceiling.
  rebuildsLeft: number | null
  rebuilt?: boolean
  rebuildError?: string
  // Today's one-click pick, shown above the tabs so it is the same thing here as
  // on the landing page rather than something to go looking for.
  lucky: LuckyState
  displayName: string
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

  return settings.useNotes
    ? `${scope}, including the notes you've written`
    : `${scope}, without your notes`
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
      <details>
        <summary mix={css({ cursor: 'pointer' })}>
          <h2 mix={css({ display: 'inline' })}>{label}</h2>
        </summary>
        <div mix={css({ border: '1px solid #ddd', borderRadius: '8px', padding: '16px', marginTop: '12px' })}>
          {summary ? (
            <>
              <p mix={css({ margin: 0 })}>{summary}</p>
              {updatedAt && (
                <p mix={css({ margin: '8px 0 0', fontSize: '12px', color: '#888' })}>
                  Written from {source}, as your log stood on{' '}
                  {new Date(updatedAt).toLocaleDateString()}. It's rewritten next time you generate, if
                  you've logged anything since.
                </p>
              )}
            </>
          ) : (
            <>
              <p mix={css({ margin: 0, color: '#555' })}>
                Nothing yet — <a href={routes.recommendations.index.href()}>get recommendations</a> to have
                one written from what you've logged.
              </p>
              {/* Said in the future tense here, because there's nothing yet to
                  describe — but it's still what the button below would read. */}
              <p mix={css({ margin: '8px 0 0', fontSize: '12px', color: '#888' })}>
                It'll be written from {source}.
              </p>
            </>
          )}

          <p mix={css({ margin: '8px 0 0', fontSize: '12px' })}>
            <a href={routes.profile.edit.index.href()}>Change what it's written from →</a>
          </p>

          <form
            method="post"
            action={routes.profile.rebuild.href({ mediaType })}
            mix={css({ marginTop: '12px', display: 'flex', gap: '10px', alignItems: 'baseline' })}
          >
            {/* The action refuses both of these too. This only saves someone
                spending a click, and a rebuild, on finding that out. */}
            <button type="submit" disabled={nothingLogged || outOfRebuilds}>
              Rebuild now
            </button>
            {(nothingLogged || rebuildsLeft != null) && (
              <span mix={css({ fontSize: '12px', color: '#888' })}>
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
          Nothing logged yet — <a href={emptyHref}>{emptyLabel}</a> to get started.
        </p>
      )
    }

    return (
      <>
        <ul mix={css({ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '16px' })}>
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
            <a href={seeAllHref}>See all →</a>
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
      lucky,
      displayName,
    } = handle.props
    const profileHref = routes.profile.index.href()
    const savedReturnTo = `${profileHref}?saved=1`

    return (
      <Document title="My profile | On Deck">
        <Nav authed={true} displayName={displayName} />
        {/* One at a time: these arrive as query params on a redirect, and no
            action sets more than one of them. */}
        {rebuildError ? (
          <Toast message={rebuildError} variant="error" />
        ) : rebuilt ? (
          <Toast message="Taste profile rewritten." />
        ) : saved ? (
          <Toast message="Saved." />
        ) : null}
        <main mix={css({ maxWidth: '640px', margin: '0 auto', padding: '32px 24px' })}>
          <div mix={css({ display: 'flex', alignItems: 'baseline', gap: '12px' })}>
            <h1>{displayName}</h1>
            <a
              href={routes.profile.edit.index.href()}
              title="Edit profile"
              aria-label="Edit profile"
              mix={css({ fontSize: '20px', textDecoration: 'none' })}
            >
              ✎
            </a>
          </div>
          <p mix={css({ margin: '-8px 0 16px', color: '#555' })}>
            <a href={routes.profile.following.href()}>{followingCount} following</a> ·{' '}
            <a href={routes.profile.followers.href()}>
              {followersCount} follower{followersCount === 1 ? '' : 's'}
            </a>
          </p>

          {/* Rendered the way other people see it on users/show-page —
              editing it lives behind the pencil above. */}
          {bio ? (
            <p mix={css({ whiteSpace: 'pre-wrap' })}>{bio}</p>
          ) : (
            <p mix={css({ color: '#555' })}>
              No bio yet — <a href={routes.profile.edit.index.href()}>add one</a> for other people to read.
              It has no effect on your recommendations.
            </p>
          )}

          {lucky.pick ? (
            <div mix={css({ margin: '24px 0' })}>
              <LuckyPickCard pick={lucky.pick} returnTo={`${profileHref}?tab=${lucky.pick.mediaType}`} />
            </div>
          ) : (
            <p mix={css({ margin: '24px 0', color: '#555' })}>
              {/* rmx-document forces a full document load — see media-tab-links.tsx.
                  Otherwise a client-side frame reload can land on the recommendations
                  form with fresh `startLucky` props but stale local `runKind` state,
                  leaving the shortlist/lucky radio and the settings it hides out of
                  sync until a radio is clicked directly. */}
              <a href={luckyRecommendationsHref()} rmx-document="">
                🎲 Draw today's lucky pick
              </a>{' '}
              — one thing nobody's logged, picked for you.
            </p>
          )}

          <MediaTabs
            idPrefix="profile"
            active={activeTab}
            panels={Object.fromEntries(
              enabledMediaTypes().map((type) => {
                const ui = MEDIA_TYPE_UI[type]
                const { summary, profileUpdatedAt, log, total } = media[type]
                const seeAllHref =
                  type === DEFAULT_MEDIA_TYPE
                    ? routes.profile.watched.href()
                    : `${routes.profile.watched.href()}?type=${type}`

                return [
                  type,
                  <>
                    <TasteProfileSummary
                      label={`My ${ui.attributive} taste profile`}
                      summary={summary}
                      updatedAt={profileUpdatedAt}
                      mediaType={type}
                      settings={settings}
                      loggedCount={total}
                      rebuildsLeft={rebuildsLeft}
                    />
                    {/* Each importer only understands one medium, so the
                        entry point lives on that medium's tab. */}
                    {IMPORT_LINKS[type] ? (
                      <div
                        mix={css({
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'baseline',
                          gap: '12px',
                        })}
                      >
                        <h2>What I've {ui.pastParticiple}</h2>
                        <a href={IMPORT_LINKS[type]!.href} mix={css({ fontSize: '13px', textAlign: 'right' })}>
                          {IMPORT_LINKS[type]!.label}
                        </a>
                      </div>
                    ) : (
                      <h2>What I've {ui.pastParticiple}</h2>
                    )}
                    <LoggedList
                      log={log}
                      total={total}
                      // Carries the tab, so "back" returns to the one you left.
                      detailHref={(id) =>
                        withReturnTo(ui.hrefs.show(id), `${profileHref}?tab=${type}`)
                      }
                      seeAllHref={seeAllHref}
                      emptyHref={ui.hrefs.search()}
                      emptyLabel={`search for a ${ui.itemNoun}`}
                      returnTo={savedReturnTo}
                      mediaType={type}
                    />
                  </>,
                ]
              }),
            )}
          />
        </main>
      </Document>
    )
  }
}
