import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { BIO_MAX_LENGTH, USERNAME_HINT, USERNAME_MAX_LENGTH } from '../../../data/users.ts'
import type { TasteProfileSettings } from '../../../data/recommendations/tasteProfile.ts'
import { Toast } from '../../../ui/components/toast.tsx'
import { routes } from '../../../routes.ts'
import { Document } from '../../../ui/components/document.tsx'
import { Nav } from '../../../ui/components/nav.tsx'
import { PasswordConfirmModal } from '../../../ui/components/password-confirm-modal.tsx'
import { Field } from '../../../ui/shared/field.tsx'
import { Connections, type ConnectionsProps } from './connections.tsx'

export interface ProfileEditPageProps {
  // What to put back in the inputs: the stored row on a first load, whatever
  // was typed on a rejected submit.
  values: { email: string; display_name: string; bio: string; is_private: boolean }
  errors?: Record<string, string>
  // Set when the submit was refused for want of a password, so the modal
  // comes back already open with its error showing.
  confirming?: boolean
  settings: TasteProfileSettings
  // Set when the taste settings below were just saved.
  saved?: boolean
  displayName: string
  connections: ConnectionsProps
}

const LIMIT_LABELS = new Map<number | null, string>([
  [10, 'Last 10'],
  [50, 'Last 50'],
  [100, 'Last 100'],
  [null, 'Everything'],
])

// Its own form, on the same page rather than inside the one above. The edit
// form asks for a password when the email or username changes, and folding
// these in would put that prompt in front of someone who only wanted to stop
// sending their notes — the same reasoning that keeps the password on a page
// of its own.
function TasteProfileSettingsForm(handle: Handle<{ settings: TasteProfileSettings; saved?: boolean }>) {
  return () => {
    const { settings, saved } = handle.props

    return (
      <section mix={css({ marginTop: '40px', maxWidth: '480px' })}>
        <h2>What my taste profiles are written from</h2>
        <p mix={css({ margin: '0 0 16px', color: '#555' })}>
          Unlike the bio above, these do change your recommendations — they decide what gets read of
          your log when a taste profile is written.
        </p>
        <form
          method="post"
          action={routes.profile.settings.href()}
          mix={css({ display: 'flex', flexDirection: 'column', gap: '16px' })}
        >
          <Field
            label="How much of your log to use"
            hint="Counted from what you logged most recently. Narrowing it keeps your profile closer to where your taste is now, instead of averaging everything you've ever logged."
          >
            <select name="log_limit">
              {[...LIMIT_LABELS].map(([value, label]) => (
                <option
                  key={String(value)}
                  value={value == null ? 'all' : String(value)}
                  selected={settings.logLimit === value}
                >
                  {label}
                </option>
              ))}
            </select>
          </Field>

          {/* Not routed through Field for the same reason the privacy
              checkbox above isn't — it stretches inputs to full width. */}
          <div mix={css({ display: 'flex', flexDirection: 'column', gap: '4px' })}>
            <label mix={css({ display: 'flex', alignItems: 'center', gap: '8px' })}>
              <input
                type="checkbox"
                name="use_notes"
                defaultChecked={settings.useNotes}
                mix={css({ width: 'auto' })}
              />
              Use the notes I've written on things I've logged
            </label>
            <span mix={css({ fontSize: '12px', color: '#888' })}>
              Your notes say more about why you liked something than a rating can. Turn this off to keep
              them to yourself — everything else about the entry is still used.
            </span>
          </div>

          <div>
            <button type="submit">Save taste settings</button>
          </div>
          <span mix={css({ fontSize: '12px', color: '#888' })}>
            Changing these doesn't rewrite anything on its own. Each profile is rewritten next time you
            generate recommendations, or straight away with the Rebuild button beside it on your profile.
          </span>
        </form>
      </section>
    )
  }
}

export function ProfileEditPage(handle: Handle<ProfileEditPageProps>) {
  return () => {
    const { values, errors, confirming, settings, saved, displayName, connections } = handle.props

    return (
      <Document title="Edit profile | On Deck">
        <Nav authed={true} displayName={displayName} />
        {saved && <Toast message="Taste settings saved." />}
        {connections.letterboxd?.justConnected && (
          <Toast message="Connected. Your recent films are on their way in." />
        )}
        {connections.steam.justConnected && <Toast message="Steam account connected." />}
        {/* Same width as the profile page, so this heading lands on the
            same left edge as the name it edits rather than 80px in from it.
            The form keeps its own narrower measure — inputs 640px wide read
            worse, and that was what the narrower <main> was really for. */}
        <main mix={css({ maxWidth: '640px', margin: '0 auto', padding: '32px 24px' })}>
          <p mix={css({ margin: '0 0 16px' })}>
            <a href={routes.profile.index.href()}>← Back to your profile</a>
          </p>
          <h1>Edit profile</h1>
          <form
            method="post"
            action={routes.profile.edit.update.href()}
            mix={css({ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '480px' })}
          >
            <input type="hidden" name="_method" value="PUT" />
            <Field
              label="Email"
              error={errors?.email}
              hint="Used to log in. Nobody else sees it unless you have no username."
            >
              <input type="email" name="email" required defaultValue={values.email} />
            </Field>
            <Field label="Username" error={errors?.display_name} hint={USERNAME_HINT}>
              <input
                type="text"
                name="display_name"
                required
                maxLength={USERNAME_MAX_LENGTH}
                defaultValue={values.display_name}
              />
            </Field>
            <Field
              label="Bio"
              error={errors?.bio}
              hint="Just for other people to read — it has no effect on your recommendations."
            >
              <textarea
                name="bio"
                rows={4}
                maxLength={BIO_MAX_LENGTH}
                defaultValue={values.bio}
                placeholder="Tell people a bit about yourself…"
              />
            </Field>
            {/* Not routed through Field — that stretches inputs to 100%
                width, which turns a checkbox into a giant square. */}
            <div mix={css({ display: 'flex', flexDirection: 'column', gap: '4px' })}>
              <label mix={css({ display: 'flex', alignItems: 'center', gap: '8px' })}>
                <input
                  type="checkbox"
                  name="is_private"
                  defaultChecked={values.is_private}
                  mix={css({ width: 'auto' })}
                />
                Private profile
              </label>
              <span mix={css({ fontSize: '12px', color: '#888' })}>
                Anyone can still find you by name and see your follow counts. Your bio and log are only
                visible to people who follow you.
              </span>
            </div>
            {/* Both handles are unique and reachable — changing either is
                what the password confirms. The modal lives inside this form,
                so its box is one of these fields. */}
            <PasswordConfirmModal
              action="change your email or username"
              guardedFields={['email', 'display_name']}
              error={errors?.current_password}
              defaultOpen={confirming}
            />
            <div mix={css({ display: 'flex', alignItems: 'center', gap: '16px' })}>
              <button type="submit">Save changes</button>
              <a href={routes.profile.password.index.href()} mix={css({ marginLeft: 'auto' })}>
                Change password
              </a>
            </div>
          </form>

          <TasteProfileSettingsForm settings={settings} saved={saved} />

          <Connections letterboxd={connections.letterboxd} steam={connections.steam} />
        </main>
      </Document>
    )
  }
}
