import assert from 'node:assert/strict'
import test from 'node:test'
import { openProjectLink, projectLinks } from '../src/project-links.ts'

test('browser links keep native navigation and expose only the project and feedback URLs', async () => {
  assert.deepEqual(projectLinks, {
    repository: 'https://github.com/cpython666/starshot',
    issues: 'https://github.com/cpython666/starshot/issues/new',
  })
  let prevented = false
  await openProjectLink({ preventDefault() { prevented = true } } as MouseEvent, 'repository')
  assert.equal(prevented, false)
})

test('desktop links invoke the allowlisted native command and propagate failures', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const previousTauri = Object.getOwnPropertyDescriptor(globalThis, 'isTauri')
  const calls: unknown[] = []
  let failure = false
  Object.assign(globalThis, {
    isTauri: true,
    window: { __TAURI_INTERNALS__: { invoke: async (...args: unknown[]) => {
      calls.push(args)
      if (failure) throw Error('browser unavailable')
    } } },
  })
  try {
    let prevented = 0
    const event = { preventDefault() { prevented++ } } as MouseEvent
    await openProjectLink(event, 'repository')
    await openProjectLink(event, 'issues')
    assert.equal(prevented, 2)
    assert.deepEqual(calls, [
      ['open_project_link', { target: 'repository' }, undefined],
      ['open_project_link', { target: 'issues' }, undefined],
    ])
    failure = true
    await assert.rejects(openProjectLink(event, 'repository'), /browser unavailable/)
  } finally {
    for (const [key, descriptor] of [['window', previousWindow], ['isTauri', previousTauri]] as const) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
})
