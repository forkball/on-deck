import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { UserMediaInteraction } from '../../data/schema.ts'
import type { ActiveMediaType } from '../../utils/mediaTypes.ts'
import { routes } from '../../routes.ts'
import { Modal } from './modal.tsx'
import { StarRatingInput } from './star-rating.tsx'
import { StatusSelect } from './status-select.tsx'
import { Field } from '../../assets/lib/field.tsx'

export interface MediaLogEditModalProps {
  interaction: UserMediaInteraction
  title: string
  returnTo: string
  // Drives the status verbs — "Want to read" for a book, "Want to watch"
  // for a film. Without it every row defaulted to watch verbs.
  mediaType: ActiveMediaType
}

// The "Edit" modal on a logged row — shared by the profile page and its
// paginated "see more" view, both of which render the same watched-list rows.
export function MediaLogEditModal(handle: Handle<MediaLogEditModalProps>) {
  return () => {
    const { interaction, title, returnTo, mediaType } = handle.props

    return (
      <Modal id={`edit-log-${interaction.id}`} triggerLabel="Edit" title={title}>
        <form
          id={`edit-log-form-${interaction.id}`}
          method="post"
          action={routes.interactions.update.href({ interactionId: String(interaction.id) })}
          mix={css({ display: 'flex', flexDirection: 'column', gap: '12px' })}
        >
          <input type="hidden" name="_method" value="PUT" />
          <input type="hidden" name="return_to" value={returnTo} />
          <Field label="Status">
            <StatusSelect mediaType={mediaType} name="status" defaultValue={interaction.status} />
          </Field>
          <div class="watched-only-fields" mix={css({ flexDirection: 'column', gap: '12px' })}>
            <div>
              <p mix={css({ margin: '0 0 4px' })}>Rating</p>
              <StarRatingInput
                name="rating"
                idPrefix={`rating-${interaction.id}`}
                defaultValue={interaction.rating ?? null}
              />
            </div>
            <Field label="Notes">
              <textarea name="notes" rows={3} defaultValue={interaction.notes ?? ''} placeholder="What did you think?" />
            </Field>
          </div>
        </form>
        <div mix={css({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginTop: '12px' })}>
          <button type="submit" form={`edit-log-form-${interaction.id}`}>
            Save
          </button>
          <form
            method="post"
            action={routes.interactions.destroy.href({ interactionId: String(interaction.id) })}
          >
            <input type="hidden" name="_method" value="DELETE" />
            <input type="hidden" name="return_to" value={returnTo} />
            <button type="submit" class="danger">
              Delete log
            </button>
          </form>
        </div>
      </Modal>
    )
  }
}
