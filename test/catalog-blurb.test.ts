import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { stripPublisherPromo } from '../app/data/catalog/blurb.ts'

describe('stripPublisherPromo', () => {
  it('drops the banner and press quotes from a flattened jacket blurb', () => {
    const raw =
      '#1 NEW YORK TIMES BESTSELLER • Inspired by A Thousand and One Nights, this lush novel follows ' +
      'a fierce young woman. “Dreamily romantic, deliciously angst-y, addictively thrilling.”—Kirkus ' +
      'Reviews “An intoxicating gem of a story.”—Marie Lu, New York Times bestselling author of the ' +
      'Legend series One Life to One Dawn. In a land ruled by a murderous boy-king, each dawn brings ' +
      'heartache to a new family.'

    assert.equal(
      stripPublisherPromo(raw),
      'Inspired by A Thousand and One Nights, this lush novel follows a fierce young woman.\n\n' +
        'In a land ruled by a murderous boy-king, each dawn brings heartache to a new family.',
    )
  })

  it('drops stacked banners and a praise section laid out on their own lines', () => {
    const raw =
      'NOW A MAJOR MOTION PICTURE\nWINNER OF THE PULITZER PRIZE\n\n' +
      'A girl grows up alone in the marshes of North Carolina.\n\n' +
      'Praise for Where the Crawdads Sing\n' +
      '"Painfully beautiful." - The New York Times Book Review'

    assert.equal(stripPublisherPromo(raw), 'A girl grows up alone in the marshes of North Carolina.')
  })

  it('keeps an attribution with initials together', () => {
    const raw = '“A marvel.”—J. K. Rowling\nA wizard goes to school.'
    assert.equal(stripPublisherPromo(raw), 'A wizard goes to school.')
  })

  it('leaves a synopsis that only mentions a prize alone', () => {
    const raw = 'She wins the prize at the county fair.\nThen everything goes wrong.'
    assert.equal(stripPublisherPromo(raw), raw)
  })

  it('leaves quoted dialogue that is not followed by an attribution alone', () => {
    const raw = '“Run,” she says — and the chase begins across the city.'
    assert.equal(stripPublisherPromo(raw), raw)
  })

  it('hands back the original when stripping would leave nothing', () => {
    const raw = '“Unputdownable.”—Stephen King'
    assert.equal(stripPublisherPromo(raw), raw)
  })

  it('is idempotent', () => {
    const raw = 'BESTSELLER • A story.\n\n“Great.”—Someone Famous\n\nMore story.'
    const once = stripPublisherPromo(raw)
    assert.equal(stripPublisherPromo(once), once)
  })
})
