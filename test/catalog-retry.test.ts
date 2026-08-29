import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createProviderCircuit } from '../app/data/catalog/circuit.ts'
import { backoffMs } from '../app/data/catalog/retry.ts'

describe('backoffMs', () => {
  // Flat, not exponential: the sixth attempt has to be as affordable as the
  // first, or six attempts do not fit in a search someone is waiting on.
  it('stays within the same bounds however many attempts have been made', () => {
    for (let i = 0; i < 500; i++) {
      const delay = backoffMs()
      assert.ok(delay >= 125, `delay ${delay} below floor`)
      assert.ok(delay < 250, `delay ${delay} at or above ceiling`)
    }
  })

  it('spreads retries out instead of scheduling them all together', () => {
    const delays = new Set(Array.from({ length: 50 }, () => backoffMs()))
    assert.ok(delays.size > 1, 'every retry got the same delay')
  })
})

const THRESHOLD = 3
const COOLDOWN_MS = 60_000

const failing = () => Promise.reject(new Error('provider is down'))

async function fail(circuit: ReturnType<typeof createProviderCircuit>, times = THRESHOLD): Promise<void> {
  for (let i = 0; i < times; i++) await circuit.run(failing).catch(() => {})
}

describe('createProviderCircuit', () => {
  it('stays closed below the threshold', async () => {
    const circuit = createProviderCircuit('Test Provider', THRESHOLD, COOLDOWN_MS)
    await fail(circuit, THRESHOLD - 1)
    assert.equal(circuit.isOpen(), false)
  })

  it('opens on the threshold failure', async () => {
    const circuit = createProviderCircuit('Test Provider', THRESHOLD, COOLDOWN_MS)
    await fail(circuit)
    assert.equal(circuit.isOpen(), true)
  })

  it('hands the operation its result, and its error, untouched', async () => {
    const circuit = createProviderCircuit('Test Provider', THRESHOLD, COOLDOWN_MS)
    assert.equal(await circuit.run(async () => 'answered'), 'answered')
    await assert.rejects(circuit.run(failing), /provider is down/)
  })

  // A 404 comes back as a returned null, not a throw, so it must not count.
  it('counts only a throw, not a falsy answer', async () => {
    const circuit = createProviderCircuit('Test Provider', THRESHOLD, COOLDOWN_MS)
    for (let i = 0; i < THRESHOLD; i++) await circuit.run(async () => null)
    assert.equal(circuit.isOpen(), false)
  })

  it('a success closes it and clears the count', async () => {
    const circuit = createProviderCircuit('Test Provider', THRESHOLD, COOLDOWN_MS)
    await fail(circuit)
    await circuit.run(async () => 'answered')
    assert.equal(circuit.isOpen(), false)

    await fail(circuit, THRESHOLD - 1)
    assert.equal(circuit.isOpen(), false, 'the earlier failures should not still count')
  })

  it('half-opens once the cooldown is up', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 })
    const circuit = createProviderCircuit('Test Provider', THRESHOLD, COOLDOWN_MS)
    await fail(circuit)

    t.mock.timers.tick(COOLDOWN_MS - 1_000)
    assert.equal(circuit.isOpen(), true, 'still inside the cooldown')

    t.mock.timers.tick(2_000)
    assert.equal(circuit.isOpen(), false, 'cooldown elapsed, let the next caller through')
  })

  it('restarts the cooldown when the caller let through also fails', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 })
    const circuit = createProviderCircuit('Test Provider', THRESHOLD, COOLDOWN_MS)
    await fail(circuit)

    t.mock.timers.tick(COOLDOWN_MS + 1_000)
    assert.equal(circuit.isOpen(), false)

    await fail(circuit, 1)
    assert.equal(circuit.isOpen(), true, 'the probe failed, so it should close again')
  })
})
