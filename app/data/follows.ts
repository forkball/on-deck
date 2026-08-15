import { and, eq, inList } from 'remix/data-table'

import type { Db } from './db.ts'
import { createNotification } from './notifications.ts'
import { userFollows, users, type User } from './schema.ts'

export async function followUser(db: Db, followerId: number, followedId: number): Promise<void> {
  // Nobody follows themselves. The button that would do it isn't rendered
  // any more (see FollowListPage), but this is the check that holds for a
  // POST made directly, and it sits here rather than in the controller so
  // every caller gets it. The check constraint behind it makes a row that
  // got past both unstorable.
  if (followerId === followedId) return

  const existing = await db.findOne(userFollows, {
    where: { follower_id: followerId, followed_id: followedId },
  })
  if (existing) return

  await db.create(userFollows, { follower_id: followerId, followed_id: followedId, created_at: Date.now() })

  // Here rather than in the controller so it can only fire on a genuinely new
  // follow; unfollow/refollow is caught by the unique index.
  try {
    await createNotification(db, { userId: followedId, actorUserId: followerId, type: 'follow' })
  } catch {
    // Re-following after an unfollow hits the partial unique index; they
    // already have the notification.
  }
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

export async function canViewProfile(
  db: Db,
  viewerId: number,
  target: Pick<User, 'id' | 'is_private'>,
): Promise<boolean> {
  if (!target.is_private) return true
  if (viewerId === target.id) return true
  return isFollowing(db, viewerId, target.id)
}

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
