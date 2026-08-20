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
    bio: c.text(),
    steam_id: c.text(),
    // Gates the bio and media log behind a follow (see follows.ts,
    // canViewProfile) — everyone still sees the name and follow counts.
    is_private: c.boolean().notNull().default(false),
    is_admin: c.boolean().notNull().default(false),
    profile_log_limit: c.integer().nullable(),
    profile_use_notes: c.boolean().notNull().default(true),
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
// so the form parsers and the picker can't drift from the column.
//
// `not_interested` is a rejection, not a stage of consuming something — it's how
// the recommendation pipeline is told "stop suggesting this".
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
    // and a write clearing the rating doesn't typecheck.
    rating: c.decimal(3, 1).nullable(),
    // The third answer to the rating question, alongside a score and silence.
    // Mutually exclusive with `rating`, so true here always means rating is
    // null. Nullable for the same reason: null is "hasn't said", not false.
    disliked: c.boolean().nullable(),
    // Nullable for the third time, and for the same reason: the column has
    // always accepted null, but typing it `string` forced every caller to write
    // `?? undefined` to satisfy tsc — and a key that is present but undefined is
    // written as NULL, so the workaround silently cleared notes.
    notes: c.text().nullable(),
    consumed_at: c.integer(),
    created_at: c.integer().notNull(),
    updated_at: c.integer().notNull(),
  },
})

export const userTasteProfiles = table({
  name: 'user_taste_profiles',
  primaryKey: ['user_id', 'media_type'],
  columns: {
    user_id: c.integer().notNull().references('users', 'id'),
    media_type: c.enum(['movie', 'tv', 'book', 'game']).notNull(),
    profile: c.text().notNull().default('{}'), // JSON string: { liked_tags: string[], disliked_tags: string[] }
    summary: c.text(),
    updated_at: c.integer().notNull(),
  },
})

export const recommendationJobs = table({
  name: 'recommendation_jobs',
  columns: {
    id: c.text().primaryKey(),
    user_id: c.integer().notNull().references('users', 'id'),
    // queued | running | done | failed
    status: c.text().notNull(),
    params: c.text().notNull(),
    checkpoint: c.text(),
    claimed_at: c.integer(),
    attempts: c.integer().notNull(),
    phases: c.text().notNull(),
    phase: c.text().notNull(),
    run_id: c.integer(),
    pruned_oldest_run: c.integer().notNull(),
    error: c.text(),
    timings: c.text(),
    created_at: c.integer().notNull(),
    updated_at: c.integer().notNull(),
  },
})

export const recommendationRuns = table({
  name: 'recommendation_runs',
  columns: {
    id: c.integer().primaryKey().autoIncrement(),
    user_id: c.integer().notNull().references('users', 'id'), // the requester
    // What was recommended, independent of which profiles it drew on
    // (sourceTypes). MAX_RUNS_PER_USER is scoped per media_type.
    media_type: c.enum(['movie', 'tv', 'book', 'game']).notNull(),
    created_at: c.integer().notNull(),
    name: c.text(),
    params: c.text().notNull().default('{}'),
    timings: c.text(),
  },
})

export const recommendationRunUsage = table({
  name: 'recommendation_run_usage',
  columns: {
    id: c.integer().primaryKey().autoIncrement(),
    user_id: c.integer().notNull().references('users', 'id'),
    created_at: c.integer().notNull(),
  },
})

export const profileRebuildUsage = table({
  name: 'profile_rebuild_usage',
  columns: {
    id: c.integer().primaryKey().autoIncrement(),
    user_id: c.integer().notNull().references('users', 'id'),
    created_at: c.integer().notNull(),
  },
})

export const recommendationRunMembers = table({
  name: 'recommendation_run_members',
  primaryKey: ['run_id', 'user_id'],
  columns: {
    run_id: c.integer().notNull().references('recommendation_runs', 'id'),
    user_id: c.integer().notNull().references('users', 'id'),
  },
})

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

// A CSV upload held between matching and the log — see the 20260818120000
// migration for why matching results need somewhere to live.
export const importBatches = table({
  name: 'import_batches',
  columns: {
    id: c.text().primaryKey(),
    user_id: c.integer().notNull().references('users', 'id'),
    media_type: c.enum(['movie', 'tv', 'book', 'game']).notNull(),
    source: c.text().notNull(),
    // matching | review | saving | done | failed
    status: c.text().notNull(),
    total_rows: c.integer().notNull().default(0),
    matched_rows: c.integer().notNull().default(0),
    // keep | take — what a conflicting row does by default.
    conflict_choice: c.text().notNull().default('keep'),
    error: c.text(),
    claimed_at: c.integer().nullable(),
    created_at: c.integer().notNull(),
    updated_at: c.integer().notNull(),
    completed_at: c.integer().nullable(),
  },
})

export const importRows = table({
  name: 'import_rows',
  columns: {
    id: c.integer().primaryKey().autoIncrement(),
    batch_id: c.text().notNull().references('import_batches', 'id'),
    row_index: c.integer().notNull(),
    raw_title: c.text().notNull(),
    raw_year: c.integer().nullable(),
    // Nullable for the same reason user_media_interactions.rating is: null is
    // "unrated", which a blank cell in an export genuinely means.
    rating: c.decimal(3, 1).nullable(),
    disliked: c.boolean().nullable(),
    notes: c.text().nullable(),
    consumed_at: c.integer().nullable(),
    // See RowState in app/data/imports/classify.ts.
    state: c.text().notNull().default('pending'),
    reason: c.text(),
    year_delta: c.integer().nullable(),
    matched_external_id: c.text(),
    media_item_id: c.integer().nullable(),
    created_at: c.integer().notNull(),
    updated_at: c.integer().notNull(),
  },
})

export const userFollows = table({
  name: 'user_follows',
  primaryKey: ['follower_id', 'followed_id'],
  columns: {
    follower_id: c.integer().notNull().references('users', 'id'),
    followed_id: c.integer().notNull().references('users', 'id'),
    created_at: c.integer().notNull(),
  },
})

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
export type RecommendationRunUsage = TableRow<typeof recommendationRunUsage>
export type ProfileRebuildUsage = TableRow<typeof profileRebuildUsage>
export type Notification = TableRow<typeof notifications>
export type ImportBatch = TableRow<typeof importBatches>
export type ImportRow = TableRow<typeof importRows>
