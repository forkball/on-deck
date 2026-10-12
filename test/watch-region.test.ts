import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  guessWatchRegion,
  justWatchSearchUrl,
  parseWatchRegion,
  WATCH_REGION_OPTIONS,
} from '../app/data/watchRegion.ts'

describe('guessWatchRegion', () => {
  it('reads the country off the preferred language', () => {
    assert.equal(guessWatchRegion('en-CA,en;q=0.9'), 'CA')
    assert.equal(guessWatchRegion('fr-FR'), 'FR')
  })

  it("follows the browser's weights, not the order written", () => {
    assert.equal(guessWatchRegion('en-US;q=0.5, de-DE;q=0.9'), 'DE')
  })

  it('skips a tag with no country rather than guessing one from the language', () => {
    assert.equal(guessWatchRegion('fr, en-GB;q=0.8'), 'GB')
  })

  it('looks past a script subtag', () => {
    assert.equal(guessWatchRegion('zh-Hant-TW'), 'TW')
  })

  it('skips a region that is not a country, and one TMDB does not cover', () => {
    assert.equal(guessWatchRegion('es-419, es-MX;q=0.7'), 'MX')
    assert.equal(guessWatchRegion('en-AQ'), 'US')
  })

  it('ignores a language the browser has weighted to zero', () => {
    assert.equal(guessWatchRegion('en-GB;q=0, en-AU;q=0.5'), 'AU')
  })

  it('falls back to the default when there is nothing to go on', () => {
    assert.equal(guessWatchRegion(null), 'US')
    assert.equal(guessWatchRegion(''), 'US')
    assert.equal(guessWatchRegion('en'), 'US')
    assert.equal(guessWatchRegion('*'), 'US')
  })
})

describe('parseWatchRegion', () => {
  it('takes any casing of a covered country and nothing else', () => {
    assert.equal(parseWatchRegion('ca'), 'CA')
    assert.equal(parseWatchRegion('AQ'), null)
    assert.equal(parseWatchRegion(''), null)
    assert.equal(parseWatchRegion(null), null)
  })
})

describe('WATCH_REGION_OPTIONS', () => {
  it('names every country and sorts by the name shown', () => {
    const options = WATCH_REGION_OPTIONS
    assert.ok(options.some((option) => option.value === 'CA' && option.label === 'Canada'))
    const labels = options.map((option) => option.label)
    assert.deepEqual(
      labels,
      labels.toSorted((a, b) => a.localeCompare(b)),
    )
  })
})

describe('justWatchSearchUrl', () => {
  it("searches the country's own JustWatch site for the title", () => {
    assert.equal(
      justWatchSearchUrl('CA', 'Breaking Bad'),
      'https://www.justwatch.com/ca/search?q=Breaking%20Bad',
    )
  })

  it("uses JustWatch's spelling for the United Kingdom", () => {
    assert.equal(justWatchSearchUrl('GB', 'Severance'), 'https://www.justwatch.com/uk/search?q=Severance')
  })

  it('keeps a title with punctuation in one query parameter', () => {
    assert.equal(
      justWatchSearchUrl('US', 'Tom & Jerry: The Movie?'),
      'https://www.justwatch.com/us/search?q=Tom%20%26%20Jerry%3A%20The%20Movie%3F',
    )
  })
})
