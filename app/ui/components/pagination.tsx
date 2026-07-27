import type { Handle } from 'remix/ui'
import { css } from 'remix/ui'

export interface PaginationProps {
  page: number
  totalPages: number
  pageHref: (page: number) => string
}

// Caller is expected to only render this when totalPages > 1.
export function Pagination(handle: Handle<PaginationProps>) {
  return () => {
    const { page, totalPages, pageHref } = handle.props

    return (
      <div mix={css({ display: 'flex', justifyContent: 'space-between', marginTop: '24px' })}>
        {page > 1 ? <a href={pageHref(page - 1)}>← Newer</a> : <span />}
        <span mix={css({ color: '#888', fontSize: '13px' })}>
          Page {page} of {totalPages}
        </span>
        {page < totalPages ? <a href={pageHref(page + 1)}>Older →</a> : <span />}
      </div>
    )
  }
}
