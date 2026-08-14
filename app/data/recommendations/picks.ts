import { mediaTypeUiFor } from '../../mediaTypes.ts'
import { describeLength, getCatalogProvider, type LengthBucket } from '../catalog/provider.ts'
import type { MediaType } from '../mediaItems.ts'
import { requestStructured } from './claude.ts'

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

// Titles the model is told to stay off, split by why. Both are enforced by id
// after the fact (see generate.ts); this split exists because rejection is a
// taste signal and having seen something isn't, so they can't be phrased the
// same way in the prompt.
export interface ExcludedTitles {
  // Already consumed.
  seen: string[]
  // Logged as "not interested".
  rejected: string[]
}

// How a release year relates to `decade` — ignored unless `decade` is set too.
export type DecadeRelation = 'before' | 'within' | 'after'

// All hard-filter the final picks, not just hint the prompt. Genre and decade
// come free off the search results already fetched; length needs an extra
// per-candidate lookup, so it only happens when that lever is set.
export interface RecommendationFilters {
  genre?: string
  // Decade start year, e.g. 1990 for "the 1990s".
  decade?: number
  // Defaults to 'within' when `decade` is set — see matchesDecade.
  decadeRelation?: DecadeRelation
  length?: LengthBucket
  // Games only — see GAME_PLAYER_TYPES / GAME_MULTIPLAYER_TYPES.
  playerType?: string
  multiplayerType?: string
  // Books only — see BOOK_SERIES_TYPES.
  series?: string
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

// How much of the log the prompt is willing to carry. Someone a few years into
// logging has thousands of titles, and every run was pasting all of them in
// front of the question it actually wanted answered.
//
// Safe to cut because this list isn't what enforces anything: exclusion is
// applied to the results by catalog id (excludedExternalIds in generate.ts),
// which stays whole. The worst a trimmed list can do is let the model spend a
// suggestion on something that then gets dropped — and the run already
// over-requests to absorb exactly that.
//
// Most recent first, which is the order the log arrives in (updated_at desc,
// see loadUserLogEntries). Recent viewing is what the taste profile is built
// from, so it's what a taste-matched pick is likeliest to echo back — the
// titles where the reminder actually earns its space.
const SEEN_TITLES_IN_PROMPT = 200

// Rejections are steering, not just suppression — the prompt below asks the
// model to generalise from them — so they're worth more room per entry. This
// is a backstop against an unbounded prompt rather than a limit anyone is
// expected to reach: turning something down is far rarer than finishing it.
const REJECTED_TITLES_IN_PROMPT = 100

export function describeSeen(seen: string[], noun: string): string {
  if (seen.length === 0) return ''

  const shown = seen.slice(0, SEEN_TITLES_IN_PROMPT)
  if (shown.length === seen.length) {
    return `\n\nThey've already seen (do not suggest any of these): ${JSON.stringify(seen)}`
  }

  // Saying so matters: handed a bare 200 out of 900, the model would read that
  // as the whole of what they've watched and pitch at someone barely started.
  // The count is the part that says "go further afield".
  return (
    `\n\nThey've logged ${seen.length} ${noun} as seen — here are the ${shown.length} most recent, none of ` +
    `which you should suggest: ${JSON.stringify(shown)}. Take it as read that there are many more you ` +
    `haven't been shown: this is someone well past the obvious picks, so favour things they're unlikely to ` +
    `have already worked through.`
  )
}

function buildFilterInstructions(filters: RecommendationFilters, noun: string, mediaType: MediaType): string {
  const clauses: string[] = []
  if (filters.genre) clauses.push(`Only suggest ${noun} in the "${filters.genre}" genre.`)
  if (filters.decade != null) {
    if (filters.decadeRelation === 'before') {
      clauses.push(`Only suggest ${noun} originally released before ${filters.decade}.`)
    } else if (filters.decadeRelation === 'after') {
      clauses.push(`Only suggest ${noun} originally released after ${filters.decade + 9}.`)
    } else {
      clauses.push(`Only suggest ${noun} originally released in the ${filters.decade}s.`)
    }
  }
  // Described by the medium's own bucket, not a runtime for everything: asking
  // for long books used to request a runtime under 150 minutes, so the model
  // returned short books and the hard filter then dropped nearly all of them.
  if (filters.length) {
    const phrase = describeLength(getCatalogProvider(mediaType), filters.length)
    if (phrase) clauses.push(`Only suggest ${noun} with ${phrase}.`)
  }
  if (filters.playerType === 'singleplayer') clauses.push(`Only suggest ${noun} playable single-player.`)
  if (filters.playerType === 'multiplayer') clauses.push(`Only suggest ${noun} playable multiplayer.`)
  if (filters.multiplayerType === 'coop') clauses.push(`Only suggest ${noun} with a co-op multiplayer mode.`)
  if (filters.multiplayerType === 'versus') {
    clauses.push(`Only suggest ${noun} with a competitive (versus) multiplayer mode.`)
  }
  if (filters.series === 'series') clauses.push(`Only suggest ${noun} that are part of a series.`)
  if (filters.series === 'standalone') clauses.push(`Only suggest standalone ${noun}, not part of a series.`)
  return clauses.length > 0 ? ` ${clauses.join(' ')}` : ''
}

export async function requestPicks(
  profiles: MemberProfile[] | MultiSourceMemberProfile[],
  excluded: ExcludedTitles,
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
  const hasFilters =
    filters.genre != null ||
    filters.decade != null ||
    filters.length != null ||
    filters.playerType != null ||
    filters.multiplayerType != null ||
    filters.series != null
  const requestedCount = hasFilters ? REQUESTED_COUNT + 10 : REQUESTED_COUNT
  const filterInstructions = buildFilterInstructions(filters, noun, mediaType) + sourceInstructions

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

  const { picks } = await requestStructured<{ picks: Pick[] }>('picks.model', {
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
          prompt +
          describeSeen(excluded.seen, noun) +
          // Worth its own paragraph rather than being folded into the list
          // above: a rejection is the one negative signal that came from the
          // person rather than being inferred, so it should shape the
          // neighbouring picks too, not just remove these titles.
          (excluded.rejected.length > 0
            ? `\n\nThey've explicitly said they're not interested in these — never suggest them, and treat them ` +
              `as a signal about what to steer away from more broadly: ` +
              `${JSON.stringify(excluded.rejected.slice(0, REJECTED_TITLES_IN_PROMPT))}`
            : ''),
      },
    ],
  })

  return picks
}
