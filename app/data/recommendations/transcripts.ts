import { inList } from 'remix/data-table'

import type { Db } from '../db.ts'
import type { MediaType } from '../mediaItems.ts'
import { generationTranscripts } from '../schema.ts'
import type { RecommendationFilters } from './picks.ts'
import type { PickTally } from './tally.ts'

// Enough to compare a run that went wrong against the two before it, and few
// enough that a prompt carrying 200 logged titles doesn't accumulate.
export const MAX_TRANSCRIPTS_PER_USER = 5

export interface TranscriptInput {
  userId: number
  jobId?: string
  mediaType: MediaType
  filters: RecommendationFilters
  prompt: string
  response: string
}

// Written as soon as the model answers, before anything has been done with the
// answer — every interesting failure happens after this point, and a transcript
// saved at the end would be missing for exactly those runs.
export async function startTranscript(db: Db, input: TranscriptInput): Promise<number> {
  const row = await db.create(
    generationTranscripts,
    {
      user_id: input.userId,
      job_id: input.jobId,
      run_id: undefined,
      media_type: input.mediaType,
      params: JSON.stringify(input.filters),
      prompt: input.prompt,
      response: input.response,
      tally: undefined,
      created_at: Date.now(),
    },
    { returnRow: true },
  )

  await pruneOldTranscripts(db, input.userId)
  return row.id
}

// The other half: what became of the picks. Never throws — a run is not worth
// failing over its own diagnostics, which is also why every call site ignores the
// result.
export async function finishTranscript(
  db: Db,
  id: number,
  outcome: { runId?: number; tally: PickTally },
): Promise<void> {
  try {
    await db.update(generationTranscripts, id, {
      run_id: outcome.runId,
      tally: JSON.stringify(outcome.tally),
    })
  } catch (error) {
    console.warn(`[generation] transcript ${id} could not be finished:`, error)
  }
}

async function pruneOldTranscripts(db: Db, userId: number): Promise<void> {
  const rows = await db.findMany(generationTranscripts, {
    where: { user_id: userId },
    orderBy: ['created_at', 'desc'],
  })
  if (rows.length <= MAX_TRANSCRIPTS_PER_USER) return

  const excess = rows.slice(MAX_TRANSCRIPTS_PER_USER)
  await db.deleteMany(generationTranscripts, {
    where: inList(
      'id',
      excess.map((row) => row.id),
    ),
  })
}
