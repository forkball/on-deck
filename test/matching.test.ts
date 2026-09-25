import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  applyVerdicts,
  chooseMatch,
  seriesKey,
  decadeYear,
  matchesSeries,
  filterByGenre,
  filterByLength,
  matchesDecade,
  searchForPicks,
  titlesLikelyMatch,
  withOverviews,
  type Candidate,
  type CatalogLookup,
  type CatalogSearch,
} from '../app/data/recommendations/matching.ts'
import type { Pick } from '../app/data/recommendations/picks.ts'

describe('titlesLikelyMatch', () => {
  it('accepts the same title', () => {
    assert.ok(titlesLikelyMatch('Dune', 'Dune'))
  })

  it('ignores punctuation, case and spacing', () => {
    assert.ok(titlesLikelyMatch('WALL-E', 'Wall E'))
    assert.ok(titlesLikelyMatch('the thing', 'The Thing'))
  })

  it('accepts a catalog subtitle the pick did not ask for', () => {
    assert.ok(titlesLikelyMatch('The Dispossessed', 'The Dispossessed: An Ambiguous Utopia'))
  })

  it('rejects a prefix that is a different work', () => {
    assert.ok(!titlesLikelyMatch('Foundation', 'Foundation and Empire'))
  })

  it('rejects an unrelated title', () => {
    assert.ok(!titlesLikelyMatch('Dune', 'The Godfather'))
  })

  it('rejects empty input rather than matching everything', () => {
    assert.ok(!titlesLikelyMatch('', 'Dune'))
    assert.ok(!titlesLikelyMatch('Dune', ''))
  })
})

describe('matchesDecade', () => {
  it('defaults to within the decade', () => {
    assert.ok(matchesDecade(1995, 1990))
    assert.ok(!matchesDecade(2001, 1990))
    assert.ok(!matchesDecade(1989, 1990))
  })

  it('reads before and after as exclusive of the decade itself', () => {
    assert.ok(matchesDecade(1989, 1990, 'before'))
    assert.ok(!matchesDecade(1995, 1990, 'before'))
    assert.ok(matchesDecade(2000, 1990, 'after'))
    assert.ok(!matchesDecade(1999, 1990, 'after'))
  })

  it('never matches an unknown year', () => {
    for (const relation of ['before', 'within', 'after'] as const) {
      assert.ok(!matchesDecade(null, 1990, relation))
    }
  })
})

describe('seriesKey', () => {
  const pick = (series_name?: string) => ({ title: 'x', year: 2023, reason: '', series_name })

  it('matches the same series written two ways', () => {
    assert.equal(seriesKey(pick('The Empyrean')), seriesKey(pick('Empyrean')))
    assert.equal(seriesKey(pick('A Court of Thorns and Roses')), seriesKey(pick('a court of thorns & roses')))
  })

  it('keeps different series apart', () => {
    assert.notEqual(seriesKey(pick('The Empyrean')), seriesKey(pick('Throne of Glass')))
  })

  // Standalones must not collapse into one another: every one of them answers null,
  // and null is never looked up in the set of series already taken.
  it('ignores the words a model adds around a series name', () => {
    const empyrean = seriesKey(pick('The Empyrean'))
    assert.equal(seriesKey(pick('Empyrean series')), empyrean)
    assert.equal(seriesKey(pick('The Empyrean Trilogy')), empyrean)
    assert.equal(seriesKey(pick('Empyrean Book 2')), empyrean)
  })

  it('answers null for a standalone, however it says so', () => {
    assert.equal(seriesKey(pick('')), null)
    assert.equal(seriesKey(pick('   ')), null)
    assert.equal(seriesKey(pick(undefined)), null)
  })
})

describe('chooseMatch', () => {
  const hit = (title: string, releaseYear: number | null, popularity = 0) =>
    ({ title, releaseYear, externalId: title, tags: [], popularity }) as unknown as Parameters<
      typeof chooseMatch
    >[1][number]

  const pick = (title: string, year: number) => ({ title, year, reason: '' })

  // The real one: searching "Bitten" returns "No Biting: Policy and Practice for
  // Toddlers" near the pick's year, and the book itself further down. Choosing by
  // year first picked the toddlers book and then dropped the pick for not being it.
  it('picks the right book before the right year', () => {
    const chosen = chooseMatch(pick('Bitten', 2001), [
      hit('No Biting: Policy and Practice', 2001),
      hit('Bitten', 2010),
    ])

    assert.equal(chosen?.title, 'Bitten')
  })

  it('picks the edition matching the year, among hits that are the book', () => {
    const chosen = chooseMatch(pick('Outlander', 1991), [hit('Outlander', 2004), hit('Outlander', 1991)])

    assert.equal(chosen?.releaseYear, 1991)
  })

  it('falls to the nearest year when no edition matches exactly', () => {
    const chosen = chooseMatch(pick('Outlander', 1991), [hit('Outlander', 2015), hit('Outlander', 1994)])

    assert.equal(chosen?.releaseYear, 1994)
  })

  // A collector's printing whose title is spelled with a colon reads as the book
  // plus a subtitle, so it clears every title check there is. The year is what
  // separates them, and the year of a book is the year of its pressing, so this is
  // as good as this rule gets: it is the sibling case below that the named tier is
  // actually for.
  it('cannot tell a collectors pressing from the book on title alone', () => {
    const chosen = chooseMatch(pick('Iron Flame', 2023), [
      hit('Iron Flame: Limited Special Edition - Sprayed Edges', 2023),
      hit('Iron Flame', 2024),
    ])

    assert.equal(chosen?.title, 'Iron Flame: Limited Special Edition - Sprayed Edges')
  })

  // Searching "A Court of Thorns and Roses" returns "A Court of Mist and Fury",
  // 0.69 similar — past the 0.5 the fuzzy check asks for, and a different book. It
  // stops being eligible while the book itself is on the list.
  it('prefers the book over a sibling that only passes the fuzzy check', () => {
    const chosen = chooseMatch(pick('A Court of Thorns and Roses', 2015), [
      hit('A Court of Mist and Fury', 2016),
      hit('A Court of Thorns and Roses', 2019),
    ])

    assert.equal(chosen?.title, 'A Court of Thorns and Roses')
  })

  // Unchanged behaviour, kept because it is the property the named tier rests on:
  // a subtitle is not a different book.
  it('takes a subtitle as the same book, since publishers add them freely', () => {
    const chosen = chooseMatch(pick('The Night Circus', 2011), [
      hit('The Night Circus: A Novel', 2011),
      hit('The Night Circus Companion', 2013),
    ])

    assert.equal(chosen?.title, 'The Night Circus: A Novel')
  })

  it('breaks a year tie on the edition people actually have', () => {
    const chosen = chooseMatch(pick('Graceling', 2008), [hit('Graceling', 2008), hit('Graceling', 2008, 48)])

    assert.equal(chosen?.popularity, 48)
  })

  it('counts a pick that carries the subtitle as named, not merely fuzzy', () => {
    const chosen = chooseMatch(pick('Iron Flame: Empyrean Book 2', 2023), [
      hit('Iron Flame. Limited Special Edition - Sprayed Edges', 2023),
      hit('Iron Flame', 2024),
    ])

    assert.equal(chosen?.title, 'Iron Flame')
  })

  it('still falls back to a fuzzy match when nothing carries the plain title', () => {
    const chosen = chooseMatch(pick('WALL-E', 2008), [hit('Wall E', 2008)])

    assert.equal(chosen?.title, 'Wall E')
  })

  it('answers null when no hit is the book at all', () => {
    assert.equal(chooseMatch(pick('Written in Red', 2013), [hit('Writing Red: An Anthology', 2013)]), null)
  })

  it('answers null for no hits', () => {
    assert.equal(chooseMatch(pick('Bitten', 2001), []), null)
  })
})

describe('matchesSeries', () => {
  const pick = (part_of_series?: boolean) => ({
    title: 'Lords and Ladies',
    year: 1992,
    reason: '',
    part_of_series,
  })

  it('holds the model to the label it gave', () => {
    assert.ok(matchesSeries(pick(true), 'series'))
    assert.ok(!matchesSeries(pick(false), 'series'))
    assert.ok(matchesSeries(pick(false), 'standalone'))
    assert.ok(!matchesSeries(pick(true), 'standalone'))
  })

  // A checkpoint written before the field was asked for. Dropping these would empty
  // a resumed run for a reason that has nothing to do with the books.
  it('reads an unlabelled pick as no answer rather than as standalone', () => {
    assert.ok(matchesSeries(pick(undefined), 'series'))
    assert.ok(matchesSeries(pick(undefined), 'standalone'))
  })
})

describe('decadeYear', () => {
  const pick = { title: 'Dune', year: 1965, reason: '' }
  // What Google Books answers for Dune: a 2005 reprint.
  const edition = { releaseYear: 2005 } as unknown as Parameters<typeof decadeYear>[2]

  it('reads a book from the pick, since the catalog only holds an edition', () => {
    assert.equal(decadeYear('book', pick, edition), 1965)
    assert.ok(matchesDecade(decadeYear('book', pick, edition), 1960))
  })

  it('reads every other medium from the catalog, which releases once', () => {
    assert.equal(decadeYear('movie', pick, edition), 2005)
    assert.ok(!matchesDecade(decadeYear('movie', pick, edition), 1960))
  })

  it('passes an unknown catalog year through rather than substituting the pick', () => {
    const undated = { releaseYear: null } as unknown as Parameters<typeof decadeYear>[2]
    assert.equal(decadeYear('movie', pick, undated), null)
  })
})

// Verdicts pair with candidates by index, not by position. This is the step
// whose job is telling near-identical entries apart, so a set it cannot read
// unambiguously has to be refused rather than filtered on a best guess.
const pickOf = (title: string): Pick => ({ title, year: 2000, reason: '' })

const hit = (title: string) =>
  ({ title, externalId: title }) as unknown as Awaited<ReturnType<CatalogSearch>>[number]

const candidate = (title: string): Candidate =>
  ({ pick: pickOf(title), match: { title } }) as unknown as Candidate

describe('applyVerdicts', () => {
  const three = [candidate('a'), candidate('b'), candidate('c')]

  it('keeps only the entries the model approved', () => {
    const kept = applyVerdicts(three, [
      { index: 0, matches: true },
      { index: 1, matches: false },
      { index: 2, matches: true },
    ])
    assert.deepEqual(
      kept.map((c) => c.pick.title),
      ['a', 'c'],
    )
  })

  it('pairs by index, not by arrival order', () => {
    const kept = applyVerdicts(three, [
      { index: 2, matches: false },
      { index: 0, matches: true },
      { index: 1, matches: true },
    ])
    assert.deepEqual(
      kept.map((c) => c.pick.title),
      ['a', 'b'],
    )
  })

  it('refuses a short verdict list rather than sliding answers onto the wrong entry', () => {
    assert.throws(() =>
      applyVerdicts(three, [
        { index: 0, matches: true },
        { index: 1, matches: true },
      ]),
    )
  })

  it('refuses an out-of-range index', () => {
    assert.throws(() =>
      applyVerdicts(three, [
        { index: 0, matches: true },
        { index: 1, matches: true },
        { index: 9, matches: true },
      ]),
    )
  })

  it('refuses a duplicate verdict', () => {
    assert.throws(() =>
      applyVerdicts(three, [
        { index: 0, matches: true },
        { index: 0, matches: false },
        { index: 1, matches: true },
      ]),
    )
  })

  it('refuses a non-array', () => {
    assert.throws(() => applyVerdicts(three, null as never))
  })

  it('returns nothing for no candidates', () => {
    assert.deepEqual(applyVerdicts([], []), [])
  })
})

// A book candidate as the pipeline holds one: a search hit that may or may not have
// carried its page count or its genres, plus the id a by-id lookup would be asked
// about.
const book = (title: string, externalId: string, pageCount: number | null, tags: string[] = []): Candidate =>
  ({ pick: pickOf(title), match: { title, externalId, pageCount, tags } }) as unknown as Candidate

const detail = (externalId: string, pageCount: number | null, tags: string[] = []) =>
  ({ title: externalId, externalId, pageCount, tags }) as unknown as Awaited<ReturnType<CatalogLookup>>

describe('filterByLength', () => {
  it('reads the dimension off the search hit without paying for a lookup', async () => {
    const asked: string[] = []
    const kept = await filterByLength(
      [book('short one', 'A', 100), book('long one', 'B', 900)],
      'book',
      'short',
      async (_type, externalId) => {
        asked.push(externalId)
        return null
      },
    )

    assert.deepEqual(
      kept.map((c) => c.pick.title),
      ['short one'],
    )
    assert.deepEqual(asked, [])
  })

  it('looks up only the candidates whose hit lacked the dimension', async () => {
    const asked: string[] = []
    const kept = await filterByLength(
      [book('known', 'A', 100), book('unknown', 'B', null)],
      'book',
      'short',
      async (_type, externalId) => {
        asked.push(externalId)
        return detail(externalId, 120)
      },
    )

    assert.deepEqual(asked, ['B'])
    assert.deepEqual(
      kept.map((c) => c.pick.title),
      ['known', 'unknown'],
    )
  })

  // The bug this exists for: Google Books answers 429 once the day's quota is
  // gone, and a book row imported through the Open Library fallback carries an
  // id it will never resolve. Either threw straight out of the run. Every
  // lookup failing is only the catalog's fault when nothing else survived it.
  it('drops a candidate the provider throws on instead of failing the run', async () => {
    const kept = await filterByLength(
      [book('known', 'A', 100), book('unlookupable', 'B', null)],
      'book',
      'short',
      async (_type, externalId) => {
        if (externalId === 'B') throw new Error('Google Books lookup failed: 429')
        return null
      },
    )

    assert.deepEqual(
      kept.map((c) => c.pick.title),
      ['known'],
    )
  })

  it('says the catalog is down rather than saving an empty run', async () => {
    await assert.rejects(
      filterByLength([book('unlookupable', 'B', null)], 'book', 'short', async () => {
        throw new Error('Google Books lookup failed: 429')
      }),
      /catalog isn't answering/,
    )
  })

  it('keeps a candidate whose lookup answered, even when a sibling lookup threw', async () => {
    const kept = await filterByLength(
      [book('answered', 'A', null), book('threw', 'B', null)],
      'book',
      'short',
      async (_type, externalId) => {
        if (externalId === 'B') throw new Error('Google Books lookup failed: 429')
        return detail(externalId, 100)
      },
    )

    assert.deepEqual(
      kept.map((c) => c.pick.title),
      ['answered'],
    )
  })
})

describe('filterByGenre', () => {
  it('trusts a tag the search hit carries without paying for a lookup', async () => {
    const asked: string[] = []
    const kept = await filterByGenre(
      [book('tagged', 'A', null, ['science fiction']), book('other genre', 'B', null, ['romance'])],
      'book',
      'science fiction',
      async (_type, externalId) => {
        asked.push(externalId)
        return null
      },
    )

    assert.deepEqual(
      kept.map((c) => c.pick.title),
      ['tagged'],
    )
    assert.deepEqual(asked, ['B'])
  })

  // The bug this exists for: Google Books' search payload carries "Fiction" and
  // nothing under it, so every fiction genre was dropping the whole shortlist.
  it('keeps a book whose by-id record carries the genre its hit did not', async () => {
    const kept = await filterByGenre(
      [book('untagged', 'A', null, [])],
      'book',
      'science fiction',
      async (_type, externalId) => detail(externalId, null, ['science fiction', 'classics']),
    )

    assert.deepEqual(
      kept.map((c) => c.pick.title),
      ['untagged'],
    )
  })

  it('carries the detail record forward, so the length check reuses the lookup', async () => {
    const kept = await filterByGenre(
      [book('untagged', 'A', null, [])],
      'book',
      'romance',
      async (_type, externalId) => detail(externalId, 320, ['romance']),
    )

    assert.equal(kept[0].match.pageCount, 320)
  })

  it('drops a book the by-id record says is a different genre', async () => {
    const kept = await filterByGenre(
      [book('untagged', 'A', null, [])],
      'book',
      'horror',
      async (_type, externalId) => detail(externalId, null, ['romance']),
    )

    assert.deepEqual(kept, [])
  })

  // Run 125 in production: 13 lookups, 0 kept, an empty romance run. Google Books
  // has no categories at all for a great many older works, and requiring a positive
  // tag read every one of them as "some other genre".
  it('keeps a book whose record carries no categories at all', async () => {
    const kept = await filterByGenre(
      [book('uncatalogued', 'A', null, [])],
      'book',
      'romance',
      async (_type, id) => detail(id, null, []),
    )

    assert.deepEqual(
      kept.map((c) => c.pick.title),
      ['uncatalogued'],
    )
  })

  it('still drops a book whose record names a different genre', async () => {
    const kept = await filterByGenre(
      [book('horror novel', 'A', null, [])],
      'book',
      'romance',
      async (_type, id) => detail(id, null, ['horror']),
    )

    assert.deepEqual(kept, [])
  })

  // The same emptiness on a provider that answers genres on search is a sparse or
  // placeholder entry, not an uncatalogued work — TMDB omits genre_ids on those —
  // and keeping them would put junk in front of someone.
  it('does not extend the benefit of the doubt to a medium whose search answers', async () => {
    const kept = await filterByGenre(
      [book('sparse entry', 'A', null, [])],
      'movie',
      'romance',
      async () => null,
    )

    assert.deepEqual(kept, [])
  })

  it('reads a miss on a hit that does answer genres as the answer', async () => {
    const asked: string[] = []
    const kept = await filterByGenre(
      [book('sci-fi film', 'A', null, ['science fiction']), book('romance film', 'B', null, ['romance'])],
      'movie',
      'science fiction',
      async (_type, externalId) => {
        asked.push(externalId)
        return detail(externalId, null, ['science fiction'])
      },
    )

    assert.deepEqual(
      kept.map((c) => c.pick.title),
      ['sci-fi film'],
    )
    assert.deepEqual(asked, [])
  })

  // The lookup is the only thing that can answer a book's genre, so when it doesn't
  // answer, the hit it was asked about is what's left — and an empty tag list is
  // the catalog never having said, not a verdict. This is the case that emptied a
  // real run: Open Library ids asked of Google Books, during a Google outage.
  it('keeps a candidate the provider threw on, having nothing against it', async () => {
    const kept = await filterByGenre(
      [book('tagged', 'A', null, ['horror']), book('unlookupable', 'B', null, [])],
      'book',
      'horror',
      async (_type, externalId) => {
        if (externalId === 'B') throw new Error('Google Books lookup failed: 503')
        return null
      },
    )

    assert.deepEqual(
      kept.map((c) => c.pick.title),
      ['tagged', 'unlookupable'],
    )
  })

  // The hit is still evidence when it carried any: a book the search says is a
  // biography is not the romance that was asked for, whether or not the lookup
  // that would have confirmed it landed.
  it('drops a candidate whose own hit names another genre, lookup or no lookup', async () => {
    const kept = await filterByGenre(
      [book('a biography', 'A', null, ['biography']), book('unsaid', 'B', null, [])],
      'book',
      'romance',
      async () => {
        throw new Error('Google Books lookup failed: 503')
      },
    )

    // A survivor alongside it, so this asserts the drop rather than the
    // catalog-down guard the next test covers.
    assert.deepEqual(
      kept.map((c) => c.pick.title),
      ['unsaid'],
    )
  })

  it('says the catalog is down rather than saving an empty run', async () => {
    await assert.rejects(
      filterByGenre([book('a biography', 'A', null, ['biography'])], 'book', 'romance', async () => {
        throw new Error('Google Books lookup failed: 503')
      }),
      /catalog isn't answering/,
    )
  })

  it('keeps an answered candidate alongside one whose lookup threw', async () => {
    const kept = await filterByGenre(
      [book('answered', 'A', null, []), book('threw', 'B', null, [])],
      'book',
      'horror',
      async (_type, externalId) => {
        if (externalId === 'B') throw new Error('Google Books lookup failed: 503')
        return detail(externalId, null, ['horror'])
      },
    )

    assert.deepEqual(
      kept.map((c) => c.pick.title),
      ['answered', 'threw'],
    )
  })
})

describe('filterByGenre title handling', () => {
  it('keeps the checked title when the by-id record answers with another one', async () => {
    const candidates = [book('Iron Flame', 'dIIO0AEACAAJ', null, [])]
    const kept = await filterByGenre(candidates, 'book', 'romance', async (_type, externalId) =>
      detail(externalId, 640, ['romance']),
    )

    // Google answers "Iron Flame. Limited Special Edition - Sprayed Edges" for this
    // volume by id, having answered a subtitled form of the real title in search.
    // `detail` here stands in for that: its title is the external id, which is not
    // the book, so the search title survives while the tags and pages come across.
    assert.equal(kept[0].match.title, 'Iron Flame')
    assert.equal(kept[0].match.pageCount, 640)
    assert.deepEqual(kept[0].match.tags, ['romance'])
  })

  it('takes the by-id title when it is still the book', async () => {
    const kept = await filterByGenre([book('The Night Circus', 'A', null, [])], 'book', 'romance', async () =>
      detail('The Night Circus: A Novel', null, ['romance']),
    )

    assert.equal(kept[0].match.title, 'The Night Circus: A Novel')
  })
})

describe('withOverviews', () => {
  it('leaves a candidate as it found it when the lookup throws', async () => {
    const candidates = [book('no overview', 'A', 100)]
    const returned = await withOverviews(candidates, 'book', async () => {
      throw new Error('Google Books lookup failed: 429')
    })

    assert.equal(returned.length, 1)
    assert.equal(returned[0].match.overview, undefined)
  })

  it('fills in the overview the lookup did return', async () => {
    const candidates = [book('no overview', 'A', 100)]
    const returned = await withOverviews(
      candidates,
      'book',
      async () => ({ overview: 'a plot' }) as unknown as Awaited<ReturnType<CatalogLookup>>,
    )

    assert.equal(returned[0].match.overview, 'a plot')
  })
})

describe('searchForPicks', () => {
  const three = [pickOf('a'), pickOf('b'), pickOf('c')]

  it('searches only the picks the local catalog did not answer for', async () => {
    const asked: string[] = []
    const local = new Map([[1, hit('b from catalog')]])

    const matches = await searchForPicks('book', three, local as never, async (_type, query) => {
      asked.push(query)
      return [hit(query)]
    })

    assert.deepEqual(asked, ['a', 'c'])
    assert.deepEqual(
      matches.map((m) => m.map((r) => r.title)),
      [['a'], ['b from catalog'], ['c']],
    )
  })

  it('leaves a pick unfound when its search throws, rather than failing the run', async () => {
    const matches = await searchForPicks('book', three, new Map(), async (_type, query) => {
      if (query === 'b')
        throw Object.assign(new TypeError('fetch failed'), { cause: new Error('read ECONNRESET') })
      return [hit(query)]
    })

    assert.deepEqual(
      matches.map((m) => m.length),
      [1, 0, 1],
    )
  })

  it('says the catalog is unreachable when every search failed', async () => {
    await assert.rejects(
      searchForPicks('book', three, new Map(), async () => {
        throw new TypeError('fetch failed')
      }),
      /catalog isn't answering/,
    )
  })

  // Not "the catalog is down" when the local rows already carry a run's worth.
  it('still returns what the local catalog answered when every search failed', async () => {
    const local = new Map([[0, hit('a from catalog')]])

    const matches = await searchForPicks('book', three, local as never, async () => {
      throw new TypeError('fetch failed')
    })

    assert.deepEqual(
      matches.map((m) => m.length),
      [1, 0, 0],
    )
  })

  it('holds the fan-out to the pool rather than putting every pick on the wire', async () => {
    const picks = Array.from({ length: 18 }, (_, i) => pickOf(`t${i}`))
    let inFlight = 0
    let peak = 0

    await searchForPicks('book', picks, new Map(), async (_type, query) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 1))
      inFlight--
      return [hit(query)]
    })

    assert.equal(peak, 8, 'the search fan-out should hold to SEARCH_CONCURRENCY')
  })
})
