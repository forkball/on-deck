import { createAssetServer } from 'remix/assets'

const rootDir = process.cwd()
const nodeEnv = process.env.NODE_ENV ?? 'development'
const isDevelopment = nodeEnv === 'development'

export const assetServer = createAssetServer({
  basePath: '/assets',
  rootDir,
  fileMap: {
    'app/*path': 'app/*path',
    'node_modules/*path': 'node_modules/*path',
  },
  // What the browser may reach. Enforced across the whole transitive import
  // graph, not just the entry: a client entry that imports server code fails the
  // request with IMPORT_NOT_ALLOWED rather than bundling it.
  //
  // `app/ui/shared` is listed because a few primitives are rendered on both
  // sides. It stays deliberately narrow — the rest of app/ui reaches routes,
  // the media-type registry and data modules, none of which belong in a bundle.
  allow: ['app/browser/**', 'app/ui/shared/**', 'node_modules/**'],
  sourceMaps: isDevelopment ? 'external' : undefined,
  minify: !isDevelopment,
  watch: false,
})
