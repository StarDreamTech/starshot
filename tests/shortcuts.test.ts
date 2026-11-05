import assert from 'node:assert/strict'
import test from 'node:test'
import { shortcutFromKey, shortcutLabel } from '../src/shortcuts.ts'

test('shortcut recording preserves physical keys, modifiers and function keys without capturing partial or repeated input', () => {
  const key = { code: 'KeyK', key: 'k', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false, repeat: false, isComposing: false }
  assert.equal(shortcutFromKey(key), 'Control+K')
  assert.equal(shortcutFromKey({ ...key, code: 'Digit2', key: '@', ctrlKey: false, shiftKey: true, metaKey: true }), 'Shift+Super+2')
  assert.equal(shortcutFromKey({ ...key, code: 'KeyA', key: 'å', ctrlKey: false, altKey: true }), 'Alt+A')
  assert.equal(shortcutFromKey({ ...key, code: 'F1', key: 'F1', ctrlKey: false }), 'F1')
  assert.equal(shortcutFromKey({ ...key, code: 'Space', key: ' ' }), 'Control+Space')
  for (const change of [{ repeat: true }, { isComposing: true }, { key: 'Shift' }, { key: 'Dead' }]) assert.equal(shortcutFromKey({ ...key, ...change }), null)
  assert.throws(() => shortcutFromKey({ ...key, ctrlKey: false }), /配合/)
  assert.throws(() => shortcutFromKey({ ...key, code: 'Unknown' }), /暂不支持/)
  assert.equal(shortcutLabel('super+shift+Digit2', true), '⌘ + Shift + 2')
  assert.equal(shortcutLabel('CommandOrControl+Alt+KeyK'), 'Ctrl + Alt + K')
})
