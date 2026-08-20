import { deflateRawSync } from 'node:zlib'

export interface ZipFile {
  name: string
  body: string
  store?: boolean
}

// Built in memory rather than checked in, so the bytes under test are visible.
export function buildZip(files: ZipFile[]): Uint8Array {
  const locals: Buffer[] = []
  const directory: Buffer[] = []
  let offset = 0

  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8')
    const uncompressed = Buffer.from(file.body, 'utf8')
    const compressed = file.store ? uncompressed : deflateRawSync(uncompressed)
    const method = file.store ? 0 : 8

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(uncompressed.length, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, compressed)

    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014b50, 0)
    entry.writeUInt16LE(method, 10)
    entry.writeUInt32LE(compressed.length, 20)
    entry.writeUInt32LE(uncompressed.length, 24)
    entry.writeUInt16LE(name.length, 28)
    entry.writeUInt32LE(offset, 42)
    directory.push(entry, name)

    offset += local.length + name.length + compressed.length
  }

  const body = Buffer.concat(locals)
  const central = Buffer.concat(directory)

  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(body.length, 16)

  return new Uint8Array(Buffer.concat([body, central, end]))
}
