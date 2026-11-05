type KeyStroke = Pick<KeyboardEvent, 'code' | 'key' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey' | 'repeat' | 'isComposing'>

export function shortcutFromKey(event: KeyStroke): string | null {
  if (event.repeat || event.isComposing || ['Control', 'Alt', 'Shift', 'Meta', 'Dead', 'Process', 'Unidentified'].includes(event.key)) return null
  const code = event.code
  const functionKey = /^F(?:[1-9]|1\d|2[0-4])$/.test(code)
  const named = ['Space', 'Enter', 'Backspace', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']
  if (!/^Key[A-Z]$|^Digit\d$/.test(code) && !functionKey && !named.includes(code)) throw new Error('这个按键暂不支持录入，可直接编辑组合键。')
  if (!functionKey && !event.ctrlKey && !event.altKey && !event.metaKey) throw new Error('字母、数字或方向键请配合 ⌘、Ctrl 或 Alt 使用。')
  return [event.ctrlKey && 'Control', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Super', code.replace(/^Key|^Digit/, '')].filter(Boolean).join('+')
}

export function shortcutLabel(value: string, isMac = false): string {
  return value.split('+').map(part => {
    const key = part.trim()
    const names: Record<string, string> = { commandorcontrol: isMac ? '⌘' : 'Ctrl', cmdorctrl: isMac ? '⌘' : 'Ctrl', super: isMac ? '⌘' : 'Win', command: '⌘', cmd: '⌘', meta: isMac ? '⌘' : 'Win', control: 'Ctrl', ctrl: 'Ctrl', alt: isMac ? '⌥' : 'Alt', option: '⌥', shift: 'Shift', space: 'Space' }
    return names[key.toLowerCase()] ?? key.replace(/^Key([A-Z])$/, '$1').replace(/^Digit(\d)$/, '$1')
  }).join(' + ')
}
