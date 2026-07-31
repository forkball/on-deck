import { column as c, table } from 'remix/data-table'
import type { TableRow } from 'remix/data-table'

export const users = table({
  name: 'users',
  columns: {
    id: c.integer().primaryKey().autoIncrement(),
    email: c.text().notNull().unique(),
    password_hash: c.text().notNull(),
    display_name: c.text(),
    // Free-text, user-authored — shown on their profile for other people to
    // read. Deliberately never fed into regenerateTasteProfile/recommendations;
    // only the movie log drives those.
    bio: c.text(),
    created_at: c.integer().notNull(),
  },
})

export const mediaItems = table({
  name: 'media_items',
  columns: {
    id: c.integer().primaryKey().autoIncrement(),
    type: c.enum(['movie', 'tv', 'book', 'comic', 'game']).notNull(),
    external_source: c.text().notNull(),
    external_id: c.text().notNull(),
    title: c.text().notNull(),
    // SQLite has no native JSONB; type-specific metadata (runtime, poster path, etc.)
    // is stored as a JSON string and parsed at the read boundary.
    metadata: c.text().notNull().default('{}'),
    popularity_score: c.decimal(10, 2),
    created_at: c.integer().notNull(),
  },
})

export const mediaItemTags = table({
  name: 'media_item_tags',
  columns: {
    media_item_id: c.integer().notNull().references('media_items', 'id'),
    tag: c.text().notNull(),
  },
  primaryKey: ['media_item_id', 'tag'],
})

export const userMediaInteractions = table({
  name: 'user_media_interactions',
  columns: {
    id: c.integer().primaryKey().autoIncrement(),
    user_id: c.integer().notNull().references('users', 'id'),
    media_item_id: c.integer().notNull().references('media_items', 'id'),
    status: c.enum(['want_to_consume', 'in_progress', 'consumed']).notNull(),
    rating: c.decimal(3, 1),
    notes: c.text(),
    consumed_at: c.integer(),
    created_at: c.integer().notNull(),
    updated_at: c.integer().notNull(),
  },
})

// The persisted, user-editable taste profile — distinct from the raw
// interaction log above. See app/data/tasteProfile.ts.
export const userTasteProfiles = table({
  name: 'user_taste_profiles',
  primaryKey: ['user_id', 'media_type'],
  columns: {
    user_id: c.integer().notNull().references('users', 'id'),
    // One row per (user, media_type) — movies and TV get independently
    // regenerated/persisted profiles, since cross-media taste mixing is an
    // explicit opt-in (not yet built) rather than the default.
    media_type: c.enum(['movie', 'tv', 'book', 'comic', 'game']).notNull(),
    profile: c.text().notNull().default('{}'), // JSON string: { liked_tags: string[], disliked_tags: string[] }
    summary: c.text(),
    updated_at: c.integer().notNull(),
  },
})

// One "get recommendations" click — indexed and dated, kept forever (not
// replaced on the next run) so past runs stay browsable by id. See
// app/data/recommendations.ts.
export const recommendationRuns = table({
  name: 'recommendation_runs',
  columns: {
    id: c.integer().primaryKey().autoIncrement(),
    user_id: c.integer().notNull().references('users', 'id'), // the requester
    // Which catalog this run's picks were matched against — the MAX_RUNS_PER_USER
    // cap (see recommendations.ts) is scoped per media_type, so generating a
    // TV run never prunes an older movie run and vice versa. Note this is
    // the type of thing being recommended, which is independent of which
    // taste profile(s) the picks were based on — see sourceTypes in
    // recommendations.ts.
    media_type: c.enum(['movie', 'tv', 'book', 'comic', 'game']).notNull(),
    created_at: c.integer().notNull(),
  },
})

// Who was in a given run (the requester + any friends included) — the
// "people involved" for that run.
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

// "X ran recommendations you can view" — created when a group run's
// requester and another member mutually follow each other. See
// app/data/notifications.ts.
export const notifications = table({
  name: 'notifications',
  columns: {
    id: c.integer().primaryKey().autoIncrement(),
    user_id: c.integer().notNull().references('users', 'id'), // recipient
    actor_user_id: c.integer().notNull().references('users', 'id'), // who ran it
    run_id: c.integer().notNull().references('recommendation_runs', 'id'),
    read_at: c.integer(),
    created_at: c.integer().notNull(),
  },
})

export type User = TableRow<typeof users>
export type MediaItem = TableRow<typeof mediaItems>
export type MediaItemTag = TableRow<typeof mediaItemTags>
export type UserMediaInteraction = TableRow<typeof userMediaInteractions>
export type UserTasteProfile = TableRow<typeof userTasteProfiles>
export type UserRecommendation = TableRow<typeof userRecommendations>
export type UserFollow = TableRow<typeof userFollows>
export type RecommendationRun = TableRow<typeof recommendationRuns>
export type RecommendationRunMember = TableRow<typeof recommendationRunMembers>
export type Notification = TableRow<typeof notifications>
