import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { backoffMs, createProviderCircuit } from '../app/data/catalog/requests.ts'

describe('backoffMs', () => {
  it('grows the ceiling exponentially per attempt', () => {
    const ceilings = [400, 800]
    ceilings.forEach((ceiling, index) => {
      const attempt = index + 1
      for (let i = 0; i < 200; i++) {
        const delay = backoffMs(attempt)
        assert.ok(delay >= ceiling / 2, `attempt ${attempt} delay ${delay} below floor`)
        assert.ok(delay < ceiling, `attempt ${attempt} delay ${delay} at or above ceiling`)
      }
    })
  })

  // The point of the jitter: a fan-out that retries in lockstep reproduces the
  // burst that drew the 503s in the first place.
  it('spreads retries out instead of scheduling them all together', () => {
    const delays = new Set(Array.from({ length: 50 }, () => backoffMs(1)))
    assert.ok(delays.size > 1, 'every retry got the same delay')
  })
})

describe('createProviderCircuit', () => {
  it('stays closed below the threshold', () => {
    const circuit = createProviderCircuit(3, 60_000)
    circuit.recordFailure()
    circuit.recordFailure()
    assert.equal(circuit.isOpen(), false)
  })

  it('opens on the threshold failure', () => {
    const circuit = createProviderCircuit(3, 60_000)
    for (let i = 0; i < 3; i++) circuit.recordFailure()
    assert.equal(circuit.isOpen(), true)
  })

  it('a success closes it and clears the count', () => {
    const circuit = createProviderCircuit(3, 60_000)
    for (let i = 0; i < 3; i++) circuit.recordFailure()
    circuit.recordSuccess()
    assert.equal(circuit.isOpen(), false)

    circuit.recordFailure()
    circuit.recordFailure()
    assert.equal(circuit.isOpen(), false, 'the earlier failures should not still count')
  })

  it('half-opens once the cooldown is up', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 })
    const circuit = createProviderCircuit(3, 60_000)
    for (let i = 0; i < 3; i++) circuit.recordFailure()

    t.mock.timers.tick(59_000)
    assert.equal(circuit.isOpen(), true, 'still inside the cooldown')

    t.mock.timers.tick(2_000)
    assert.equal(circuit.isOpen(), false, 'cooldown elapsed, let the next caller through')
  })

  it('restarts the cooldown when the caller let through also fails', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 })
    const circuit = createProviderCircuit(3, 60_000)
    for (let i = 0; i < 3; i++) circuit.recordFailure()

    t.mock.timers.tick(61_000)
    assert.equal(circuit.isOpen(), false)

    circuit.recordFailure()
    assert.equal(circuit.isOpen(), true, 'the probe failed, so it should close again')
  })
})
