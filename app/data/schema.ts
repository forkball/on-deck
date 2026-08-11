import { column as c, table } from 'remix/data-table'
import type { TableRow } from 'remix/data-table'

export const users = table({
  name: 'users',
  columns: {
    id: c.integer().primaryKey().autoIncrement(),
    email: c.text().notNull().unique(),
    password_hash: c.text().notNull(),
    // Doubles as the login handle alongside email — see auth/login/controller.tsx.
    display_name: c.text().notNull().unique(),
    // User-authored. Deliberately never fed into taste profiles — only the log
    // drives those.
    bio: c.text(),
    // SteamID64 of a linked Steam account, set by the OpenID flow (see
    // data/imports/steamApi.ts). Null until someone connects one.
    steam_id: c.text(),
    created_at: c.integer().notNull(),
  },
})

export const mediaItems = table({
  name: 'media_items',
  columns: {
    id: c.integer().primaryKey().autoIncrement(),
    type: c.enum(['movie', 'tv', 'book', 'game']).notNull(),
    external_source: c.text().notNull(),
    external_id: c.text().notNull(),
    title: c.text().notNull(),
    // jsonb, so Postgres validates on write and the GIN index answers
    // containment queries. Shape: app/data/mediaMetadata.ts.
    metadata: c.json().notNull(),
    popularity_score: c.decimal(10, 2),
    created_at: c.integer().notNull(),
  },
})

// Every status a log row can hold, in the order the picker offers them. Shared
// so the form parsers and the status picker can't drift from the column: a
// value added in only one of them fails at the database instead of the form.
//
// `not_interested` is a rejection rather than a stage of consuming something —
// nothing is ever read, played or watched under it. It exists so the
// recommendation pipeline has a way to be told "stop suggesting this".
export const INTERACTION_STATUSES = ['want_to_consume', 'in_progress', 'consumed', 'not_interested'] as const

export const userMediaInteractions = table({
  name: 'user_media_interactions',
  columns: {
    id: c.integer().primaryKey().autoIncrement(),
    user_id: c.integer().notNull().references('users', 'id'),
    media_item_id: c.integer().notNull().references('media_items', 'id'),
    status: c.enum(INTERACTION_STATUSES).notNull(),
    // Explicitly nullable, because null is a value this column means something
    // by: unrated, as opposed to rated. Without it the row type says `number`
    // and a write clearing the rating doesn't typecheck, which is what let
    // "can't be cleared" survive as long as it did.
    rating: c.decimal(3, 1).nullable(),
    notes: c.text(),
    consumed_at: c.integer(),
    created_at: c.integer().notNull(),
    updated_at: c.integer().notNull(),
  },
})

// The persisted, user-editable taste profile — distinct from the raw
// interaction log above. See app/data/recommendations/tasteProfile.ts.
export const userTasteProfiles = table({
  name: 'user_taste_profiles',
  primaryKey: ['user_id', 'media_type'],
  columns: {
    user_id: c.integer().notNull().references('users', 'id'),
    // One row per (user, media_type) — cross-media taste mixing is an explicit
    // opt-in, not the default.
    media_type: c.enum(['movie', 'tv', 'book', 'game']).notNull(),
    profile: c.text().notNull().default('{}'), // JSON string: { liked_tags: string[], disliked_tags: string[] }
    summary: c.text(),
    updated_at: c.integer().notNull(),
  },
})

// Live progress for an in-flight run. In the database rather than process
// memory because the app runs on more than one machine.
export const recommendationJobs = table({
  name: 'recommendation_jobs',
  columns: {
    id: c.text().primaryKey(),
    user_id: c.integer().notNull().references('users', 'id'),
    // queued | running | done | failed
    status: c.text().notNull(),
    // Everything needed to run this job on a machine that never saw the
    // request: member ids, media type, filters, source types, name.
    params: c.text().notNull(),
    // Output of each finished stage, so a resumed job doesn't repeat work it
    // already paid for. Null until the first stage completes.
    checkpoint: c.text(),
    claimed_at: c.integer(),
    attempts: c.integer().notNull(),
    phases: c.text().notNull(),
    phase: c.text().notNull(),
    run_id: c.integer(),
    pruned_oldest_run: c.integer().notNull(),
    error: c.text(),
    created_at: c.integer().notNull(),
    updated_at: c.integer().notNull(),
  },
})

// One "get recommendations" click, kept forever so past runs stay browsable.
export const recommendationRuns = table({
  name: 'recommendation_runs',
  columns: {
    id: c.integer().primaryKey().autoIncrement(),
    user_id: c.integer().notNull().references('users', 'id'), // the requester
    // What was recommended — independent of which taste profiles it was based
    // on (sourceTypes). The MAX_RUNS_PER_USER cap is scoped per media_type, so
    // a TV run never prunes an older movie run.
    media_type: c.enum(['movie', 'tv', 'book', 'game']).notNull(),
    created_at: c.integer().notNull(),
    // Optional user-given label (e.g. "Cozy weekend picks") — falls back to
    // the date in the UI when unset.
    name: c.text(),
    // The levers used, kept with the run so its page shows what was asked for
    // even after filters elsewhere change. See GenerationParams.
    params: c.text().notNull().default('{}'),
  },
})

// The requester plus any friends included in the run.
export const recommendationRunMembers = table({
  name: 'recommendation_run_members',
  primaryKey: ['run_id', 'user_id'],
  columns: {
    run_id: c.integer().notNull().references('recommendation_runs', 'id'),
    user_id: c.integer().notNull().references('users', 'id'),
  },
})

// The AI-generated picks belonging to one run.
export const userRecommendations = table({
  name: 'user_recommendations',
  columns: {
    id: c.integer().primaryKey().autoIncrement(),
    run_id: c.integer().notNull().references('recommendation_runs', 'id'),
    media_item_id: c.integer().notNull().references('media_items', 'id'),
    reason: c.text().notNull(),
    rank: c.integer().notNull(),
  },
})

// One-directional follow — no accept step. See app/data/follows.ts.
export const userFollows = table({
  name: 'user_follows',
  primaryKey: ['follower_id', 'followed_id'],
  columns: {
    follower_id: c.integer().notNull().references('users', 'id'),
    followed_id: c.integer().notNull().references('users', 'id'),
    created_at: c.integer().notNull(),
  },
})

// Created when a group run's requester and another member mutually follow.
export const notifications = table({
  name: 'notifications',
  columns: {
    id: c.integer().primaryKey().autoIncrement(),
    user_id: c.integer().notNull().references('users', 'id'), // recipient
    actor_user_id: c.integer().notNull().references('users', 'id'), // who did the thing
    // 'recommendation' | 'follow'. Only the former sets run_id.
    type: c.text().notNull(),
    run_id: c.integer(),
    read_at: c.integer(),
    created_at: c.integer().notNull(),
  },
})

export type User = TableRow<typeof users>
export type MediaItem = TableRow<typeof mediaItems>
export type UserMediaInteraction = TableRow<typeof userMediaInteractions>
export type UserTasteProfile = TableRow<typeof userTasteProfiles>
export type UserRecommendation = TableRow<typeof userRecommendations>
export type UserFollow = TableRow<typeof userFollows>
export type RecommendationRun = TableRow<typeof recommendationRuns>
export type RecommendationJob = TableRow<typeof recommendationJobs>
export type RecommendationRunMember = TableRow<typeof recommendationRunMembers>
export type Notification = TableRow<typeof notifications>
