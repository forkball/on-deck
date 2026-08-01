import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { MediaSummaries } from '../../data/mediaSummary.ts'
import { ACTIVE_MEDIA_TYPES, MEDIA_TYPE_UI, type ActiveMediaType } from '../../utils/mediaTypes.ts'
import type { listUserMediaLog } from '../../data/mediaCatalog.ts'
import { routes } from '../../routes.ts'
import { Document } from '../../ui/components/document.tsx'
import { Field } from '../../assets/lib/field.tsx'
import { MediaTabs } from '../../ui/components/media-tabs.tsx'
import { Modal } from '../../ui/components/modal.tsx'
import { MediaLogEditModal } from '../../ui/components/media-log-edit-modal.tsx'
import { Nav } from '../../ui/components/nav.tsx'
import { WatchedListItem } from '../../ui/components/watched-list-item.tsx'

type MediaLog = Awaited<ReturnType<typeof listUserMediaLog>>

// Bulk-import entry points, per media type. Movies come from Letterboxd,
// books from a Goodreads export; TV has no equivalent worth importing.
const IMPORT_LINKS: Partial<Record<ActiveMediaType, { href: string; label: string }>> = {
  movie: { href: routes.profile.importMovies.index.href(), label: 'Import from Letterboxd' },
  book: { href: routes.profile.importBooks.index.href(), label: 'Import from Goodreads' },
}

export interface ProfilePageProps {
  // Keyed by media type rather than a prop per type — see loadMediaSummaries.
  media: MediaSummaries
  activeTab: ActiveMediaType
  bio: string
  followingCount: number
  followersCount: number
  saved?: boolean
  displayName: string
}

function TasteProfileSummary(handle: Handle<{ label: string; summary: string }>) {
  return () => {
    const { label, summary } = handle.props

    return (
      <details>
        <summary mix={css({ cursor: 'pointer' })}>
          <h2 mix={css({ display: 'inline' })}>{label}</h2>
        </summary>
        <div mix={css({ border: '1px solid #ddd', borderRadius: '8px', padding: '16px', marginTop: '12px' })}>
          {summary ? (
            <p mix={css({ margin: 0 })}>{summary}</p>
          ) : (
            <p mix={css({ margin: 0, color: '#555' })}>
              Nothing yet — <a href={routes.recommendations.index.href()}>get recommendations</a> to have one
              written from what you've logged.
            </p>
          )}
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
            <a href={seeAllHref}>See all {total} →</a>
          </p>
        )}
      </>
    )
  }
}

export function ProfilePage(handle: Handle<ProfilePageProps>) {
  return () => {
    const { media, activeTab, bio, followingCount, followersCount, saved, displayName } = handle.props
    const profileHref = routes.profile.index.href()
    const savedReturnTo = `${profileHref}?saved=1`

    return (
      <Document title="My profile | On Deck">
        <Nav authed={true} displayName={displayName} />
        <main mix={css({ maxWidth: '640px', margin: '0 auto', padding: '32px 24px' })}>
          <h1>{displayName}</h1>
          <p mix={css({ margin: '-8px 0 16px', color: '#555' })}>
            <a href={routes.profile.following.href()}>{followingCount} following</a> ·{' '}
            <a href={routes.profile.followers.href()}>
              {followersCount} follower{followersCount === 1 ? '' : 's'}
            </a>
          </p>
          {saved && <p mix={css({ color: '#15803d' })}>Saved.</p>}

          <h2>Bio</h2>
          <div
            mix={css({
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: '16px',
              border: '1px solid #ddd',
              borderRadius: '8px',
              padding: '16px',
            })}
          >
            {bio ? (
              <p mix={css({ margin: 0, whiteSpace: 'pre-wrap' })}>{bio}</p>
            ) : (
              <p mix={css({ margin: 0, color: '#555' })}>
                Nothing yet — just for other people to read, it has no effect on your recommendations.
              </p>
            )}
            <Modal id="edit-bio" triggerLabel="Edit" title="Edit your bio">
              <form
                method="post"
                action={routes.profile.updateBio.href()}
                mix={css({ display: 'flex', flexDirection: 'column', gap: '8px' })}
              >
                <input type="hidden" name="_method" value="PUT" />
                <Field
                  label="Bio"
                  hint="Just for other people to read — it has no effect on your recommendations."
                >
                  <textarea name="bio" rows={4} defaultValue={bio} placeholder="Tell people a bit about yourself…" />
                </Field>
                <button type="submit">Save bio</button>
              </form>
            </Modal>
          </div>

          <MediaTabs
            idPrefix="profile"
            active={activeTab}
            panels={Object.fromEntries(
              ACTIVE_MEDIA_TYPES.map((type) => {
                const ui = MEDIA_TYPE_UI[type]
                const { summary, log, total } = media[type]
                const seeAllHref =
                  type === 'movie'
                    ? routes.profile.watched.href()
                    : `${routes.profile.watched.href()}?type=${type}`

                return [
                  type,
                  <>
                    <TasteProfileSummary label={`My ${ui.attributive} taste profile`} summary={summary} />
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
                      // Carries the tab, so "back to your profile" returns
                      // to the tab you left rather than the first one.
                      detailHref={(id) =>
                        `${ui.hrefs.show(id)}?from=${encodeURIComponent(`${profileHref}?tab=${type}`)}`
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
