import { column as c, table } from 'remix/data-table'
import type { TableRow } from 'remix/data-table'

export const users = table({
  name: 'users',
  columns: {
    id: c.integer().primaryKey().autoIncrement(),
    email: c.text().notNull().unique(),
    password_hash: c.text().notNull(),
    display_name: c.text(),
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
    status: c.enum(['want_to_consume', 'in_progress', 'consumed', 'dropped']).notNull(),
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
  primaryKey: ['user_id'],
  columns: {
    user_id: c.integer().notNull().references('users', 'id'),
    profile: c.text().notNull().default('{}'), // JSON string: { liked_tags: string[], disliked_tags: string[] }
    summary: c.text(),
    updated_at: c.integer().notNull(),
  },
})

export type User = TableRow<typeof users>
export type MediaItem = TableRow<typeof mediaItems>
export type MediaItemTag = TableRow<typeof mediaItemTags>
export type UserMediaInteraction = TableRow<typeof userMediaInteractions>
export type UserTasteProfile = TableRow<typeof userTasteProfiles>
