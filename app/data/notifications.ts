import { inList } from 'remix/data-table'

import type { Db } from './db.ts'
import { notifications, users } from './schema.ts'
import { displayLabel } from './users.ts'

export interface NotificationSummary {
  id: number
  actorLabel: string
  runId: number
  createdAt: number
  read: boolean
}

export async function createNotification(
  db: Db,
  input: { userId: number; actorUserId: number; runId: number },
): Promise<void> {
  await db.create(notifications, {
    user_id: input.userId,
    actor_user_id: input.actorUserId,
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

  const actors = await db.findMany(users, { where: inList('id', rows.map((row) => row.actor_user_id)) })
  const actorLabelById = new Map(actors.map((actor) => [actor.id, displayLabel(actor)]))

  return rows.map((row) => ({
    id: row.id,
    actorLabel: actorLabelById.get(row.actor_user_id) ?? 'Someone',
    runId: row.run_id,
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
