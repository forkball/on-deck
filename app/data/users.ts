import { and, ilike, ne, or } from 'remix/data-table'

import type { Db } from './db.ts'
import { users, type User } from './schema.ts'

export function displayLabel(user: Pick<User, 'display_name' | 'email'>): string {
  return user.display_name || user.email
}

export async function searchUsers(db: Db, query: string, excludeUserId: number): Promise<User[]> {
  const pattern = `%${query}%`
  return db.findMany(users, {
    where: and(or(ilike('email', pattern), ilike('display_name', pattern)), ne('id', excludeUserId)),
    limit: 20,
  })
}

// User-authored — see the `bio` column in schema.ts for why it's kept separate
// from the AI-written taste profile.
export async function updateUserBio(db: Db, userId: number, bio: string): Promise<void> {
  await db.update(users, userId, { bio: bio || undefined })
}
