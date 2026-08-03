// Fails the build when something that ships to the browser can't actually be
// bundled. tsc can't see any of this: a client entry importing server code is
// valid TypeScript, and the entry path in document.tsx is a bare string. Both
// only break when a browser requests the module, so without this they reach
// production as one dead widget.
//
// Runs the real asset server from app/assets.ts rather than reimplementing the
// allowlist, so the two can't drift apart.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { assetServer } from '../app/assets.ts'

const root = process.cwd()

// Everything reachable from the browser has to compile as a browser module,
// not just the clientEntry roots — a shared file that reaches app/data breaks
// every client entry importing it.
const BUNDLED_DIRS = ['app/browser', 'app/ui/shared']

// Sentinels: server modules that must stay unreachable. These catch an `allow`
// rule widened far enough to serve the database pool or the route table.
const MUST_REFUSE = ['app/data/db.ts', 'app/mediaTypes.ts', 'app/routes.ts']

// Files whose bundled entry URLs are written as plain strings.
const ENTRY_REFERENCES = ['app/ui/components/document.tsx']

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(root, dir))) {
    const rel = `${dir}/${entry}`
    if (statSync(join(root, rel)).isDirectory()) sourceFiles(rel, out)
    else if (/\.tsx?$/.test(entry)) out.push(rel)
  }
  return out
}

async function serve(path: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const response = await assetServer.fetch(new Request(`http://localhost/assets/${path}`))
    if (!response) return { ok: false, detail: 'refused by the allow list' }
    if (response.status !== 200) {
      // The asset server answers a bare "Internal Server Error" and logs the
      // useful part — which import, resolved to what — to stderr itself.
      return { ok: false, detail: 'did not compile; see the error logged above' }
    }
    return { ok: true, detail: '' }
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) }
  }
}

const failures: string[] = []

for (const dir of BUNDLED_DIRS) {
  for (const path of sourceFiles(dir)) {
    const { ok, detail } = await serve(path)
    if (!ok) failures.push(`${path}\n    ${detail.split('\n')[0]}`)
  }
}

for (const path of MUST_REFUSE) {
  const { ok } = await serve(path)
  if (ok) failures.push(`${path}\n    served to the browser, but it is server-only — check the allow list`)
}

// The <script src> in document.tsx names its entry as a string, so a rename
// that moves the file leaves the compiler perfectly happy and the page blank.
for (const file of ENTRY_REFERENCES) {
  const source = readFileSync(join(root, file), 'utf8')
  for (const [, path] of source.matchAll(/routes\.assets\.href\(\{\s*path:\s*['"]([^'"]+)['"]/g)) {
    if (!existsSync(join(root, path))) {
      failures.push(`${file}\n    references '${path}', which does not exist`)
    }
  }
}

if (failures.length > 0) {
  console.error(`\nBrowser bundle check failed (${failures.length}):\n`)
  for (const failure of failures) console.error(`  ${failure}\n`)
  process.exit(1)
}

const checked = BUNDLED_DIRS.reduce((n, dir) => n + sourceFiles(dir).length, 0)
console.log(`browser bundle ok — ${checked} modules compile, ${MUST_REFUSE.length} server modules refused`)
