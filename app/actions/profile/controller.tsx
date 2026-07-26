import * as s from 'remix/data-schema'
import * as f from 'remix/data-schema/form-data'
import { Database } from 'remix/data-table'
import { Auth, requireAuth } from 'remix/middleware/auth'
import { createController } from 'remix/router'
import { redirect } from 'remix/response/redirect'
import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { getTasteProfile, parseProfile, upsertTasteProfile } from '../../data/tasteProfile.ts'
import type { User } from '../../data/schema.ts'
import { routes } from '../../routes.ts'
import { Document } from '../../ui/document.tsx'
import { Nav } from '../../ui/nav.tsx'

const profileSchema = f.object({
  summary: f.field(s.defaulted(s.string(), '')),
  liked_tags: f.field(s.defaulted(s.string(), '')),
  disliked_tags: f.field(s.defaulted(s.string(), '')),
})

function splitTags(value: string): string[] {
  return value
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)
}

interface ProfilePageProps {
  summary: string
  likedTags: string[]
  dislikedTags: string[]
  saved?: boolean
}

function ProfilePage(handle: Handle<ProfilePageProps>) {
  return () => {
    const { summary, likedTags, dislikedTags, saved } = handle.props

    return (
      <Document title="My taste profile | On Deck">
        <Nav authed={true} />
        <main mix={css({ maxWidth: '560px', margin: '0 auto', padding: '32px 24px' })}>
          <h1>My taste profile</h1>
          <p mix={css({ color: '#555' })}>
            This is what drives your recommendations — edit it any time. It also updates itself
            automatically as you log what you liked or didn't about things you watch.
          </p>
          {saved && <p mix={css({ color: '#15803d' })}>Saved.</p>}
          <form
            method="post"
            action={routes.profile.update.href()}
            mix={css({ display: 'flex', flexDirection: 'column', gap: '16px' })}
          >
            <input type="hidden" name="_method" value="PUT" />
            <label>
              Summary
              <textarea name="summary" rows={4} defaultValue={summary} mix={css({ width: '100%' })} />
            </label>
            <label>
              Liked tags (comma-separated)
              <input type="text" name="liked_tags" defaultValue={likedTags.join(', ')} mix={css({ width: '100%' })} />
            </label>
            <label>
              Disliked tags (comma-separated)
              <input
                type="text"
                name="disliked_tags"
                defaultValue={dislikedTags.join(', ')}
                mix={css({ width: '100%' })}
              />
            </label>
            <button type="submit">Save profile</button>
          </form>
        </main>
      </Document>
    )
  }
}

export default createController(routes.profile, {
  middleware: [requireAuth<User>()],
  actions: {
    async index(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      const db = context.get(Database)
      const row = await getTasteProfile(db, auth.identity.id)
      const data = parseProfile(row)

      return context.render(
        <ProfilePage
          summary={row?.summary ?? ''}
          likedTags={data.liked_tags}
          dislikedTags={data.disliked_tags}
          saved={context.url.searchParams.get('saved') === '1'}
        />,
      )
    },

    async update(context) {
      const auth = context.get(Auth)
      if (!auth.ok) return new Response('Unauthorized', { status: 401 })

      const formData = context.get(FormData)
      const parsed = s.parseSafe(profileSchema, formData)
      if (!parsed.success) {
        return new Response('Invalid profile input', { status: 400 })
      }

      const db = context.get(Database)
      await upsertTasteProfile(db, auth.identity.id, {
        summary: parsed.value.summary,
        liked_tags: splitTags(parsed.value.liked_tags),
        disliked_tags: splitTags(parsed.value.disliked_tags),
      })

      return redirect(`${routes.profile.index.href()}?saved=1`, 303)
    },
  },
})
