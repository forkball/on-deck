import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { GenerateRecommendationsForm } from '../../assets/generate-recommendations-form.tsx'
import { MediaTypeFab } from '../../assets/media-type-fab.tsx'
import { MAX_RUNS_PER_USER, type RecommendationRunSummary } from '../../data/recommendations.ts'
import type { User } from '../../data/schema.ts'
import { displayLabel } from '../../data/users.ts'
import { routes } from '../../routes.ts'
import { Document } from '../../ui/components/document.tsx'
import { Nav } from '../../ui/components/nav.tsx'

export interface RecommendationsPageProps {
  runs: RecommendationRunSummary[]
  runsFromOthers: RecommendationRunSummary[]
  friends: User[]
  movieGenres: string[]
  tvGenres: string[]
  displayName: string
}

function RunList(handle: Handle<{ runs: RecommendationRunSummary[] }>) {
  return () => {
    const { runs } = handle.props

    return (
      <ul mix={css({ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '12px' })}>
        {runs.map((run) => {
          const date = new Date(run.createdAt).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })
          return (
            <li
              key={run.id}
              mix={css({
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '12px',
                border: '1px solid #ddd',
                borderRadius: '8px',
                padding: '12px 16px',
              })}
            >
              <a href={routes.recommendations.show.href({ runId: String(run.id) })}>
                <strong>{date}</strong> — {run.groupLabel}{' '}
                <span mix={css({ fontSize: '12px', color: '#888' })}>({run.mediaType === 'tv' ? 'TV' : 'Movies'})</span>
              </a>
            </li>
          )
        })}
      </ul>
    )
  }
}

export function RecommendationsPage(handle: Handle<RecommendationsPageProps>) {
  return () => {
    const { runs, runsFromOthers, friends, movieGenres, tvGenres, displayName } = handle.props

    return (
      <Document title="Recommendations | On Deck">
        <Nav authed={true} displayName={displayName} />
        <main mix={css({ maxWidth: '720px', margin: '0 auto', padding: '32px 24px' })}>
          <MediaTypeFab />
          <h1>Recommendations</h1>
          <p mix={css({ color: '#555' })}>
            Rewrites your taste profile from what you've logged, then asks Claude for picks to try next.
          </p>

          <GenerateRecommendationsForm
            friends={friends.map((friend) => ({ id: friend.id, label: displayLabel(friend) }))}
            movieGenres={movieGenres}
            tvGenres={tvGenres}
            generateHref={routes.recommendations.generate.href()}
            findPeopleHref={routes.users.search.href()}
          />

          {runsFromOthers.length > 0 && (
            <section mix={css({ marginTop: '40px' })}>
              <h2>Recommendations from others</h2>
              <p mix={css({ margin: '0 0 16px', fontSize: '13px', color: '#888' })}>
                Group runs friends generated that included you — only shown here once you both follow each other.
              </p>
              <RunList runs={runsFromOthers} />
            </section>
          )}

          <section mix={css({ marginTop: '40px' })}>
            <h2>Past recommendations</h2>
            {runs.length > 0 && (
              <p mix={css({ margin: '0 0 16px', fontSize: '13px', color: '#888' })}>
                Only your {MAX_RUNS_PER_USER} most recent runs are kept per media type — generating a new movie run
                only removes the oldest movie run, and likewise for TV.
              </p>
            )}
            {runs.length === 0 ? (
              <p>
                Nothing yet — log a few movies on your{' '}
                <a href={routes.profile.index.href()}>profile page</a>, then get recommendations above.
              </p>
            ) : (
              <RunList runs={runs} />
            )}
          </section>
        </main>
      </Document>
    )
  }
}
