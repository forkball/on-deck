import { mediaTypeUiFor } from '../../mediaTypes.ts'
import { describeLength, getCatalogProvider, type LengthBucket } from '../catalog/provider.ts'
import type { MediaType } from '../mediaItems.ts'
import { requestStructured } from './claude.ts'

export interface Pick {
  title: string
  year: number
  reason: string
  // Only asked for when the series lever is set, and absent on picks carried in a
  // checkpoint written before it was — see matchesSeries, which reads nothing as
  // "no answer given" rather than as standalone.
  part_of_series?: boolean
  // The series this belongs to, empty for a standalone. Asked for on every run, to
  // keep one series from taking several of the eight slots — see seriesKey.
  series_name?: string
}

export interface TasteSummary {
  summary: string
  liked_tags: string[]
  disliked_tags: string[]
}

export interface MemberProfile extends TasteSummary {
  label: string
}

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

// A prompt hint only — generate.ts enforces both by id after the fact.
export interface ExcludedTitles {
  seen: string[]
  rejected: string[]
}

// Ignored unless `decade` is set too.
export type DecadeRelation = 'before' | 'within' | 'after'

// All hard-filter the final picks, not just hint the prompt.
export interface RecommendationFilters {
  genre?: string
  decade?: number
  // Defaults to 'within' when `decade` is set — see matchesDecade.
  decadeRelation?: DecadeRelation
  length?: LengthBucket
  // Games only — see GAME_PLAYER_TYPES / GAME_MULTIPLAYER_TYPES.
  playerType?: string
  multiplayerType?: string
  // Games only — a platform family, see GAME_PLATFORMS.
  platform?: string
  // Books only — see BOOK_SERIES_TYPES.
  series?: string
}

// Built per request rather than a constant: part_of_series is asked for only when
// the lever needs it, and structured output requires every property it declares, so
// a field that is sometimes wanted can't just be optional in one fixed schema.
function picksSchema(withSeries: boolean) {
  const properties = {
    title: { type: 'string' as const },
    year: { type: 'number' as const },
    reason: { type: 'string' as const },
    // A string rather than a nullable one: structured output takes a single type
    // per property, and "" is a clearer "no series" than a magic word would be.
    series_name: { type: 'string' as const },
    ...(withSeries ? { part_of_series: { type: 'boolean' as const } } : {}),
  }

  return {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      picks: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          additionalProperties: false,
          properties,
          required: Object.keys(properties),
        },
      },
    },
    required: ['picks'],
  }
}

// Enough over TARGET_COUNT to survive the gates dropping some, and no more: a
// longer list spends the run's thinking on a tail that is never shown.
const REQUESTED_COUNT = 12

// Safe to trim because this list enforces nothing — exclusion is applied by
// catalog id in generate.ts, which stays whole.
const SEEN_TITLES_IN_PROMPT = 200

// A backstop against an unbounded prompt rather than a limit anyone reaches.
const REJECTED_TITLES_IN_PROMPT = 100

// `subject` is the person's name for a solo run, or null for a group — where
// there's no single "they" to name, so the prompt stays pronoun-generic.
export function describeSeen(seen: string[], noun: string, subject: string | null): string {
  if (seen.length === 0) return ''

  const shown = seen.slice(0, SEEN_TITLES_IN_PROMPT)
  if (shown.length === seen.length) {
    return subject
      ? `\n\n${subject} has already seen (do not suggest any of these): ${JSON.stringify(seen)}`
      : `\n\nThey've already seen (do not suggest any of these): ${JSON.stringify(seen)}`
  }

  // The count matters: handed a bare 200 out of 900, the model reads that as the
  // whole of what they've watched and pitches at someone barely started.
  return subject
    ? `\n\n${subject} has logged ${seen.length} ${noun} as seen — here are the ${shown.length} most recent, none ` +
        `of which you should suggest: ${JSON.stringify(shown)}. Take it as read that there are many more you ` +
        `haven't been shown: ${subject} is well past the obvious picks, so favour things ${subject} is unlikely to ` +
        `have already worked through.`
    : `\n\nThey've logged ${seen.length} ${noun} as seen — here are the ${shown.length} most recent, none of ` +
        `which you should suggest: ${JSON.stringify(shown)}. Take it as read that there are many more you ` +
        `haven't been shown: this is someone well past the obvious picks, so favour things they're unlikely to ` +
        `have already worked through.`
}

function buildFilterInstructions(filters: RecommendationFilters, noun: string, mediaType: MediaType): string {
  const clauses: string[] = []
  if (filters.genre) {
    clauses.push(
      `Only suggest ${noun} in the "${filters.genre}" genre. This one is checked: each pick is looked up and ` +
        `discarded unless the catalog itself files it under "${filters.genre}", so a ${noun} from another genre ` +
        `that merely contains ${filters.genre} will not survive. Where this genre and the taste profile barely ` +
        `overlap, the genre wins — suggest the "${filters.genre}" ${noun} this reader is most likely to enjoy, ` +
        `rather than the ${noun} closest to their profile that gestures at "${filters.genre}".`,
    )
  }
  if (filters.decade != null) {
    if (filters.decadeRelation === 'before') {
      clauses.push(`Only suggest ${noun} originally released before ${filters.decade}.`)
    } else if (filters.decadeRelation === 'after') {
      clauses.push(`Only suggest ${noun} originally released after ${filters.decade + 9}.`)
    } else {
      clauses.push(`Only suggest ${noun} originally released in the ${filters.decade}s.`)
    }
  }
  // The medium's own bucket, never a runtime for everything — see lengthOptions.
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
  // A family, so the phrasing stays loose — the catalog check after this decides.
  if (filters.platform) clauses.push(`Only suggest ${noun} playable on ${filters.platform}.`)
  if (filters.series === 'series') clauses.push(`Only suggest ${noun} that are part of a series.`)
  if (filters.series === 'standalone') clauses.push(`Only suggest standalone ${noun}, not part of a series.`)
  // Nothing in any book catalog answers this, so the model is asked to label its own
  // picks and is held to the labels — see matchesSeries.
  if (filters.series != null) {
    clauses.push(
      `Set "part_of_series" on every pick: true if it belongs to a series, false if it stands alone. ` +
        `Answer for the work itself, not for whether the author wrote other books.`,
    )
  }
  return clauses.length > 0 ? ` ${clauses.join(' ')}` : ''
}

// The picks, plus what was said to get them. The caller keeps both — see
// transcripts.ts for why they aren't simply logged.
export interface PicksResult {
  picks: Pick[]
  prompt: string
  response: string
}

export async function requestPicks(
  profiles: MemberProfile[] | MultiSourceMemberProfile[],
  excluded: ExcludedTitles,
  filters: RecommendationFilters = {},
  mediaType: MediaType = 'movie',
  sourceTypes: MediaType[] = ['movie'],
): Promise<PicksResult> {
  const isGroup = profiles.length > 1
  const subject = isGroup ? null : profiles[0].label
  const noun = mediaTypeUiFor(mediaType).plural
  const sourceNouns = sourceTypes.map((type) => mediaTypeUiFor(type).plural)
  const crossesMedia = sourceTypes.some((type) => type !== mediaType)
  const sourceInstructions = crossesMedia
    ? ` Base these on their ${sourceNouns.join(' and ')} taste above — that's deliberate. Carry the same ` +
      `sensibility across: what they love about those should show up in the ${noun} you pick, even though ` +
      `you're recommending a different medium.`
    : sourceTypes.length > 1
      ? ` Each person has a separate profile per type above; weigh all of them.`
      : ''
  const hasFilters =
    filters.genre != null ||
    filters.decade != null ||
    filters.length != null ||
    filters.playerType != null ||
    filters.multiplayerType != null ||
    filters.platform != null ||
    filters.series != null
  const requestedCount = hasFilters ? REQUESTED_COUNT + 6 : REQUESTED_COUNT
  const { singular } = mediaTypeUiFor(mediaType)
  const seriesRule =
    ` Set "series_name" on each pick: the series it belongs to, or "" if it stands alone.` +
    (filters.series === 'standalone'
      ? ''
      : ` Suggest at most one ${singular} per series — the one someone new to that series should start with — ` +
        `so the list is that many different ${noun} rather than half of one shelf.`)

  const filterInstructions =
    buildFilterInstructions(filters, noun, mediaType) + sourceInstructions + seriesRule

  const prompt = isGroup
    ? `Group of ${profiles.length} people, each with their own ${noun} taste profile:\n${JSON.stringify(profiles, null, 2)}\n\n` +
      `Suggest ${requestedCount} real ${noun} (not from any fixed list — use your own knowledge) this group ` +
      `should watch together.${filterInstructions} Reason explicitly about tradeoffs: avoid picks only one ` +
      `person would like; prefer broad appeal; where genuinely interesting, surface a pick that bridges ` +
      `members' different tastes rather than only the bland common denominator. Do not just average genre ` +
      `tags — reason per-person about how each candidate would land for them specifically. For each pick, give ` +
      `your best-guess release year (used only to disambiguate remakes/same-titled entries) and a reason ` +
      `noting which member(s) it serves and why.`
    : `${subject}'s ${noun} taste profile:\n${JSON.stringify(profiles[0], null, 2)}\n\n` +
      `Suggest ${requestedCount} real ${noun} (not from any fixed list — use your own knowledge) that match ` +
      `this taste profile.${filterInstructions} For each, give your best-guess release year (used only to ` +
      `disambiguate remakes/same-titled entries) and a one-sentence reason tied to ${subject}'s profile.`

  // Scales per person because the reasoning does — a run that exhausts its budget
  // thinking comes back with no picks at all.
  //
  // Capped where a non-streaming request stops being comfortable: past this a
  // call wants .stream() and get_final_message(), not a bigger ceiling.
  const maxTokens = Math.min(6000 + 3000 * profiles.length + (hasFilters ? 4000 : 0), 32000)

  const content =
    prompt +
    describeSeen(excluded.seen, noun, subject) +
    (excluded.rejected.length > 0
      ? subject
        ? `\n\n${subject} has explicitly ruled these out as not interesting — never suggest them, and treat ` +
          `them as a signal about what to steer away from more broadly: ` +
          `${JSON.stringify(excluded.rejected.slice(0, REJECTED_TITLES_IN_PROMPT))}`
        : `\n\nThey've explicitly said they're not interested in these — never suggest them, and treat them ` +
          `as a signal about what to steer away from more broadly: ` +
          `${JSON.stringify(excluded.rejected.slice(0, REJECTED_TITLES_IN_PROMPT))}`
      : '')

  let response = ''

  const { picks } = await requestStructured<{ picks: Pick[] }>(
    'picks.model',
    {
      model: 'claude-sonnet-5',
      max_tokens: maxTokens,
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: picksSchema(filters.series != null) },
      },
      messages: [{ role: 'user', content }],
    },
    (raw) => {
      response = raw
    },
  )

  return { picks, prompt: content, response }
}
