import type { UserLogEntry } from '../mediaItems.ts'
import type { ExcludedTitles } from './picks.ts'

// Type-only imports, deliberately: this module holds the rule for what a run may
// not suggest, and nothing else. Keeping it free of the database and of the
// model client is what lets the rule be tested directly — the same reason
// imports/classify.ts and imports/review.ts are shaped this way.

export interface Exclusions {
  // A prompt hint the model is free to ignore.
  titles: ExcludedTitles
  // The hard filter. generate.ts drops any candidate whose catalog id is in here.
  externalIds: Set<string>
}

export interface ExclusionOptions {
  // An "I'm feeling lucky" run gets one pick and no filters, so the bar is
  // higher: anything anyone in the group has logged at all — meant to, part-way
  // through, finished, or turned down — is out. An ordinary run hands back eight
  // and only excludes what most of the group has actually finished, so one
  // person's want-to-watch showing up is a feature there and a bug here.
  lucky?: boolean
}

// One entry per member, each their whole log for the type being generated.
//
// Two rules, and only the id set enforces either: seen excludes once most of the
// group has (all of it, for a lucky run), and a rejection excludes on its own,
// from anyone.
export function buildExclusions(memberLogs: UserLogEntry[][], options: ExclusionOptions = {}): Exclusions {
  const lucky = options.lucky === true
  const memberCount = memberLogs.length
  const seenThreshold = lucky ? 1 : Math.floor(memberCount / 2) + 1

  const titles: ExcludedTitles = { seen: [], rejected: [] }
  const externalIds = new Set<string>()

  // Keyed by catalog id: two people's rows for the same film are different rows.
  // Title is the fallback, and the only key for anything unmatched.
  const seenBy = new Map<string, { count: number; title?: string; externalId?: string }>()

  // Same key as the tally, or a title several people turned down is named once
  // per person in the prompt.
  const rejectedKeys = new Set<string>()

  for (const log of memberLogs) {
    // Per member, so one person's duplicate rows can't cross the threshold alone.
    const countedThisMember = new Set<string>()

    for (const { interaction, item } of log) {
      const key = item?.external_id ?? item?.title
      if (!key) continue

      if (interaction.status === 'not_interested') {
        if (item?.external_id) externalIds.add(item.external_id)
        if (item?.title && !rejectedKeys.has(key)) {
          rejectedKeys.add(key)
          titles.rejected.push(item.title)
        }
        continue
      }
      // A lucky run counts every remaining status, so a title already sitting on
      // someone's want-to list isn't handed back to them as a discovery. The
      // prompt calls the whole list "seen", which is a shade off for those rows
      // — it is an exclusion list, not a claim about what they've watched.
      if (!lucky && interaction.status !== 'consumed') continue

      if (countedThisMember.has(key)) continue
      countedThisMember.add(key)

      const tally = seenBy.get(key) ?? { count: 0 }
      tally.count += 1
      tally.title ??= item?.title ?? undefined
      tally.externalId ??= item?.external_id ?? undefined
      seenBy.set(key, tally)
    }
  }

  for (const { count, title, externalId } of seenBy.values()) {
    if (count < seenThreshold) continue
    if (title) titles.seen.push(title)
    if (externalId) externalIds.add(externalId)
  }

  return { titles, externalIds }
}
