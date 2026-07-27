import { and, eq, inList } from 'remix/data-table'

import type { Db } from './db.ts'
import { userFollows, users, type User } from './schema.ts'

export async function followUser(db: Db, followerId: number, followedId: number): Promise<void> {
  const existing = await db.findOne(userFollows, {
    where: { follower_id: followerId, followed_id: followedId },
  })
  if (existing) return

  await db.create(userFollows, { follower_id: followerId, followed_id: followedId, created_at: Date.now() })
}

export async function unfollowUser(db: Db, followerId: number, followedId: number): Promise<void> {
  await db.deleteMany(userFollows, { where: { follower_id: followerId, followed_id: followedId } })
}

export async function isFollowing(db: Db, followerId: number, followedId: number): Promise<boolean> {
  const existing = await db.findOne(userFollows, {
    where: { follower_id: followerId, followed_id: followedId },
  })
  return existing != null
}

// Which of `candidateIds` does `followerId` already follow — one query instead
// of one `isFollowing` call per candidate.
export async function listFollowingIds(
  db: Db,
  followerId: number,
  candidateIds: number[],
): Promise<Set<number>> {
  if (candidateIds.length === 0) return new Set()

  const rows = await db.findMany(userFollows, {
    where: and(eq('follower_id', followerId), inList('followed_id', candidateIds)),
  })
  return new Set(rows.map((row) => row.followed_id))
}

export async function listFollowedUsers(db: Db, followerId: number): Promise<User[]> {
  const rows = await db.findMany(userFollows, { where: { follower_id: followerId } })
  if (rows.length === 0) return []

  return db.findMany(users, { where: inList('id', rows.map((row) => row.followed_id)) })
}

export async function listFollowers(db: Db, followedId: number): Promise<User[]> {
  const rows = await db.findMany(userFollows, { where: { followed_id: followedId } })
  if (rows.length === 0) return []

  return db.findMany(users, { where: inList('id', rows.map((row) => row.follower_id)) })
}

export function countFollowing(db: Db, userId: number): Promise<number> {
  return db.count(userFollows, { where: { follower_id: userId } })
}

export function countFollowers(db: Db, userId: number): Promise<number> {
  return db.count(userFollows, { where: { followed_id: userId } })
}
