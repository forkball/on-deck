import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { looksLikeZip, openZip } from '../app/data/imports/zip.ts'
import { buildZip } from './support/build-zip.ts'

describe('looksLikeZip', () => {
  it('recognises an archive', () => {
    assert.equal(looksLikeZip(buildZip([{ name: 'ratings.csv', body: 'Name\nHeat\n' }])), true)
  })

  it('rejects a bare CSV, which is what gets posted by mistake', () => {
    assert.equal(looksLikeZip(new Uint8Array(Buffer.from('Date,Name,Year,Rating\n', 'utf8'))), false)
  })
})

describe('openZip', () => {
  it('reads a deflated entry back', () => {
    const zip = openZip(buildZip([{ name: 'ratings.csv', body: 'Date,Name\n2024-01-01,Heat\n' }]))
    assert.equal(zip.readText('ratings.csv'), 'Date,Name\n2024-01-01,Heat\n')
  })

  it('reads a stored entry back', () => {
    const zip = openZip(buildZip([{ name: 'reviews.csv', body: 'Review\nliked it\n', store: true }]))
    assert.equal(zip.readText('reviews.csv'), 'Review\nliked it\n')
  })

  it('finds a file inside the dated folder an export wraps it in', () => {
    const zip = openZip(buildZip([{ name: 'letterboxd-erik-2026-08-19/ratings.csv', body: 'Name\nHeat\n' }]))
    assert.equal(zip.readText('ratings.csv'), 'Name\nHeat\n')
  })

  it('ignores the metadata macOS staples onto a re-zipped export', () => {
    const zip = openZip(
      buildZip([
        { name: '__MACOSX/._ratings.csv', body: 'junk' },
        { name: 'ratings.csv', body: 'Name\nHeat\n' },
      ]),
    )
    assert.equal(zip.readText('ratings.csv'), 'Name\nHeat\n')
    assert.deepEqual(zip.names(), ['ratings.csv'])
  })

  it('answers null for a file the export does not carry', () => {
    const zip = openZip(buildZip([{ name: 'ratings.csv', body: 'Name\nHeat\n' }]))
    assert.equal(zip.readText('reviews.csv'), null)
  })

  it('keeps a quoted comma intact through inflate', () => {
    const body = 'Date,Name\n2024-01-01,"Synecdoche, New York"\n'
    const zip = openZip(buildZip([{ name: 'ratings.csv', body }]))
    assert.equal(zip.readText('ratings.csv'), body)
  })

  it('strips a byte-order mark rather than gluing it to the first column', () => {
    const zip = openZip(buildZip([{ name: 'ratings.csv', body: '﻿Date,Name\n' }]))
    assert.equal(zip.readText('ratings.csv'), 'Date,Name\n')
  })

  it('refuses a file that is not an archive', () => {
    assert.throws(() => openZip(new Uint8Array(Buffer.from('Date,Name,Rating\n'))), /not a zip archive/)
  })
})
