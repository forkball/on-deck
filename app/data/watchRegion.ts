// Which country's streaming services to show someone. Database-free, so the
// guess can be tested directly.

// The countries TMDB's watch-provider data covers. A code outside it would only
// ever show "nothing here", so the guess never lands on one and the picker
// never offers one.
export const WATCH_REGIONS = [
  'AD',
  'AE',
  'AG',
  'AL',
  'AO',
  'AR',
  'AT',
  'AU',
  'AZ',
  'BA',
  'BB',
  'BE',
  'BF',
  'BG',
  'BH',
  'BM',
  'BO',
  'BR',
  'BS',
  'BY',
  'BZ',
  'CA',
  'CD',
  'CH',
  'CI',
  'CL',
  'CM',
  'CO',
  'CR',
  'CU',
  'CV',
  'CY',
  'CZ',
  'DE',
  'DK',
  'DO',
  'DZ',
  'EC',
  'EE',
  'EG',
  'ES',
  'FI',
  'FJ',
  'FR',
  'GB',
  'GF',
  'GG',
  'GH',
  'GI',
  'GQ',
  'GR',
  'GT',
  'GY',
  'HK',
  'HN',
  'HR',
  'HU',
  'ID',
  'IE',
  'IL',
  'IN',
  'IQ',
  'IS',
  'IT',
  'JM',
  'JO',
  'JP',
  'KE',
  'KR',
  'KW',
  'LB',
  'LC',
  'LI',
  'LT',
  'LU',
  'LV',
  'LY',
  'MA',
  'MC',
  'MD',
  'ME',
  'MG',
  'MK',
  'ML',
  'MT',
  'MU',
  'MW',
  'MX',
  'MY',
  'MZ',
  'NE',
  'NG',
  'NI',
  'NL',
  'NO',
  'NZ',
  'OM',
  'PA',
  'PE',
  'PF',
  'PG',
  'PH',
  'PK',
  'PL',
  'PS',
  'PT',
  'PY',
  'QA',
  'RO',
  'RS',
  'RU',
  'SA',
  'SC',
  'SE',
  'SG',
  'SI',
  'SK',
  'SM',
  'SN',
  'SV',
  'TC',
  'TD',
  'TH',
  'TN',
  'TR',
  'TT',
  'TW',
  'TZ',
  'UA',
  'UG',
  'US',
  'UY',
  'VA',
  'VE',
  'XK',
  'YE',
  'ZA',
  'ZM',
  'ZW',
] as const

export type WatchRegion = (typeof WATCH_REGIONS)[number]

// Where someone lands when their browser says nothing usable. Not a claim about
// who uses the app — just the one country every catalog covers most fully.
export const DEFAULT_WATCH_REGION: WatchRegion = 'US'

export function parseWatchRegion(value: unknown): WatchRegion | null {
  if (typeof value !== 'string') return null
  const upper = value.trim().toUpperCase()
  return WATCH_REGIONS.includes(upper as WatchRegion) ? (upper as WatchRegion) : null
}

// The country out of an Accept-Language header: "en-CA,en;q=0.9" is Canada.
//
// Language, not location — which is the point: it needs no permission prompt,
// no lookup service, and it is on the very first request. It is also only a
// guess (someone in Toronto on a stock en-US machine reads as American), which
// is why the page says which country it used and offers to change it.
//
// Tags are tried in the order the browser prefers them. A tag with no region
// ("en"), or one that isn't a country ("es-419" is Latin America), is skipped
// rather than mapped: a language alone doesn't say where someone lives.
export function guessWatchRegion(acceptLanguage: string | null | undefined): WatchRegion {
  const tags = (acceptLanguage ?? '')
    .split(',')
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(';')
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='))
      const weight = q ? Number(q.slice(2)) : 1
      return { tag: tag!.trim(), weight: Number.isFinite(weight) ? weight : 0, index }
    })
    .filter((entry) => entry.tag && entry.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index)

  for (const { tag } of tags) {
    // Past the language, and past a script subtag if there is one (zh-Hant-TW).
    const region = tag
      .split('-')
      .slice(1)
      .find((subtag) => /^[a-z]{2}$/i.test(subtag))
    const parsed = parseWatchRegion(region)
    if (parsed) return parsed
  }
  return DEFAULT_WATCH_REGION
}

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' })

// "Canada" for CA. From the runtime rather than a table of our own, so the
// picker needs no second list to keep in step with the first.
export function watchRegionName(region: WatchRegion): string {
  return regionNames.of(region) ?? region
}

// For the picker: every country, alphabetical by the name shown.
export function watchRegionOptions(): { value: WatchRegion; label: string }[] {
  return WATCH_REGIONS.map((value) => ({ value, label: watchRegionName(value) })).sort((a, b) =>
    a.label.localeCompare(b.label),
  )
}

// JustWatch's path segments are ISO codes lowercased, except the one country
// whose site predates the ISO spelling.
const JUSTWATCH_PATHS: Partial<Record<WatchRegion, string>> = { GB: 'uk' }

// Every option for a title, rent and buy included, on JustWatch — as a search,
// because the page for the title itself is addressed by a slug that a TMDB id
// can't be turned into, and a guessed slug 404s whenever JustWatch
// disambiguates. One more click, but it always lands. Doubles as the credit
// TMDB's terms ask for wherever this data is shown.
export function justWatchSearchUrl(region: WatchRegion, title: string): string {
  const path = JUSTWATCH_PATHS[region] ?? region.toLowerCase()
  return `https://www.justwatch.com/${path}/search?q=${encodeURIComponent(title)}`
}
