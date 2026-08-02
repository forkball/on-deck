import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

// Which platforms a game runs on.
//
// Grouped into families rather than listed raw. Hades alone returns eight
// entries — PC, PS4, PS5, XONE, Series X|S, Switch, iOS, Mac — which buries
// the answer to the only question a card is being asked: can I play this on
// the thing I own. Four families read at a glance; eight generations don't.
//
// Deliberately lossy at render only. The full list stays in metadata, so a
// page that wants "PS4 and PS5, not PS3" can still say so.
const FAMILIES: { label: string; match: RegExp }[] = [
  { label: 'PC', match: /^(PC|Win|DOS)/i },
  { label: 'PlayStation', match: /^(PS|PlayStation|PSVR|Vita)/i },
  { label: 'Xbox', match: /^(XBOX|X360|XONE|Series X)/i },
  { label: 'Nintendo', match: /^(Switch|Wii|NES|SNES|N64|GB|GBA|NDS|3DS|GameCube|NGC)/i },
  { label: 'Mobile', match: /^(iOS|Android|iPad|iPhone)/i },
  { label: 'Mac', match: /^Mac/i },
  { label: 'Linux', match: /^Linux/i },
]

// Returns family labels in the order above, so two games never list the same
// platforms in a different order.
export function platformFamilies(platforms: string[]): string[] {
  const found = new Set<string>()
  const unmatched: string[] = []

  for (const platform of platforms) {
    const family = FAMILIES.find((candidate) => candidate.match.test(platform))
    if (family) found.add(family.label)
    // Anything unrecognised keeps its own name rather than being dropped —
    // better an unfamiliar label than silently claiming a game runs nowhere.
    else if (!unmatched.includes(platform)) unmatched.push(platform)
  }

  return [...FAMILIES.filter((family) => found.has(family.label)).map((family) => family.label), ...unmatched]
}

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
