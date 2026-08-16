import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto'

// Enforced wherever a password is chosen — signup and profile editing — so
// the rule can't hold on one path and not the other. Only new passwords are
// measured: an existing one is checked against its hash, whatever length it
// was set under.
export const PASSWORD_MIN_LENGTH = 8

interface ScryptParams {
  N: number
  r: number
  p: number
}

// What every hash written before the encoded format was stored under: Node's
// own scrypt defaults, which is what `scrypt(password, salt, 64)` used.
//
// This constant is the only record that those hashes exist. Changing it doesn't
// re-tune anything — it silently locks out every user who hasn't logged in since
// the format changed.
const LEGACY_PARAMS: ScryptParams = { N: 16384, r: 8, p: 1 }

// N is the cost. Doubling it doubles both the time and the memory a single
// guess costs an attacker, which is the whole point of scrypt over a plain hash.
//
// 65536 rather than the 2^17 general guidance because memory is 128 * N * r —
// 64 MiB here, 128 MiB at 2^17 — and these run on 512 MB machines alongside a
// generation worker that holds a user's whole log. Four simultaneous logins at
// 2^17 would be the entire machine.
const CURRENT_PARAMS: ScryptParams = { N: 65536, r: 8, p: 1 }

const KEY_LENGTH = 64

// Node's default maxmem is 32 MiB and scrypt throws rather than degrading when
// it isn't enough, so raising N without raising this breaks every login at once.
// Derived so the two can't drift apart.
function maxmemFor({ N, r }: ScryptParams): number {
  return Math.max(32 * 1024 * 1024, 256 * N * r)
}

// Hand-wrapped rather than promisified: promisify's types drop scrypt's
// options overload, and the options are the entire point here.
function derive(password: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  const options: ScryptOptions = { ...params, maxmem: maxmemFor(params) }
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, options, (error, key) => (error ? reject(error) : resolve(key)))
  })
}

// The parameters are inputs to the derivation, not notes about it: change any of
// them and the same password and salt produce unrelated bytes. Storing them in
// code rather than beside the hash is what made the cost impossible to raise
// without invalidating every existing hash.
//
// They are not secret, and nothing here depends on them being secret — see any
// bcrypt or argon2 hash, which publish theirs the same way. What protects a
// password is that computing this is expensive, not that the recipe is hidden.
//
//   scrypt$N=65536,r=8,p=1$<salt-hex>$<key-hex>
//
const PREFIX = 'scrypt'

function encode(params: ScryptParams, salt: Buffer, key: Buffer): string {
  const settings = `N=${params.N},r=${params.r},p=${params.p}`
  return `${PREFIX}$${settings}$${salt.toString('hex')}$${key.toString('hex')}`
}

interface DecodedHash {
  params: ScryptParams
  salt: Buffer
  key: Buffer
  // True for a hash written before the encoded format, whose parameters had to
  // be assumed rather than read.
  legacy: boolean
}

// Null for anything unreadable, so a corrupt column fails the login rather than
// throwing out of it.
function decode(stored: string): DecodedHash | null {
  if (!stored) return null

  if (!stored.startsWith(`${PREFIX}$`)) {
    // No prefix means the old `salt:key` form. There is no marker to check, so
    // the absence of one is the marker.
    const [saltHex, keyHex, ...rest] = stored.split(':')
    if (!saltHex || !keyHex || rest.length > 0) return null
    return { params: LEGACY_PARAMS, salt: Buffer.from(saltHex, 'hex'), key: Buffer.from(keyHex, 'hex'), legacy: true }
  }

  const [, settings, saltHex, keyHex, ...rest] = stored.split('$')
  if (!settings || !saltHex || !keyHex || rest.length > 0) return null

  const parsed: Partial<ScryptParams> = {}
  for (const pair of settings.split(',')) {
    const [name, value] = pair.split('=')
    if (name !== 'N' && name !== 'r' && name !== 'p') return null
    const numeric = Number(value)
    if (!Number.isInteger(numeric) || numeric < 1) return null
    parsed[name] = numeric
  }
  if (parsed.N == null || parsed.r == null || parsed.p == null) return null

  return {
    params: { N: parsed.N, r: parsed.r, p: parsed.p },
    salt: Buffer.from(saltHex, 'hex'),
    key: Buffer.from(keyHex, 'hex'),
    legacy: false,
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await derive(password, salt, CURRENT_PARAMS)
  return encode(CURRENT_PARAMS, salt, key)
}

// Verifies against whatever parameters the stored hash was written under, which
// is what lets the cost be raised without locking anyone out.
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const decoded = decode(stored)
  if (!decoded) return false

  const derived = await derive(password, decoded.salt, decoded.params)

  // Length first: timingSafeEqual throws rather than returning false when the
  // two differ.
  if (derived.length !== decoded.key.length) return false
  return timingSafeEqual(derived, decoded.key)
}

// Whether this hash should be rewritten once the plaintext is in hand — see the
// login action, which is the only place that is true for an existing account.
//
// A comparison rather than a format check, so a hash written at an intermediate
// cost is upgraded too rather than being mistaken for current.
export function needsRehash(stored: string): boolean {
  const decoded = decode(stored)
  if (!decoded) return false

  return (
    decoded.legacy ||
    decoded.params.N < CURRENT_PARAMS.N ||
    decoded.params.r !== CURRENT_PARAMS.r ||
    decoded.params.p !== CURRENT_PARAMS.p
  )
}
