import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { RegionWatchProviders, WatchProvider } from '../../data/catalog/tmdb.ts'
import {
  justWatchSearchUrl,
  watchRegionName,
  watchRegionOptions,
  type WatchRegion,
} from '../../data/watchRegion.ts'
import { routes } from '../../routes.ts'
import { FloatingDropdown } from './floating-dropdown.tsx'

export interface WhereToWatchProps {
  // What the JustWatch link searches for.
  title: string
  region: WatchRegion
  // This country's answer, or null when TMDB lists the title nowhere here.
  providers: RegionWatchProviders | null
  returnTo: string
}

const GROUPS: { key: 'stream' | 'free' | 'ads'; label: string }[] = [
  { key: 'stream', label: 'Stream' },
  { key: 'free', label: 'Free' },
  { key: 'ads', label: 'With ads' },
]

const logoStyle = css({ width: '36px', height: '36px', borderRadius: '8px', display: 'block' })

// The detail page's "where to watch" list. Only rendered for a title whose
// availability has been fetched — see loadWatchProviders.
export function WhereToWatch(handle: Handle<WhereToWatchProps>) {
  return () => {
    const { title, region, providers, returnTo } = handle.props
    const country = watchRegionName(region)
    const groups = GROUPS.map((group) => ({ ...group, entries: providers?.[group.key] ?? [] })).filter(
      (group) => group.entries.length > 0,
    )

    return (
      <section mix={css({ marginTop: '24px' })}>
        {/* The country sits with the heading it qualifies, and is changed
            from there — rather than as a line of its own between the logos
            and the link, where it read as a third thing to click. */}
        <div
          mix={css({
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '12px',
            margin: '0 0 8px',
          })}
        >
          <h2 mix={css({ fontSize: '16px', margin: 0 })}>Where to watch</h2>
          <div mix={css({ fontSize: '13px' })}>
            <FloatingDropdown triggerLabel={`${country} ▾`} align="right" compact>
              {/* One form, one submit button per country: a click is the
                  choice, with no Save step and no script. Scrolls inside the
                  panel, since there are ~140 of them. */}
              <form
                method="post"
                action={routes.profile.watchRegion.href()}
                mix={css({ display: 'flex', flexDirection: 'column', maxHeight: '300px', overflowY: 'auto' })}
              >
                <input type="hidden" name="return_to" value={returnTo} />
                {watchRegionOptions().map((option) => (
                  <button
                    type="submit"
                    name="region"
                    value={option.value}
                    aria-current={option.value === region ? 'true' : undefined}
                    // Inline, because `.doodle button` draws its sketched border
                    // and centers the text at a specificity a class can't beat.
                    style="border: none; border-image: none; text-align: left; padding: 4px 8px; font-size: 14px"
                    mix={css({
                      cursor: 'pointer',
                      borderRadius: '4px',
                      fontWeight: option.value === region ? 'bold' : 'normal',
                      '&:hover': { backgroundColor: '#efe6db' },
                    })}
                  >
                    {option.value === region ? `✓ ${option.label}` : option.label}
                  </button>
                ))}
              </form>
            </FloatingDropdown>
          </div>
        </div>
        {groups.length > 0 ? (
          groups.map((group) => (
            <div mix={css({ display: 'flex', alignItems: 'center', gap: '12px', margin: '0 0 8px' })}>
              <span mix={css({ width: '64px', flex: '0 0 auto', color: '#555', fontSize: '14px' })}>
                {group.label}
              </span>
              <div mix={css({ display: 'flex', flexWrap: 'wrap', gap: '8px' })}>
                {group.entries.map((provider) => (
                  <ProviderLogo provider={provider} />
                ))}
              </div>
            </div>
          ))
        ) : (
          <p mix={css({ margin: '0 0 8px', color: '#555' })}>Not streaming in {country} right now.</p>
        )}
        {/* Shown even when nothing above is: "not streaming" says nothing
            about renting or buying. It is also the credit TMDB's terms ask
            for wherever this data appears, so it names JustWatch outright. */}
        <p mix={css({ margin: '4px 0 0', fontSize: '14px' })}>
          <a href={justWatchSearchUrl(region, title)} target="_blank" rel="noopener noreferrer">
            See all options on JustWatch
          </a>
        </p>
      </section>
    )
  }
}

function ProviderLogo(handle: Handle<{ provider: WatchProvider }>) {
  return () => {
    const { provider } = handle.props
    return provider.logoUrl ? (
      <img src={provider.logoUrl} alt={provider.name} title={provider.name} mix={logoStyle} />
    ) : (
      <span mix={css({ fontSize: '14px' })}>{provider.name}</span>
    )
  }
}
