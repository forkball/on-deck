import { mediaTypeUiFor } from '../../mediaTypes.ts'
import type { LengthBucket } from '../catalog/provider.ts'
import type { MediaType } from '../mediaItems.ts'
import { claude, parseStructuredResponse } from './claude.ts'

// One recommendation as the model returns it, before catalog matching.
export interface Pick {
  title: string
  year: number
  reason: string
}

export interface TasteSummary {
  summary: string
  liked_tags: string[]
  disliked_tags: string[]
}

export interface MemberProfile extends TasteSummary {
  label: string
}

// Kept separate and labeled by type so Claude can reason about "their movie
// taste vs their TV taste" rather than one blurred-together profile.
export interface MultiSourceMemberProfile {
  label: string
  [sourceLabel: string]: TasteSummary | string
}

export function toTasteSummary(profile: {
  summary: string
  liked_tags: string[]
  disliked_tags: string[]
}): TasteSummary {
  return { summary: profile.summary, liked_tags: profile.liked_tags, disliked_tags: profile.disliked_tags }
}

// All hard-filter the final picks, not just hint the prompt. Genre and decade
// come free off the search results already fetched; length needs an extra
// per-candidate lookup, so it only happens when that lever is set.
export interface RecommendationFilters {
  genre?: string
  // Decade start year, e.g. 1990 for "the 1990s".
  decade?: number
  length?: LengthBucket
}

const PICKS_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    picks: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        additionalProperties: false,
        properties: {
          title: { type: 'string' as const },
          year: { type: 'number' as const },
          reason: { type: 'string' as const },
        },
        required: ['title', 'year', 'reason'],
      },
    },
  },
  required: ['picks'],
}

const REQUESTED_COUNT = 15

function buildFilterInstructions(filters: RecommendationFilters, noun: string): string {
  const clauses: string[] = []
  if (filters.genre) clauses.push(`Only suggest ${noun} in the "${filters.genre}" genre.`)
  if (filters.decade != null) clauses.push(`Only suggest ${noun} originally released in the ${filters.decade}s.`)
  if (filters.length === 'short') clauses.push(`Only suggest ${noun} with a runtime under 90 minutes.`)
  if (filters.length === 'medium') clauses.push(`Only suggest ${noun} with a runtime between 90 and 150 minutes.`)
  if (filters.length === 'long') clauses.push(`Only suggest ${noun} with a runtime over 150 minutes.`)
  return clauses.length > 0 ? ` ${clauses.join(' ')}` : ''
}

export async function requestPicks(
  profiles: MemberProfile[] | MultiSourceMemberProfile[],
  excludedTitles: string[],
  filters: RecommendationFilters = {},
  mediaType: MediaType = 'movie',
  sourceTypes: MediaType[] = ['movie'],
): Promise<Pick[]> {
  const isGroup = profiles.length > 1
  const noun = mediaTypeUiFor(mediaType).plural
  // Spelled out only when the source isn't simply the output type.
  const sourceNouns = sourceTypes.map((type) => mediaTypeUiFor(type).plural)
  const crossesMedia = sourceTypes.some((type) => type !== mediaType)
  const sourceInstructions = crossesMedia
    ? ` Base these on their ${sourceNouns.join(' and ')} taste above — that's deliberate. Carry the same ` +
      `sensibility across: what they love about those should show up in the ${noun} you pick, even though ` +
      `you're recommending a different medium.`
    : sourceTypes.length > 1
      ? ` Each person has a separate profile per type above; weigh all of them.`
      : ''
  // Hard filters drop some picks afterwards, so over-request to land near
  // TARGET_COUNT.
  const hasFilters = filters.genre != null || filters.decade != null || filters.length != null
  const requestedCount = hasFilters ? REQUESTED_COUNT + 10 : REQUESTED_COUNT
  const filterInstructions = buildFilterInstructions(filters, noun) + sourceInstructions

  const prompt = isGroup
    ? `Group of ${profiles.length} people, each with their own ${noun} taste profile:\n${JSON.stringify(profiles, null, 2)}\n\n` +
      `Suggest ${requestedCount} real ${noun} (not from any fixed list — use your own knowledge) this group ` +
      `should watch together.${filterInstructions} Reason explicitly about tradeoffs: avoid picks only one ` +
      `person would like; prefer broad appeal; where genuinely interesting, surface a pick that bridges ` +
      `members' different tastes rather than only the bland common denominator. Do not just average genre ` +
      `tags — reason per-person about how each candidate would land for them specifically. For each pick, give ` +
      `your best-guess release year (used only to disambiguate remakes/same-titled entries) and a reason ` +
      `noting which member(s) it serves and why.`
    : `A person's ${noun} taste profile:\n${JSON.stringify(profiles[0], null, 2)}\n\n` +
      `Suggest ${requestedCount} real ${noun} (not from any fixed list — use your own knowledge) that match ` +
      `this taste profile.${filterInstructions} For each, give your best-guess release year (used only to ` +
      `disambiguate remakes/same-titled entries) and a one-sentence reason tied to their profile.`

  const response = await claude.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: (isGroup ? 8000 : 4000) + (hasFilters ? 2000 : 0),
    output_config: {
      effort: isGroup ? 'high' : 'medium',
      format: { type: 'json_schema', schema: PICKS_SCHEMA },
    },
    messages: [
      {
        role: 'user',
        content:
          prompt + `\n\nThey've already seen (do not suggest any of these): ${JSON.stringify(excludedTitles)}`,
      },
    ],
  })

  return parseStructuredResponse<{ picks: Pick[] }>(response).picks
}
