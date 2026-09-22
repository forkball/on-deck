import { inList } from 'remix/data-table'

import type { Db } from './db.ts'
import { notifications, users } from './schema.ts'
import { displayLabel } from './users.ts'

export type NotificationType = 'recommendation' | 'follow'

export interface NotificationSummary {
  id: number
  actorLabel: string
  type: NotificationType
  // Only set for kinds that point at a run.
  runId: number | null
  actorUserId: number
  createdAt: number
  read: boolean
}

export async function createNotification(
  db: Db,
  input: { userId: number; actorUserId: number; type: NotificationType; runId?: number },
): Promise<void> {
  // A group run includes the person who asked for it.
  if (input.userId === input.actorUserId) return

  await db.create(notifications, {
    user_id: input.userId,
    actor_user_id: input.actorUserId,
    type: input.type,
    run_id: input.runId,
    created_at: Date.now(),
  })
}

const LIST_LIMIT = 30

export async function listNotifications(db: Db, userId: number): Promise<NotificationSummary[]> {
  const rows = await db.findMany(notifications, {
    where: { user_id: userId },
    orderBy: ['created_at', 'desc'],
    limit: LIST_LIMIT,
  })
  if (rows.length === 0) return []

  const actors = await db.findMany(users, {
    where: inList(
      'id',
      rows.map((row) => row.actor_user_id),
    ),
  })
  const actorLabelById = new Map(actors.map((actor) => [actor.id, displayLabel(actor)]))

  return rows.map((row) => ({
    id: row.id,
    actorLabel: actorLabelById.get(row.actor_user_id) ?? 'Someone',
    type: (row.type as NotificationType) ?? 'recommendation',
    runId: row.run_id ?? null,
    actorUserId: row.actor_user_id,
    createdAt: row.created_at,
    read: row.read_at != null,
  }))
}

export function countUnreadNotifications(db: Db, userId: number): Promise<number> {
  return db.count(notifications, { where: { user_id: userId, read_at: null } })
}

export async function markAllNotificationsRead(db: Db, userId: number): Promise<void> {
  await db.updateMany(notifications, { read_at: Date.now() }, { where: { user_id: userId, read_at: null } })
}

// False rather than throwing if it isn't this user's. Already-read
// notifications keep their original read_at.
export async function markNotificationRead(db: Db, notificationId: number, userId: number): Promise<boolean> {
  const existing = await db.find(notifications, notificationId)
  if (!existing || existing.user_id !== userId) return false
  if (existing.read_at != null) return true

  await db.update(notifications, notificationId, { read_at: Date.now() })
  return true
}
