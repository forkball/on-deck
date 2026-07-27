import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import type { UserMediaInteraction } from '../../data/schema.ts'
import { routes } from '../../routes.ts'
import { Modal } from './modal.tsx'
import { StarRatingInput } from './star-rating.tsx'
import { StatusSelect } from './status-select.tsx'
import { stackedLabel } from './styles.ts'

export interface MovieLogEditModalProps {
  interaction: UserMediaInteraction
  title: string
  returnTo: string
}

// The "Edit" modal on a logged movie row — shared by the profile page and its
// paginated "see more" view, both of which render the same watched-list rows.
export function MovieLogEditModal(handle: Handle<MovieLogEditModalProps>) {
  return () => {
    const { interaction, title, returnTo } = handle.props

    return (
      <Modal id={`edit-log-${interaction.id}`} triggerLabel="Edit" title={title}>
        <form
          method="post"
          action={routes.movies.interactions.update.href({ interactionId: String(interaction.id) })}
          mix={css({ display: 'flex', flexDirection: 'column', gap: '12px' })}
        >
          <input type="hidden" name="_method" value="PUT" />
          <input type="hidden" name="return_to" value={returnTo} />
          <label mix={stackedLabel}>
            Status
            <StatusSelect name="status" defaultValue={interaction.status} />
          </label>
          <div class="watched-only-fields" mix={css({ flexDirection: 'column', gap: '12px' })}>
            <div>
              <p mix={css({ margin: '0 0 4px' })}>Rating</p>
              <StarRatingInput
                name="rating"
                idPrefix={`rating-${interaction.id}`}
                defaultValue={interaction.rating ?? null}
              />
            </div>
            <label mix={stackedLabel}>
              Notes
              <textarea name="notes" rows={3} defaultValue={interaction.notes ?? ''} placeholder="What did you think?" />
            </label>
          </div>
          <button type="submit">Save</button>
        </form>
      </Modal>
    )
  }
}
