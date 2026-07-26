// Mirrors the SQL candidate-generation step from the plan (section 3, step 1) —
// here as in-memory filtering over the mock catalog, since there's no Postgres
// yet. Same logic shape: tag-overlap scoring + popularity fallback, minus
// anything any subject member has already interacted with, capped to a pool.

import { catalog, interactions, type MediaItem } from "./data.ts";

interface Profile {
  liked_tags: string[];
  disliked_tags: string[];
  summary: string;
}

const POOL_SIZE = 8; // small for a demo; the real system targets ~30-60 per type

export function generateCandidates(subjectUserIds: string[], profilesById: Record<string, Profile>): MediaItem[] {
  const alreadySeen = new Set(
    subjectUserIds.flatMap((uid) => (interactions[uid] ?? []).map((i) => i.media_item_id)),
  );

  const unseen = catalog.filter((item) => !alreadySeen.has(item.id));

  // Tag-overlap score: sum of (liked_tags matches) minus (disliked_tags matches),
  // pooled across every member of the subject (matches "any member's disliked
  // tags should suppress a candidate" from the group scoring intent).
  function tagScore(item: MediaItem): number {
    let score = 0;
    for (const uid of subjectUserIds) {
      const profile = profilesById[uid];
      for (const tag of item.tags) {
        if (profile.liked_tags.includes(tag)) score += 1;
        if (profile.disliked_tags.includes(tag)) score -= 2;
      }
    }
    return score;
  }

  const scored = unseen
    .map((item) => ({ item, score: tagScore(item) }))
    .sort((a, b) => b.score - a.score);

  const topByTagOverlap = scored.filter((s) => s.score > 0).map((s) => s.item);

  // Popularity fallback — fills the pool with broadly popular items even if
  // they didn't score on tag overlap (cold start / diversity), without duplicates.
  const popularityFallback = [...unseen]
    .sort((a, b) => b.popularity_score - a.popularity_score)
    .filter((item) => !topByTagOverlap.includes(item));

  const pool = [...topByTagOverlap, ...popularityFallback].slice(0, POOL_SIZE);
  return pool;
}
