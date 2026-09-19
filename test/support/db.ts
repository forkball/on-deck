import { pool } from '../../app/data/db.ts'

// The line every database-backed test skips on, in one place so half the suite
// can't tell you a different way to run the other half.
export const skipWithoutDatabase = process.env.DATABASE_URL
  ? false
  : 'set DATABASE_URL to run (npm run db:up && npm run db:migrate)'

export interface TestUser {
  id: number
  email: string
  displayName: string
}

// A user nothing else in the suite will collide with. Tests run against one
// database and `users.display_name` is unique, so the stamp is the isolation —
// which is also why the handles are returned rather than left for the caller to
// reconstruct. Pass a real hash to log in as this user; the default never
// verifies against anything.
export async function insertUser(tag: string, passwordHash = 'x'): Promise<TestUser> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const email = `${tag}-${stamp}@example.test`
  const displayName = `${tag}-${stamp}`
  const { rows } = await pool.query<{ id: number }>(
    `insert into users (email, password_hash, display_name, created_at)
     values ($1, $2, $3, $4) returning id`,
    [email, passwordHash, displayName, Date.now()],
  )
  return { id: rows[0]!.id, email, displayName }
}

// Deletes what a test's users touched, in an order the foreign keys allow.
export async function deleteUsers(userIds: number[]): Promise<void> {
  for (const id of userIds) {
    if (!id) continue
    await pool.query('delete from user_media_interactions where user_id = $1', [id])
    await pool.query('delete from user_follows where follower_id = $1 or followed_id = $1', [id])
    await pool.query('delete from users where id = $1', [id])
  }
}
