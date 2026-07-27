import { clientEntry, css, ref } from 'remix/ui'

// Only movies are wired up today — the rest are placeholders so the picker
// reads as "more coming" rather than a dead end.
const OTHER_MEDIA_TYPES = ['TV', 'Games', 'Books', 'Comics']

// Client-hydrated (see profile-menu.tsx for the pattern). Native
// <details>/<summary> drives the open/close toggle and works with no JS;
// this only adds a document-level "click outside closes it" listener,
// scoped to the element's lifetime via ref(). Not built on the shared
// FloatingDropdown component: that one takes arbitrary children (forms with
// inputs, etc.) which can't be passed as serializable clientEntry props —
// this menu's content is fully static, so it's rendered directly instead.
export const MediaTypeFab = clientEntry(import.meta.url, function MediaTypeFab() {
  return () => (
    <details
      mix={[
        css({
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          zIndex: 900,
          '& summary': {
            display: 'inline-block',
            cursor: 'pointer',
            listStyle: 'none',
            padding: '14px 22px',
            textAlign: 'center',
            backgroundColor: '#fdf7f1',
            boxShadow: '0 4px 14px rgba(0, 0, 0, 0.3)',
          },
          '& summary::-webkit-details-marker': {
            display: 'none',
          },
          '& .menu': {
            position: 'absolute',
            bottom: 'calc(100% + 4px)',
            right: 0,
            zIndex: 10,
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            minWidth: '200px',
            padding: '12px',
            backgroundColor: '#fdf7f1',
            border: '1px solid #3c3c3c',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
          },
          '& .menu-row': {
            display: 'flex',
            justifyContent: 'space-between',
            gap: '8px',
            color: '#aaa',
          },
          '& .menu-tag': {
            fontSize: '11px',
            whiteSpace: 'nowrap',
          },
        }),
        ref((node, signal) => {
          const details = node as HTMLDetailsElement
          const summary = details.querySelector('summary')

          document.addEventListener(
            'click',
            (event) => {
              if (!details.open) return
              if (summary?.contains(event.target as Node)) return
              details.open = false
            },
            { signal },
          )
        }),
      ]}
    >
      <summary class="doodle-border">Movies</summary>
      <div class="menu">
        <div mix={css({ fontWeight: 700 })}>Movies</div>
        {OTHER_MEDIA_TYPES.map((label) => (
          <div key={label} class="menu-row">
            {label}
            <span class="menu-tag">Coming soon</span>
          </div>
        ))}
      </div>
    </details>
  )
})
