import * as http from 'node:http'
import { createRequestListener } from 'remix/node-fetch-server'

import { router } from './app/router.ts'
import { startGenerationWorker } from './app/data/generationWorker.ts'

const port = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 44100

const server = http.createServer(
  createRequestListener(async (request) => {
    try {
      return await router.fetch(request)
    } catch (error) {
      if (!(request.signal.aborted && error === request.signal.reason)) {
        console.error(error)
      }
      return new Response('Internal Server Error', { status: 500 })
    }
  }),
)

server.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`)
})

// Every machine drains the queue. Claiming uses SKIP LOCKED, so running this
// in more than one process is safe — they take different jobs rather than
// racing for the same one.
const generationWorker = startGenerationWorker()

let shuttingDown = false

function shutdown() {
  if (shuttingDown) {
    return
  }

  shuttingDown = true
  // Stops claiming immediately. Anything mid-flight is left for the staleness
  // sweep to requeue — a run outlasts any shutdown grace period, so waiting
  // for one would just delay the exit and lose it anyway.
  generationWorker.stop()
  server.close(() => process.exit(0))
  server.closeAllConnections()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
