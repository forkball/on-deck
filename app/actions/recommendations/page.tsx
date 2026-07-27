import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { GenerateRecommendationsForm } from '../../assets/generate-recommendations-form.tsx'
import type { RecommendationRunSummary } from '../../data/recommendations.ts'
import type { User } from '../../data/schema.ts'
import { displayLabel } from '../../data/users.ts'
import { routes } from '../../routes.ts'
import { Document } from '../../ui/components/document.tsx'
import { Nav } from '../../ui/components/nav.tsx'

export interface RecommendationsPageProps {
  runs: RecommendationRunSummary[]
  friends: User[]
  displayName: string
}

export function RecommendationsPage(handle: Handle<RecommendationsPageProps>) {
  return () => {
    const { runs, friends, displayName } = handle.props

    return (
      <Document title="Recommendations | On Deck">
        <Nav authed={true} displayName={displayName} />
        <main mix={css({ maxWidth: '720px', margin: '0 auto', padding: '32px 24px' })}>
          <h1>Recommendations</h1>
          <p mix={css({ color: '#555' })}>
            Rewrites your taste profile from what you've logged, then asks Claude for movies to try next.
          </p>

          <GenerateRecommendationsForm
            friends={friends.map((friend) => ({ id: friend.id, label: displayLabel(friend) }))}
            generateHref={routes.recommendations.generate.href()}
            findPeopleHref={routes.users.search.href()}
          />

          <section mix={css({ marginTop: '40px' })}>
            <h2>Past recommendations</h2>
            {runs.length === 0 ? (
              <p>
                Nothing yet — log a few movies on your{' '}
                <a href={routes.profile.index.href()}>profile page</a>, then get recommendations above.
              </p>
            ) : (
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
                        <strong>#{run.id}</strong> — {date} — {run.groupLabel}
                      </a>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </main>
      </Document>
    )
  }
}
