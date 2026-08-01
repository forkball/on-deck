import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { GenerateRecommendationsForm } from '../../assets/generate-recommendations-form.tsx'
import { MediaTabLinks } from '../../ui/components/media-tab-links.tsx'
import { MAX_RUNS_PER_USER, type RecommendationRunSummary } from '../../data/recommendations.ts'
import type { User } from '../../data/schema.ts'
import { displayLabel } from '../../data/users.ts'
import { routes } from '../../routes.ts'
import { Document } from '../../ui/components/document.tsx'
import { Nav } from '../../ui/components/nav.tsx'
import { enabledMediaTypes, MEDIA_TYPE_UI, type ActiveMediaType } from '../../utils/mediaTypes.ts'

export interface RecommendationsPageProps {
  runs: RecommendationRunSummary[]
  runsFromOthers: RecommendationRunSummary[]
  friends: User[]
  mediaType: ActiveMediaType
  genres: string[]
  lengthOptions: { value: string; label: string }[]
  displayName: string
  error?: string
  // Set when the request matched an earlier run the user hasn't taken
  // anything from — see DuplicateNotice.
  duplicate?: {
    runId: number
    name: string | null
    createdAt: number
    // Name/value pairs that reproduce the blocked request verbatim.
    fields: [string, string][]
  }
}

// Shown instead of generating when the same levers already produced a run
// whose picks are all still unlogged. Not a hard block — the point is that
// you probably want the list you already have, but the button is right there
// if you don't.
function DuplicateNotice(handle: Handle<{ duplicate: NonNullable<RecommendationsPageProps['duplicate']> }>) {
  return () => {
    const { duplicate } = handle.props
    const href = routes.recommendations.show.href({ runId: String(duplicate.runId) })

    return (
      <div
        mix={css({
          border: '1px solid #ddd',
          borderRadius: '8px',
          padding: '16px',
          marginBottom: '24px',
        })}
      >
        <p mix={css({ margin: '0 0 8px' })}>
          <strong>You already have a recommendation like this.</strong>
        </p>
        <p mix={css({ margin: '0 0 12px', color: '#555' })}>
          Those exact settings produced{' '}
          <a href={href}>{duplicate.name || 'an earlier run'}</a> on{' '}
          {new Date(duplicate.createdAt).toLocaleDateString()}, and you haven't logged anything from it
          yet. Generating again will replace it with a different set of picks.
        </p>
        <div mix={css({ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' })}>
          <a href={href}>Show me that one →</a>
          <form method="post" action={routes.recommendations.generate.href()}>
            {duplicate.fields.map(([name, value], index) => (
              <input key={`${name}-${index}`} type="hidden" name={name} value={value} />
            ))}
            <input type="hidden" name="force" value="1" />
            <button type="submit">Generate a new one anyway</button>
          </form>
        </div>
      </div>
    )
  }
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
                {run.name ? (
                  <>
                    <strong>{run.name}</strong> — {date}
                  </>
                ) : (
                  <>
                    <strong>{date}</strong> — {run.groupLabel}
                  </>
                )}
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
    const { runs, runsFromOthers, friends, mediaType, genres, lengthOptions, displayName, error, duplicate } =
      handle.props
    const recsHref = routes.recommendations.index.href()
    const ui = MEDIA_TYPE_UI[mediaType]

    return (
      <Document title="Recommendations | On Deck">
        <Nav authed={true} displayName={displayName} />
        <main mix={css({ maxWidth: '720px', margin: '0 auto', padding: '32px 24px' })}>
          <MediaTabLinks
            current={mediaType}
            hrefFor={(type) => `${recsHref}?mediaType=${type}`}
          />
          <h1>Recommendations</h1>
          <p mix={css({ color: '#555' })}>
            Rewrites your {ui.attributive} taste profile from what you've logged, then finds
            picks to try next.
          </p>

          {duplicate && <DuplicateNotice duplicate={duplicate} />}

          {error && (
            <p
              mix={css({
                margin: '0 0 16px',
                padding: '12px 16px',
                border: '1px solid #b91c1c',
                borderRadius: '8px',
                color: '#b91c1c',
              })}
            >
              {error}
            </p>
          )}

          <GenerateRecommendationsForm
            friends={friends.map((friend) => ({ id: friend.id, label: displayLabel(friend) }))}
            mediaType={mediaType}
            mediaTypeLabel={ui.attributive}
            sources={enabledMediaTypes().map((type) => ({
              value: type,
              label: `${MEDIA_TYPE_UI[type].attributive} taste`,
            }))}
            genres={genres}
            lengthOptions={lengthOptions}
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
                Only your {MAX_RUNS_PER_USER} most recent {ui.attributive} runs are kept —
                generating a new one removes the oldest.
              </p>
            )}
            {runs.length === 0 ? (
              <p>
                Nothing yet — log a few {ui.plural} on your{' '}
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
