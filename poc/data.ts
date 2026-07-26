// Stand-ins for the real Postgres tables (media_items, media_item_tags,
// user_media_interactions, user_taste_profiles) — just enough to exercise
// the candidate-generation + Claude-ranking pipeline without standing up
// Supabase yet.

export type MediaType = "movie" | "tv" | "book" | "comic" | "game";

export interface MediaItem {
  id: string;
  type: MediaType;
  title: string;
  tags: string[];
  popularity_score: number; // 0-100, used as the cold-start / diversity fallback
}

export const catalog: MediaItem[] = [
  // --- sci-fi / noir / dystopian leaning ---
  { id: "m1", type: "movie", title: "Blade Runner 2049", tags: ["sci-fi", "noir", "dystopian", "slow-burn"], popularity_score: 82 },
  { id: "m2", type: "movie", title: "Children of Men", tags: ["sci-fi", "dystopian", "slow-burn", "drama"], popularity_score: 74 },
  { id: "tv1", type: "tv", title: "Severance", tags: ["sci-fi", "mystery", "slow-burn", "dystopian"], popularity_score: 90 },
  { id: "b1", type: "book", title: "The Left Hand of Darkness", tags: ["sci-fi", "slow-burn", "literary"], popularity_score: 60 },
  { id: "g1", type: "game", title: "Disco Elysium", tags: ["noir", "mystery", "slow-burn", "dialogue-driven"], popularity_score: 85 },
  { id: "c1", type: "comic", title: "Saga", tags: ["sci-fi", "drama", "adventure"], popularity_score: 78 },

  // --- comedy / fantasy adventure / feel-good leaning ---
  { id: "m3", type: "movie", title: "Paddington 2", tags: ["comedy", "feel-good", "family"], popularity_score: 88 },
  { id: "m4", type: "movie", title: "The Princess Bride", tags: ["fantasy", "adventure", "comedy", "feel-good"], popularity_score: 91 },
  { id: "tv2", type: "tv", title: "The Good Place", tags: ["comedy", "fantasy", "feel-good"], popularity_score: 87 },
  { id: "b2", type: "book", title: "The House in the Cerulean Sea", tags: ["fantasy", "feel-good", "cozy"], popularity_score: 80 },
  { id: "g2", type: "game", title: "Stardew Valley", tags: ["cozy", "feel-good", "adventure"], popularity_score: 93 },
  { id: "c2", type: "comic", title: "Lumberjanes", tags: ["comedy", "adventure", "feel-good"], popularity_score: 70 },

  // --- broad-appeal "bridge" items spanning both clusters ---
  { id: "m5", type: "movie", title: "Everything Everywhere All at Once", tags: ["sci-fi", "comedy", "adventure", "feel-good"], popularity_score: 95 },
  { id: "tv3", type: "tv", title: "The Umbrella Academy", tags: ["sci-fi", "comedy", "dystopian", "adventure"], popularity_score: 83 },
  { id: "g3", type: "game", title: "Outer Wilds", tags: ["sci-fi", "mystery", "adventure", "feel-good"], popularity_score: 89 },

  // --- already-consumed by someone, to exercise the exclusion rule ---
  { id: "m6", type: "movie", title: "Arrival", tags: ["sci-fi", "slow-burn", "drama"], popularity_score: 86 },
  { id: "tv4", type: "tv", title: "Brooklyn Nine-Nine", tags: ["comedy", "feel-good"], popularity_score: 84 },
];

// Persisted taste profiles (mirrors user_taste_profiles.profile) — the
// PRIMARY input to recommendation, per the plan. Distinct from the raw
// interaction log below, which only matters here for exclusion.
export const profiles = {
  alex: {
    liked_tags: ["sci-fi", "noir", "dystopian", "slow-burn", "mystery"],
    disliked_tags: ["family"],
    summary:
      "Alex likes slow-burn, thoughtful sci-fi and noir — dystopian settings, " +
      "morally ambiguous characters, atmosphere over action. Not a fan of anything pitched at kids.",
  },
  sam: {
    liked_tags: ["comedy", "fantasy", "feel-good", "cozy", "adventure"],
    disliked_tags: ["dystopian"],
    summary:
      "Sam wants to feel good after — comedy, warm fantasy adventure, cozy low-stakes worlds. " +
      "Actively avoids bleak/dystopian stuff, had a bad time with a couple of grim recommendations before.",
  },
};

// Raw interaction log — only used here to exclude already-seen items.
export const interactions: Record<string, { media_item_id: string; status: string }[]> = {
  alex: [{ media_item_id: "m6", status: "consumed" }],
  sam: [{ media_item_id: "tv4", status: "consumed" }],
};
