import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { platformFamilies } from '../../data/catalog/igdb.ts'

const listStyle = css({
  display: 'flex',
  flexWrap: 'wrap',
  gap: '4px',
  marginTop: '4px',
})

const chipStyle = css({
  fontSize: '11px',
  padding: '2px 8px',
  borderRadius: '999px',
  border: '1px solid #bbb',
  color: '#666',
})

// Grouped into families rather than listed raw — see platformFamilies, which
// the recommendation platform filter reads too, so a chip and a filter can't
// disagree about which family a platform belongs to.
export function PlatformList(handle: Handle<{ platforms: string[] }>) {
  return () => {
    const families = platformFamilies(handle.props.platforms)
    if (families.length === 0) return <></>

    return (
      <div mix={listStyle}>
        {families.map((family) => (
          <span key={family} mix={chipStyle}>
            {family}
          </span>
        ))}
      </div>
    )
  }
}
