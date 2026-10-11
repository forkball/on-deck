import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { Db } from '../../data/db.ts'
import { activeBatches } from '../../data/imports/batches.ts'
import { mediaTypeUiFor } from '../../mediaTypes.ts'
import { routes } from '../../routes.ts'
import { Link } from '../../ui/shared/form-controls.tsx'

export interface WaitingImport {
  href: string
  noun: string
  matching: boolean
}

// Unfinished imports, so there's a way back to one. Linked straight to the
// review page: client navigation follows the show route's redirect but leaves
// its URL in the address bar.
export async function loadWaitingImports(db: Db, userId: number): Promise<WaitingImport[]> {
  const batches = await activeBatches(db, userId)
  return batches.map((batch) => ({
    href:
      batch.status === 'review'
        ? routes.profile.imports.review.href({ batchId: batch.id })
        : routes.profile.imports.show.href({ batchId: batch.id }),
    noun: mediaTypeUiFor(batch.media_type).attributive,
    matching: batch.status === 'matching',
  }))
}

// Shown on the profile and on the import page alike: the profile is where
// someone lands, and the import page is where they'd go looking for it.
export function WaitingImports(handle: Handle<{ imports: WaitingImport[] }>) {
  return () => (
    <>
      {handle.props.imports.map((waiting) => (
        <p
          key={waiting.href}
          mix={css({
            border: '1px solid var(--rule)',
            borderLeft: '4px solid var(--accent)',
            borderRadius: '8px',
            background: 'var(--paper-tint)',
            padding: '10px 14px',
            margin: '0 0 16px',
            fontSize: '14px',
          })}
        >
          {waiting.matching ? (
            <>
              Your {waiting.noun} import is still matching. <Link href={waiting.href}>See progress</Link>
            </>
          ) : (
            <>
              Your {waiting.noun} import is waiting for review. <Link href={waiting.href}>Continue it</Link>
            </>
          )}
        </p>
      ))}
    </>
  )
}
