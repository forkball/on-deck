import { inflateRawSync } from 'node:zlib'

const END_OF_DIRECTORY = 0x06054b50
const DIRECTORY_ENTRY = 0x02014b50
const LOCAL_ENTRY = 0x04034b50

const STORED = 0
const DEFLATED = 8

const MAX_COMMENT = 0xffff
const END_RECORD_SIZE = 22
const MAX_ENTRY_BYTES = 64 * 1024 * 1024

interface DirectoryEntry {
  name: string
  method: number
  compressedSize: number
  uncompressedSize: number
  localOffset: number
}

export interface ZipArchive {
  names(): string[]
  // Matches on the last path segment, case-insensitively.
  readText(fileName: string): string | null
}

export function looksLikeZip(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false
  const signature = Buffer.from(bytes.buffer, bytes.byteOffset, 4).readUInt32LE(0)
  return signature === LOCAL_ENTRY || signature === END_OF_DIRECTORY
}

export function openZip(bytes: Uint8Array): ZipArchive {
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const entries = readDirectory(view)

  const byBaseName = new Map<string, DirectoryEntry>()
  for (const entry of entries) {
    const base = baseName(entry.name)
    if (base && !byBaseName.has(base)) byBaseName.set(base, entry)
  }

  return {
    names: () => entries.map((entry) => entry.name),
    readText(fileName) {
      const entry = byBaseName.get(baseName(fileName))
      if (!entry) return null
      return decodeText(readEntry(view, entry))
    },
  }
}

function baseName(path: string): string {
  return (path.split('/').pop() ?? '').toLowerCase()
}

function readDirectory(view: Buffer): DirectoryEntry[] {
  const end = findEndRecord(view)
  if (end === -1) throw new Error('That file is not a zip archive, or it arrived incomplete.')

  const count = view.readUInt16LE(end + 10)
  const directoryOffset = view.readUInt32LE(end + 16)

  if (directoryOffset === 0xffffffff) throw new Error('That zip uses zip64, which this importer cannot read.')

  const entries: DirectoryEntry[] = []
  let cursor = directoryOffset

  for (let i = 0; i < count; i++) {
    if (cursor + 46 > view.length || view.readUInt32LE(cursor) !== DIRECTORY_ENTRY) {
      throw new Error('That zip archive is damaged — its file listing does not read.')
    }

    const method = view.readUInt16LE(cursor + 10)
    const compressedSize = view.readUInt32LE(cursor + 20)
    const uncompressedSize = view.readUInt32LE(cursor + 24)
    const nameLength = view.readUInt16LE(cursor + 28)
    const extraLength = view.readUInt16LE(cursor + 30)
    const commentLength = view.readUInt16LE(cursor + 32)
    const localOffset = view.readUInt32LE(cursor + 42)
    const name = view.toString('utf8', cursor + 46, cursor + 46 + nameLength)

    cursor += 46 + nameLength + extraLength + commentLength

    if (name.endsWith('/') || name.startsWith('__MACOSX/') || baseName(name).startsWith('._')) continue

    // 0xffffffff is the format's "look in the zip64 record for the real value".
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new Error('That zip uses zip64, which this importer cannot read.')
    }

    entries.push({ name, method, compressedSize, uncompressedSize, localOffset })
  }

  return entries
}

function findEndRecord(view: Buffer): number {
  const earliest = Math.max(0, view.length - END_RECORD_SIZE - MAX_COMMENT)

  for (let i = view.length - END_RECORD_SIZE; i >= earliest; i--) {
    if (view.readUInt32LE(i) === END_OF_DIRECTORY) return i
  }

  return -1
}

function readEntry(view: Buffer, entry: DirectoryEntry): Buffer {
  if (entry.uncompressedSize > MAX_ENTRY_BYTES) {
    throw new Error(`${entry.name} is too large to read from that archive.`)
  }

  if (entry.localOffset + 30 > view.length || view.readUInt32LE(entry.localOffset) !== LOCAL_ENTRY) {
    throw new Error(`That zip archive is damaged — ${entry.name} does not read.`)
  }

  // Lengths come from the local header, not the directory: the two carry
  // different extra fields, and the directory's would start the read short.
  const nameLength = view.readUInt16LE(entry.localOffset + 26)
  const extraLength = view.readUInt16LE(entry.localOffset + 28)
  const start = entry.localOffset + 30 + nameLength + extraLength
  const raw = view.subarray(start, start + entry.compressedSize)

  if (entry.method === STORED) return raw
  if (entry.method === DEFLATED) return inflateRawSync(raw, { maxOutputLength: MAX_ENTRY_BYTES })

  throw new Error(`${entry.name} is compressed in a way this importer cannot read.`)
}

function decodeText(data: Buffer): string {
  const text = new TextDecoder('utf-8').decode(data)
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}
