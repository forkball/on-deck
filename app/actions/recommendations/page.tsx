import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { RecommendationResult } from '../../data/recommendations.ts'
import type { User } from '../../data/schema.ts'
import { displayLabel } from '../../data/users.ts'
import { routes } from '../../routes.ts'
import { Document } from '../../ui/components/document.tsx'
import { Nav } from '../../ui/components/nav.tsx'
import { parseMovieMetadata } from '../../utils/mediaMetadata.ts'

export interface RecommendationsPageProps {
  recommendations: RecommendationResult[]
  groupLabel: string | null
  friends: User[]
  generated?: boolean
  displayName: string
}

export function RecommendationsPage(handle: Handle<RecommendationsPageProps>) {
  return () => {
    const { recommendations, groupLabel, friends, generated, displayName } = handle.props

    return (
      <Document title="Recommendations | On Deck">
        <Nav authed={true} displayName={displayName} />
        <main mix={css({ maxWidth: '720px', margin: '0 auto', padding: '32px 24px' })}>
          <h1>Recommendations</h1>
          <p mix={css({ color: '#555' })}>
            Rewrites your taste profile from what you've logged, then asks Claude for movies to try next.
          </p>
          {generated && <p mix={css({ color: '#15803d' })}>Updated.</p>}

          <form
            method="post"
            action={routes.recommendations.generate.href()}
            mix={css({ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '360px' })}
          >
            <label>
              <input type="radio" name="mode" value="self" defaultChecked /> Just me
            </label>
            <label>
              <input type="radio" name="mode" value="group" disabled={friends.length === 0} /> With friends
            </label>

            {friends.length > 0 ? (
              <div mix={css({ display: 'flex', flexDirection: 'column', gap: '4px', paddingLeft: '24px' })}>
                {friends.map((friend) => (
                  <label key={friend.id}>
                    <input type="checkbox" name="friend_ids" value={String(friend.id)} />{' '}
                    {displayLabel(friend)}
                  </label>
                ))}
              </div>
            ) : (
              <p mix={css({ margin: 0, paddingLeft: '24px', fontSize: '13px', color: '#888' })}>
                <a href={routes.users.search.href()}>Find and follow people</a> to build a group.
              </p>
            )}

            <button type="submit">
              {recommendations.length > 0 ? 'Refresh recommendations' : 'Get recommendations'}
            </button>
          </form>

          {groupLabel && (
            <p mix={css({ marginTop: '16px', fontStyle: 'italic', color: '#555' })}>Recommended for {groupLabel}</p>
          )}

          {recommendations.length === 0 ? (
            <p mix={css({ marginTop: '24px' })}>
              Nothing yet — log a few movies on your{' '}
              <a href={routes.profile.index.href()}>profile page</a> first, then come back here.
            </p>
          ) : (
            <ul
              mix={css({
                listStyle: 'none',
                margin: '24px 0 0',
                padding: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
              })}
            >
              {recommendations.map(({ item, tags, reason }) => {
                const { releaseYear, posterUrl } = parseMovieMetadata(item.metadata)
                const detailHref = `${routes.movies.show.href({ mediaItemId: String(item.id) })}?from=${encodeURIComponent(routes.recommendations.index.href())}`

                return (
                  <li
                    key={item.id}
                    mix={css({
                      display: 'flex',
                      gap: '12px',
                      border: '1px solid #ddd',
                      borderRadius: '8px',
                      padding: '16px',
                    })}
                  >
                    {posterUrl ? (
                      <a href={detailHref} mix={css({ flex: '0 0 auto' })}>
                        <img
                          src={posterUrl}
                          alt={`${item.title} poster`}
                          mix={css({ width: '60px', borderRadius: '4px', display: 'block' })}
                        />
                      </a>
                    ) : (
                      <div
                        mix={css({
                          width: '60px',
                          height: '90px',
                          flex: '0 0 auto',
                          border: '1px solid #ddd',
                          borderRadius: '4px',
                        })}
                      />
                    )}
                    <div mix={css({ flex: '1 1 auto' })}>
                      <a href={detailHref} mix={css({ fontWeight: 700 })}>
                        {item.title}
                      </a>
                      {releaseYear ? ` (${releaseYear})` : ''}
                      {tags.length > 0 && (
                        <div mix={css({ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' })}>
                          {tags.map((tag) => (
                            <span
                              key={tag}
                              mix={css({
                                fontSize: '11px',
                                padding: '2px 8px',
                                borderRadius: '999px',
                                border: '1px solid #ccc',
                                color: '#555',
                              })}
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                      <p mix={css({ margin: '8px 0 0', fontStyle: 'italic', color: '#555' })}>{reason}</p>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </main>
      </Document>
    )
  }
}
