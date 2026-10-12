import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

import { ACTIVE_MEDIA_TYPES, MEDIA_TYPE_UI, type ActiveMediaType } from '../../../mediaTypes.ts'
import { routes } from '../../../routes.ts'
import { Button } from '../../../ui/shared/form-controls.tsx'

export interface MediaOrderProps {
  // Already through parseMediaOrder: every type, once.
  order: ActiveMediaType[]
}

// The order with the type at `index` swapped one place towards `delta`, as the
// comma-separated value the action reads.
function moved(order: ActiveMediaType[], index: number, delta: -1 | 1): string {
  const next = [...order]
  ;[next[index], next[index + delta]] = [next[index + delta], next[index]]
  return next.join(',')
}

// Up and down buttons rather than drag and drop: each is a plain submit carrying
// the order it would leave, so it works without anything running in the
// browser, and no submission can name a type twice or leave one out.
export function MediaOrder(handle: Handle<MediaOrderProps>) {
  return () => {
    const { order } = handle.props
    const isDefault = order.every((type, index) => type === ACTIVE_MEDIA_TYPES[index])

    return (
      <section mix={css({ maxWidth: '480px' })}>
        <h2 mix={css({ marginTop: 0 })}>Media order</h2>
        <p mix={css({ margin: '0 0 16px', color: 'var(--soft)' })}>
          The order the Movies, TV, Books and Games tabs come in on search, recommendations and profiles. The
          first is where those pages open.
        </p>
        <form method="post" action={routes.profile.mediaOrder.href()}>
          <ol
            mix={css({
              listStyle: 'none',
              margin: '0 0 16px',
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            })}
          >
            {order.map((type, index) => {
              const label = MEDIA_TYPE_UI[type].tabLabel
              return (
                <li
                  key={type}
                  mix={css({
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 0',
                    borderBottom: '1px solid var(--rule)',
                  })}
                >
                  <span mix={css({ color: 'var(--muted)', width: '1.5em' })}>{index + 1}.</span>
                  <span mix={css({ flex: 1 })}>{label}</span>
                  <Button
                    type="submit"
                    name="media_order"
                    value={index > 0 ? moved(order, index, -1) : ''}
                    disabled={index === 0}
                    aria-label={`Move ${label} up`}
                  >
                    ↑
                  </Button>
                  <Button
                    type="submit"
                    name="media_order"
                    value={index < order.length - 1 ? moved(order, index, 1) : ''}
                    disabled={index === order.length - 1}
                    aria-label={`Move ${label} down`}
                  >
                    ↓
                  </Button>
                </li>
              )
            })}
          </ol>
          {!isDefault && (
            // Empty is "never chosen", which parses back to the registry's order.
            <Button type="submit" variant="link" name="media_order" value="">
              Back to the default order
            </Button>
          )}
        </form>
      </section>
    )
  }
}
