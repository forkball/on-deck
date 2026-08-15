
// Minimal RFC 4180 parser. Quoted fields matter: both exports use them for any
// title containing a comma ("Synecdoche, New York").
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]

    if (inQuotes) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (char === '"') {
        inQuotes = false
      } else {
        field += char
      }
      continue
    }

    if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\r') {
      // skip
    } else if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows
}

// By header name rather than position, so reordered columns don't break parsing.
export function headerIndex(header: string[]): (name: string) => number {
  const normalized = header.map((column) => column.trim().toLowerCase())
  return (name: string) => normalized.indexOf(name.toLowerCase())
}

// Goodreads wraps cells for Excel: an ISBN arrives as `="0060590297"`, an absent
// one as `=""`. Matched literally, every one would miss.
export function cleanCell(value: string | undefined): string {
  if (!value) return ''
  const unwrapped = value.trim().replace(/^="?/, '').replace(/"?$/, '')
  return unwrapped.trim()
}

// Imports run inside the request with no job queue behind them, so this keeps a
// few hundred rows from opening a few hundred simultaneous catalog connections.
export async function runBounded<T>(items: T[], concurrency: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0

  async function worker() {
    while (next < items.length) {
      const item = items[next++]
      await work(item)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
}
