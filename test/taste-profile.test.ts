import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { buildProfilePrompt, logSignature, profilePromptRows } from '../app/data/recommendations/tasteProfile.ts'

type Entry = Parameters<typeof logSignature>[0][number]

const entry = (over: {
  id?: number
  title?: string
  status?: string
  rating?: number | null
  disliked?: boolean | null
  notes?: string | null
} = {}): Entry =>
  ({
    interaction: {
      status: over.status ?? 'consumed',
      rating: over.rating ?? null,
      disliked: over.disliked ?? null,
      notes: over.notes ?? null,
    },
    item: { id: over.id ?? 1, title: over.title ?? 'Dune' },
  }) as unknown as Entry

const ALL = { logLimit: null, useNotes: true }

// The signature is the cache key for a paid model call: too loose and someone
// reads a stale profile, too tight and every run re-buys one.
describe('logSignature', () => {
  it('is stable for an unchanged log', () => {
    assert.equal(logSignature([entry()], ALL), logSignature([entry()], ALL))
  })

  it('ignores row order, which carries no meaning to the prompt', () => {
    const a = [entry({ id: 1, title: 'Dune' }), entry({ id: 2, title: 'Solaris' })]
    const b = [entry({ id: 2, title: 'Solaris' }), entry({ id: 1, title: 'Dune' })]
    assert.equal(logSignature(a, ALL), logSignature(b, ALL))
  })

  it('changes when a title is rematched, though no interaction row moved', () => {
    assert.notEqual(
      logSignature([entry({ title: 'Dune' })], ALL),
      logSignature([entry({ title: 'Dune: Part Two' })], ALL),
    )
  })

  it('changes on rating, verdict and status', () => {
    const base = logSignature([entry()], ALL)
    assert.notEqual(base, logSignature([entry({ rating: 4 })], ALL))
    assert.notEqual(base, logSignature([entry({ disliked: true })], ALL))
    assert.notEqual(base, logSignature([entry({ status: 'want_to_consume' })], ALL))
  })

  it('changes when the settings change, since they decide what the prompt holds', () => {
    const log = [entry(), entry({ id: 2 })]
    assert.notEqual(logSignature(log, ALL), logSignature(log, { logLimit: 1, useNotes: true }))
    assert.notEqual(logSignature(log, ALL), logSignature(log, { logLimit: null, useNotes: false }))
  })

  it('ignores an edited note when notes are not sent', () => {
    const off = { logLimit: null, useNotes: false }
    assert.equal(logSignature([entry({ notes: 'a' })], off), logSignature([entry({ notes: 'b' })], off))
  })

  it('ignores an entry beyond the limit, which never reaches the prompt', () => {
    const settings = { logLimit: 1, useNotes: true }
    const a = [entry({ id: 1 }), entry({ id: 2, title: 'Solaris' })]
    const b = [entry({ id: 1 }), entry({ id: 3, title: 'Stalker' })]
    assert.equal(logSignature(a, settings), logSignature(b, settings))
  })
})

// The settings are applied in code, never described to the model: what someone
// withheld must be absent from the request, not something it is asked to ignore.
describe('buildProfilePrompt', () => {
  const log = [
    entry({ id: 1, title: 'Dune', notes: 'KEPT-NOTE' }),
    entry({ id: 2, title: 'WITHHELD-TITLE', notes: 'WITHHELD-NOTE' }),
  ]

  it('omits notes entirely when they are turned off', () => {
    const settings = { logLimit: null, useNotes: false }
    const prompt = buildProfilePrompt(profilePromptRows(log, settings), 'movie', settings)
    assert.ok(!prompt.includes('KEPT-NOTE'))
    assert.ok(!prompt.includes('WITHHELD-NOTE'))
    assert.ok(!prompt.includes('notes'), 'the field list must not promise notes that were not sent')
  })

  it('omits entries beyond the limit', () => {
    const settings = { logLimit: 1, useNotes: true }
    const prompt = buildProfilePrompt(profilePromptRows(log, settings), 'movie', settings)
    assert.ok(prompt.includes('Dune'))
    assert.ok(!prompt.includes('WITHHELD-TITLE'))
    assert.ok(!prompt.includes('WITHHELD-NOTE'))
  })

  it('says more exists further back, without sending it', () => {
    const settings = { logLimit: 1, useNotes: true }
    const prompt = buildProfilePrompt(profilePromptRows(log, settings), 'movie', settings)
    assert.ok(prompt.includes('further back'))
  })
})
