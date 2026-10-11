import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { PART_NAMES, titlesOfPart, type TitlePart } from '../../data/profileTitles/catalog.ts'
import type { CreditTallies } from '../../data/profileTitles/unlocks.ts'
import { Page } from '../../ui/components/page.tsx'

export interface AdminCreditsPageProps {
  tallies: CreditTallies
  displayName: string
}

const tableStyle = css({
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '14px',
  '& th, & td': { padding: '8px 6px', borderBottom: '1px solid var(--rule)', textAlign: 'left' },
  '& th': { fontSize: '12px', fontWeight: 400, color: 'var(--muted)' },
  '& .count': { textAlign: 'right', whiteSpace: 'nowrap' },
})

const requirementStyle = css({ display: 'block', fontSize: '12px', color: 'var(--muted)' })

function percent(count: number, of: number): string {
  return of === 0 ? '0%' : `${Math.round((count / of) * 100)}%`
}

// One part's credits, in catalog order, each with how many members hold it and
// how many wear it.
function CreditTable(handle: Handle<{ part: TitlePart; tallies: CreditTallies }>) {
  return () => {
    const { part, tallies } = handle.props

    return (
      <>
        <h2>{PART_NAMES[part].many}</h2>
        <table mix={tableStyle}>
          <thead>
            <tr>
              <th>Credit</th>
              <th class="count">Members holding</th>
              <th class="count">Wearing</th>
            </tr>
          </thead>
          <tbody>
            {titlesOfPart(part).map((title) => {
              const held = tallies.held.get(title.key) ?? 0
              return (
                <tr key={title.key}>
                  <td>
                    <strong>{title.word}</strong>
                    <span mix={requirementStyle}>{title.requirement}</span>
                  </td>
                  <td class="count">
                    {held}{' '}
                    <span mix={css({ color: 'var(--muted)' })}>({percent(held, tallies.members)})</span>
                  </td>
                  <td class="count">{tallies.worn.get(title.key) ?? 0}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </>
    )
  }
}

// How the credits are spread across everyone, for admins. Counts only — no
// names — so nothing here gets round the privacy of a member's credits page.
export function AdminCreditsPage(handle: Handle<AdminCreditsPageProps>) {
  return () => {
    const { tallies, displayName } = handle.props

    return (
      <Page heading="Credits" displayName={displayName}>
        <p mix={css({ margin: '0 0 8px', color: 'var(--soft)' })}>
          Across all {tallies.members} members. Percentages are of every member, so they only mean much once
          the backfill has run.
        </p>
        <CreditTable part="adjective" tallies={tallies} />
        <CreditTable part="noun" tallies={tallies} />
      </Page>
    )
  }
}
