import type { Handle, RemixNode } from 'remix/ui'
import { css } from 'remix/ui'

import { Link } from '../shared/form-controls.tsx'

// Catalogue descriptions are sometimes Markdown — Open Library's are written in
// it ("**Have you got the Guts?**", "- [Volume 2](https://openlibrary.org/…)",
// "([source][1])" with the URL at the foot) — and printed as plain text they
// show their asterisks and brackets.
//
// A small subset, parsed here rather than with a library, because what the page
// needs is narrower than Markdown: paragraphs, lists, a rule, emphasis, inline
// code and links. Nothing is ever emitted as HTML — a raw tag in a description
// stays text — and a link renders only when it points at http(s), so a
// `javascript:` URL in third-party copy goes nowhere.
//
// One deliberate departure: a single newline inside a paragraph is a line break,
// not a space. The other providers' plain-text descriptions put their line
// breaks there meaning them, and the page kept them before this existed.

export type MarkdownInline =
  | { type: 'text'; value: string }
  | { type: 'strong'; children: MarkdownInline[] }
  | { type: 'em'; children: MarkdownInline[] }
  | { type: 'code'; value: string }
  | { type: 'link'; href: string; children: MarkdownInline[] }
  | { type: 'break' }

export type MarkdownBlock =
  | { type: 'paragraph'; children: MarkdownInline[] }
  // Rendered as a bold paragraph: a description's "## Contents" must not
  // outrank the page's own headings.
  | { type: 'heading'; children: MarkdownInline[] }
  | { type: 'list'; ordered: boolean; items: MarkdownInline[][] }
  | { type: 'quote'; children: MarkdownInline[] }
  | { type: 'rule' }

const REFERENCE_DEFINITION = /^ {0,3}\[([^\]]+)\]:\s*<?(\S+?)>?(?:\s+["'(].*["')])?\s*$/
const HEADING = /^ {0,3}#{1,6}\s+(.*?)(?:\s+#+)?\s*$/
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/
const LIST_ITEM = /^ {0,3}([-*+]|\d{1,9}[.)])\s+(.*)$/
const QUOTE = /^ {0,3}>\s?(.*)$/
const ESCAPABLE = /[\\`*_{}[\]()#+\-.!<>"'|~]/

function safeHref(url: string): string | null {
  return /^https?:\/\//i.test(url) ? url : null
}

type References = Map<string, string>

function referenceKey(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase()
}

// The index of the `]` closing the `[` at `open`, allowing nested brackets.
function closingBracket(text: string, open: number): number {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    const char = text[i]
    if (char === '\\') i++
    else if (char === '[') depth++
    else if (char === ']' && --depth === 0) return i
  }
  return -1
}

// A closing emphasis delimiter: not preceded by whitespace, and for `_` not
// inside a word, so snake_case_names stay as they are.
function closingDelimiter(text: string, from: number, delimiter: string): number {
  for (let i = from; i <= text.length - delimiter.length; i++) {
    if (text[i] === '\\') {
      i++
      continue
    }
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1)
      if (end !== -1) i = end
      continue
    }
    if (!text.startsWith(delimiter, i) || /\s/.test(text[i - 1])) continue
    // A single `*` that is half of a `**` belongs to the strong run, not to us.
    if (delimiter.length === 1 && (text[i + 1] === delimiter || text[i - 1] === delimiter)) continue
    if (delimiter[0] === '_' && /\w/.test(text[i + delimiter.length] ?? '')) continue
    return i
  }
  return -1
}

function parseInline(text: string, references: References): MarkdownInline[] {
  const nodes: MarkdownInline[] = []
  let buffer = ''
  const flush = () => {
    if (buffer) nodes.push({ type: 'text', value: buffer })
    buffer = ''
  }

  for (let i = 0; i < text.length;) {
    const char = text[i]
    const rest = text.slice(i)

    if (char === '\\' && ESCAPABLE.test(text[i + 1] ?? '')) {
      buffer += text[i + 1]
      i += 2
      continue
    }

    if (char === '\n') {
      flush()
      nodes.push({ type: 'break' })
      i++
      continue
    }

    if (char === '`') {
      const end = text.indexOf('`', i + 1)
      if (end > i + 1) {
        flush()
        nodes.push({ type: 'code', value: text.slice(i + 1, end) })
        i = end + 1
        continue
      }
    }

    if (char === '<') {
      const autolink = rest.match(/^<(https?:\/\/[^\s>]+)>/i)
      if (autolink) {
        flush()
        nodes.push({ type: 'link', href: autolink[1], children: [{ type: 'text', value: autolink[1] }] })
        i += autolink[0].length
        continue
      }
    }

    if (char === '*' || char === '_') {
      const double = text[i + 1] === char
      const delimiter = double ? char + char : char
      const start = i + delimiter.length
      const opensWord = !/\s/.test(text[start] ?? ' ')
      const midWord = char === '_' && /\w/.test(text[i - 1] ?? '')
      if (opensWord && !midWord) {
        const end = closingDelimiter(text, start, delimiter)
        if (end > start) {
          flush()
          const children = parseInline(text.slice(start, end), references)
          nodes.push(double ? { type: 'strong', children } : { type: 'em', children })
          i = end + delimiter.length
          continue
        }
      }
    }

    if (char === '[') {
      const close = closingBracket(text, i)
      if (close !== -1) {
        const label = text.slice(i + 1, close)
        const after = text.slice(close + 1)
        let href: string | undefined
        let consumed = 0

        const inline = after.match(/^\(\s*<?([^\s)>]*)>?(?:\s+["'(][^)]*["')])?\s*\)/)
        const reference = after.match(/^\[([^\]]*)\]/)
        if (inline) {
          href = inline[1]
          consumed = inline[0].length
        } else if (reference) {
          href = references.get(referenceKey(reference[1] || label))
          consumed = reference[0].length
        } else {
          href = references.get(referenceKey(label))
        }

        if (href !== undefined) {
          flush()
          const children = parseInline(label, references)
          const safe = safeHref(href)
          // An unsafe or relative target keeps its words and loses the link.
          if (safe) nodes.push({ type: 'link', href: safe, children })
          else nodes.push(...children)
          i = close + 1 + consumed
          continue
        }
      }
    }

    buffer += char
    i++
  }

  flush()
  return nodes
}

function startsBlock(line: string): boolean {
  return HEADING.test(line) || RULE.test(line) || LIST_ITEM.test(line) || QUOTE.test(line)
}

export function parseMarkdown(source: string): MarkdownBlock[] {
  const references: References = new Map()
  const lines: string[] = []
  for (const line of source.replace(/\r\n?/g, '\n').split('\n')) {
    const definition = line.match(REFERENCE_DEFINITION)
    if (definition) references.set(referenceKey(definition[1]), definition[2])
    else lines.push(line)
  }

  const blocks: MarkdownBlock[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    if (!line.trim()) {
      i++
      continue
    }

    const heading = line.match(HEADING)
    if (heading) {
      blocks.push({ type: 'heading', children: parseInline(heading[1], references) })
      i++
      continue
    }

    if (RULE.test(line)) {
      blocks.push({ type: 'rule' })
      i++
      continue
    }

    const firstItem = line.match(LIST_ITEM)
    if (firstItem) {
      const ordered = /\d/.test(firstItem[1])
      const items: string[] = []
      while (i < lines.length) {
        const item = lines[i].match(LIST_ITEM)
        if (item && /\d/.test(item[1]) === ordered) {
          items.push(item[2])
        } else if (lines[i].trim() && /^\s/.test(lines[i]) && items.length > 0) {
          // An indented line continues the item above it.
          items[items.length - 1] += ` ${lines[i].trim()}`
        } else {
          break
        }
        i++
      }
      blocks.push({ type: 'list', ordered, items: items.map((item) => parseInline(item.trim(), references)) })
      continue
    }

    if (QUOTE.test(line)) {
      const quoted: string[] = []
      while (i < lines.length && QUOTE.test(lines[i])) {
        quoted.push(lines[i].match(QUOTE)![1])
        i++
      }
      blocks.push({ type: 'quote', children: parseInline(quoted.join('\n').trim(), references) })
      continue
    }

    const paragraph: string[] = []
    while (i < lines.length && lines[i].trim() && (paragraph.length === 0 || !startsBlock(lines[i]))) {
      paragraph.push(lines[i].trim())
      i++
    }
    blocks.push({ type: 'paragraph', children: parseInline(paragraph.join('\n'), references) })
  }

  return blocks
}

function inlineText(nodes: MarkdownInline[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
        case 'code':
          return node.value
        case 'break':
          return '\n'
        default:
          return inlineText(node.children)
      }
    })
    .join('')
}

// The words without the markup, for where a description is shown as a line of
// plain text (a search result's blurb) or only measured.
export function markdownToPlainText(source: string): string {
  return parseMarkdown(source)
    .map((block) => {
      switch (block.type) {
        case 'rule':
          return ''
        case 'list':
          return block.items.map((item) => `• ${inlineText(item)}`).join('\n')
        default:
          return inlineText(block.children)
      }
    })
    .filter(Boolean)
    .join('\n\n')
}

function renderInline(nodes: MarkdownInline[]): RemixNode[] {
  return nodes.map((node) => {
    switch (node.type) {
      case 'text':
        return node.value
      case 'break':
        return <br />
      case 'code':
        return <code>{node.value}</code>
      case 'strong':
        return <strong>{renderInline(node.children)}</strong>
      case 'em':
        return <em>{renderInline(node.children)}</em>
      case 'link':
        return (
          <Link href={node.href} external>
            {renderInline(node.children)}
          </Link>
        )
    }
  })
}

const markdownStyle = css({
  '& > *': { margin: '0 0 0.75em' },
  '& > *:last-child': { marginBottom: 0 },
  '& ul, & ol': { paddingLeft: '1.4em' },
  '& li + li': { marginTop: '0.2em' },
  '& hr': { border: 0, borderTop: '1px solid var(--rule)' },
  '& blockquote': { paddingLeft: '0.9em', borderLeft: '2px solid var(--rule)', color: 'var(--soft)' },
})

export interface MarkdownProps {
  text: string
  class?: string
}

export function Markdown(handle: Handle<MarkdownProps>) {
  return () => {
    const { text, class: className } = handle.props
    return (
      <div class={className} mix={markdownStyle}>
        {parseMarkdown(text).map((block) => {
          switch (block.type) {
            case 'paragraph':
              return <p>{renderInline(block.children)}</p>
            case 'heading':
              return (
                <p>
                  <strong>{renderInline(block.children)}</strong>
                </p>
              )
            case 'quote':
              return <blockquote>{renderInline(block.children)}</blockquote>
            case 'rule':
              return <hr />
            case 'list': {
              const items = block.items.map((item) => <li>{renderInline(item)}</li>)
              return block.ordered ? <ol>{items}</ol> : <ul>{items}</ul>
            }
          }
        })}
      </div>
    )
  }
}
