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
