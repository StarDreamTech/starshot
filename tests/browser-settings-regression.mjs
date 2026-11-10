// Vite + an existing authorized Ego TaskSpace/Page. This file never creates a space.
// ego-browser nodejs -e 'globalThis.starshotRegressionConfig={spaceId:SPACE_ID,page:"PAGE_LABEL"}; await import("file:///ABSOLUTE_REPO/tests/browser-settings-regression.mjs")'
// Real Vue UI with every native command mocked. Keyboard recording uses synthetic DOM
// events and mocked native events: no real global shortcuts, desktop capture or clipboard.
const fs = await import('node:fs/promises');
const { fileURLToPath } = await import('node:url');
const { join } = await import('node:path');
const assert = (await import('node:assert/strict')).default;
const config = globalThis.starshotRegressionConfig;
if (!Number.isInteger(config?.spaceId) || config.spaceId <= 0 || typeof config.page !== 'string' || !config.page.trim()) throw Error('Pass an existing authorized {spaceId,page}.');
const root = fileURLToPath(new URL('../', import.meta.url));
const artifacts = join(root, 'artifacts', 'settings-regression');
await fs.mkdir(artifacts, { recursive: true });
const version = JSON.parse(await fs.readFile(join(root, 'package.json'), 'utf8')).version;
const page = (await taskSpace(config.spaceId)).page(config.page), results = [];
const source = '(' + function (version) {
  window.isTauri = true;
  const callbacks = new Map(), listeners = new Map(); let id = 0;
  const clone = value => JSON.parse(JSON.stringify(value));
  const mock = window._settingsMock = {
    calls: [], unexpected: [], state: null, menuRequest: 'help', recording: false, failSave: false, holdCheck: false, nextChecks: null,
    settings: { captureShortcut: 'CommandOrControl+Shift+7', pinShortcut: 'CommandOrControl+Alt+8', startInTray: false, autostart: false, pinHalo: true },
  };
  mock.emit = (event, payload) => {
    for (const [eventId, listener] of listeners) if (listener.event === event) callbacks.get(listener.handler)({ event, id: eventId, payload });
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener(_event, id) { listeners.delete(id); } };
  window.__TAURI_INTERNALS__ = {
    transformCallback(callback) { callbacks.set(++id, callback); return id; },
    async invoke(command, args = {}) {
      mock.calls.push({ command, args: clone(args) });
      if (command === 'plugin:event|listen') { listeners.set(++id, args); return id; }
      if (command === 'plugin:event|unlisten') { listeners.delete(args.eventId); return; }
      if (command === 'get_current_image' || command === 'take_pending_pin_edit') return null;
      if (command === 'take_menu_request') { const request = mock.menuRequest || null; mock.menuRequest = null; return request; }
      if (command === 'check_starshot_update') return { revision: 1, currentVersion: version, configured: true, phase: 'up-to-date', downloadReady: false, confirmationPending: false, downloaded: 0 };
      if (command === 'get_app_status') return { platform: 'macos', captureAvailable: true, elementDetection: true };
      if (command === 'get_desktop_settings') return clone(mock.settings);
      if (command === 'set_desktop_settings') {
        if (mock.failSave) { mock.failSave = false; if (mock.failureActual) mock.settings = clone(mock.failureActual); throw Error('原创测试：保存失败，原生绑定已回退'); }
        mock.settings = clone(args.settings); return clone(mock.settings);
      }
      if (command === 'check_desktop_shortcuts') {
        const result = clone(mock.nextChecks || { capture: { status: 'available', message: '开始截图快捷键当前可用' }, pin: { status: 'available', message: '贴图快捷键当前可用' } });
        mock.nextChecks = null;
        if (mock.holdCheck) { mock.holdCheck = false; return new Promise(resolve => { mock.finishCheck = () => { delete mock.finishCheck; resolve(result); }; }); }
        return result;
      }
      if (command === 'set_shortcut_recording') { mock.recording = args.enabled; return; }
      if (command === 'set_editor_state') { mock.state = clone(args); return; }
      if (command === 'get_update_status') return { revision: 0, currentVersion: version, configured: true, phase: 'idle', downloadReady: false, confirmationPending: false, downloaded: 0 };
      if (command === 'list_recovery_points') return [];
      if (command === 'get_recovery_storage') return { recoveryBytes: 0, applicationBytes: 0, totalBytes: 0 };
      mock.unexpected.push(command); throw Error('Unexpected native operation: ' + command);
    },
  };
} + ')(' + JSON.stringify(version) + ')';
const preload = await page.cdp('Page.addScriptToEvaluateOnNewDocument', { source });
const wait = condition => page.waitForFunction(condition, undefined, { timeout: 15_000 });
const click = selector => page.evaluate(selector => {
  const button = document.querySelector(selector);
  if (!button || !button.getClientRects().length || button.matches(':disabled')) throw Error('Unavailable control: ' + selector);
  button.focus(); button.click();
}, selector);
const clickText = text => page.evaluate(text => {
  const buttons = [...document.querySelectorAll('button')].filter(button => button.textContent.trim() === text && button.getClientRects().length);
  if (buttons.length !== 1 || buttons[0].matches(':disabled')) throw Error('Ambiguous/unavailable button: ' + text);
  buttons[0].focus(); buttons[0].click();
}, text);
const input = (field, value) => page.evaluate(({ field, value }) => {
  const element = document.getElementById(`shortcut-${field}`);
  if (!element || element.matches(':disabled') || element.readOnly) throw Error('Unavailable input: ' + field);
  element.value = value; element.dispatchEvent(new Event('input', { bubbles: true }));
}, { field, value });
const key = (selector, options) => page.evaluate(({ selector, options }) => {
  const target = document.querySelector(selector); if (!target) throw Error('Missing key target: ' + selector);
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...options });
  target.dispatchEvent(event); return event.defaultPrevented;
}, { selector, options });
const tab = name => click(`#settings-tab-${name}`);
const read = () => page.evaluate(() => ({
  mac: navigator.platform.includes('Mac'), header: document.querySelector('.header-actions kbd')?.textContent.trim(),
  capture: document.getElementById('shortcut-captureShortcut').value, pin: document.getElementById('shortcut-pinShortcut').value,
  captureStatus: document.getElementById('shortcut-status-captureShortcut').textContent.trim(), pinStatus: document.getElementById('shortcut-status-pinShortcut').textContent.trim(),
  message: document.querySelector('.desktop-settings-message')?.textContent.trim() || '',
  tab: document.querySelector('.settings-tabs [role="tab"][aria-selected="true"]')?.id, modal: !!document.querySelector('.modal-backdrop')?.getClientRects().length,
}));
const assertActual = async (capture, pin) => {
  const actual = await read();
  const expected = await page.evaluate(async ({ capture, pin, mac }) => {
    const { shortcutLabel } = await import('/src/shortcuts.ts'); return [shortcutLabel(capture, mac), shortcutLabel(pin, mac)];
  }, { capture, pin, mac: actual.mac });
  assert.equal(actual.header, expected[0]);
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.shortcut-list>div')].slice(0, 2).map(row => row.querySelector('kbd').textContent.trim())), expected);
};
const setCheck = (capture, pin, hold = false) => page.evaluate(({ capture, pin, hold }) => {
  window._settingsMock.nextChecks = { capture, pin }; window._settingsMock.holdCheck = hold;
}, { capture, pin, hold });
const check = async (capture, pin) => {
  await setCheck(capture, pin); await clickText('检测快捷键占用');
  await page.waitForFunction(({ capture, pin }) => document.getElementById('shortcut-status-captureShortcut').textContent.trim() === capture.message && document.getElementById('shortcut-status-pinShortcut').textContent.trim() === pin.message, { capture, pin }, { timeout: 15_000 });
};
const startRecord = async (field = 'captureShortcut') => {
  await click(`.shortcut-field:has(#shortcut-${field}) button`);
  await page.waitForFunction(field => window._settingsMock.recording && document.getElementById(`shortcut-${field}`).readOnly && document.activeElement.id === `shortcut-${field}`, field, { timeout: 15_000 });
};
const waitStopped = () => wait(() => !window._settingsMock.recording && !document.getElementById('shortcut-captureShortcut').readOnly && !document.getElementById('shortcut-pinShortcut').readOnly && !document.getElementById('shortcut-captureShortcut').matches(':disabled'));

try {
  await page.goto('http://127.0.0.1:1430');
  await wait(() => window._settingsMock?.state && document.getElementById('shortcut-captureShortcut')?.value === 'CommandOrControl+Shift+7');
  await wait(() => document.getElementById('capture-help')?.open && document.getElementById('settings-tab-about')?.getAttribute('aria-selected') === 'true');
  await page.evaluate(() => { document.getElementById('capture-help').open = false; window._settingsMock.menuRequest = 'help'; window._settingsMock.emit('menu-requested'); });
  await wait(() => document.getElementById('capture-help')?.open);
  await click('button[aria-label="关闭弹窗"]');
  await page.evaluate(() => { window._settingsMock.menuRequest = 'settings'; window._settingsMock.emit('menu-requested'); });
  await wait(() => document.getElementById('settings-tab-shortcuts')?.getAttribute('aria-selected') === 'true' && !!document.querySelector('.modal-backdrop')?.getClientRects().length);
  await page.evaluate(() => window._settingsMock.emit('shortcuts-paused', true));
  await wait(() => document.querySelector('.desktop-settings').textContent.includes('全局快捷键已暂停'));
  await page.evaluate(() => window._settingsMock.emit('shortcuts-paused', false));
  await wait(() => !document.querySelector('.desktop-settings').textContent.includes('全局快捷键已暂停'));
  assert.equal((await read()).capture, 'CommandOrControl+Shift+7');
  for (const expected of [1, 2]) {
    await page.evaluate(() => { window._settingsMock.menuRequest = 'updates'; window._settingsMock.emit('menu-requested'); });
    await page.waitForFunction(expected => window._settingsMock.calls.filter(call => call.command === 'check_starshot_update').length === expected && document.getElementById('settings-tab-updates')?.getAttribute('aria-selected') === 'true', expected, { timeout: 15000 });
    await click('button[aria-label="关闭弹窗"]');
    await click('button[aria-label="设置与帮助"]'); await tab('updates');
    await wait(() => !document.querySelector('.update-settings')?.getAttribute('aria-busy') || document.querySelector('.update-settings')?.getAttribute('aria-busy') === 'false');
    assert.equal(await page.evaluate(() => window._settingsMock.calls.filter(call => call.command === 'check_starshot_update').length), expected);
  }
  await page.evaluate(() => { window._settingsMock.menuRequest = 'about'; window._settingsMock.emit('menu-requested'); });
  await wait(() => document.getElementById('settings-tab-about')?.getAttribute('aria-selected') === 'true' && !document.getElementById('capture-help')?.open);
  assert.deepEqual(await page.evaluate(() => window._settingsMock.unexpected), []);
  results.push({ name: 'cold-start tray help request and live settings/about routes arrive; pause status preserves drafts; update request checks once without replay on reopen', pass: true });
  await click('button[aria-label="关闭弹窗"]');
  await click('button[aria-label="设置与帮助"]');
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.settings-tabs [role="tab"]')].map(el => el.textContent.trim())), ['外观', '快捷键', '通用', '更新与恢复', '关于']);
  for (const name of ['appearance', 'shortcuts', 'general', 'updates', 'about']) {
    await tab(name);
    assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('.settings-content [role="tabpanel"]')].filter(el => el.getClientRects().length).map(el => el.id)), [`settings-panel-${name}`]);
  }
  await tab('shortcuts'); await page.evaluate(() => document.getElementById('settings-tab-shortcuts').focus());
  for (const [pressed, selected] of [['ArrowRight', 'general'], ['End', 'about'], ['Home', 'appearance'], ['ArrowLeft', 'about']]) {
    await key('.settings-tabs [role="tab"][aria-selected="true"]', { key: pressed });
    await page.waitForFunction(selected => document.activeElement.id === `settings-tab-${selected}` && document.activeElement.getAttribute('aria-selected') === 'true', selected, { timeout: 15_000 });
  }
  const height = await page.evaluate(() => document.querySelector('.settings-dialog').getBoundingClientRect().height);
  await tab('shortcuts'); assert.equal(await page.evaluate(() => document.querySelector('.settings-dialog').getBoundingClientRect().height), height);
  results.push({ name: 'five settings tabs show one category, keep stable height and support roving arrow/Home/End focus', pass: true });

  await tab('appearance');
  await page.evaluate(() => { const checkbox = document.querySelector('#settings-panel-appearance input[type="checkbox"]'); if (!checkbox.checked) checkbox.click(); });
  await click('button[aria-label="关闭弹窗"]'); await click('button[aria-label="快速切换主题"]');
  assert.equal(await page.evaluate(() => document.querySelectorAll('#quick-theme-picker .theme-choice').length), 5);
  await click('#quick-theme-picker .theme-choice:nth-of-type(2)');
  await wait(() => document.documentElement.dataset.theme === 'moon' && document.querySelector('#quick-theme-picker .theme-choice[aria-pressed="true"]')?.textContent.trim() === '月白');
  assert.equal(await page.evaluate(() => localStorage.getItem('starshot-theme')), 'moon');
  await key('#quick-theme-picker .theme-choice[aria-pressed="true"]', { key: 'Escape' });
  assert.equal(await page.evaluate(() => !document.querySelector('#quick-theme-picker') && document.activeElement.getAttribute('aria-label') === '快速切换主题'), true);
  await click('button[aria-label="快速切换主题"]'); await click('#quick-theme-picker .theme-more');
  assert.equal((await read()).tab, 'settings-tab-appearance');
  assert.equal(await page.evaluate(() => document.querySelector('#settings-panel-appearance input[type="checkbox"]').checked), false);
  await click('button[aria-label="关闭弹窗"]'); await click('button[aria-label="快速切换主题"]');
  await page.evaluate(() => document.querySelector('.welcome h1').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
  assert.equal(await page.evaluate(() => !!document.querySelector('#quick-theme-picker')), false);
  results.push({ name: 'separate theme picker exposes five presets, persists choice, disables custom palette and supports Escape/outside/more-appearance', pass: true });

  await click('button[aria-label="设置与帮助"]'); await assertActual('CommandOrControl+Shift+7', 'CommandOrControl+Alt+8');
  await input('captureShortcut', 'Control+Shift+9'); await input('pinShortcut', 'Alt+9');
  const available = { status: 'available', message: '测试：当前可注册' }, current = { status: 'current', message: '测试：当前绑定' };
  await check(available, current);
  assert.deepEqual(await page.evaluate(() => window._settingsMock.calls.filter(call => call.command === 'check_desktop_shortcuts').at(-1).args), { captureShortcut: 'Control+Shift+9', pinShortcut: 'Alt+9' });
  const unavailable = { status: 'unavailable', message: '测试：已被占用' }, duplicate = { status: 'invalid', message: '测试：两项快捷键不能重复' }, invalid = { status: 'invalid', message: '测试：快捷键格式无效' };
  await check(unavailable, available);
  await input('pinShortcut', 'Control+Shift+9'); await check(duplicate, duplicate);
  await input('captureShortcut', 'not-a-shortcut'); await check(invalid, available);
  await input('captureShortcut', 'Control+Shift+1'); await input('pinShortcut', 'Alt+2');
  await setCheck(unavailable, unavailable, true); await clickText('检测快捷键占用'); await wait(() => typeof window._settingsMock.finishCheck === 'function');
  await input('captureShortcut', 'Control+Shift+3'); await page.evaluate(() => window._settingsMock.finishCheck());
  await wait(() => [...document.querySelectorAll('button')].some(el => el.textContent.trim() === '检测快捷键占用' && !el.matches(':disabled')));
  assert.equal((await read()).captureStatus, '尚未检测'); assert.equal((await read()).pinStatus, '尚未检测');
  results.push({ name: 'native check responses render available/current/conflict/duplicate/format feedback and late results cannot mark an edited draft', pass: true });

  await input('captureShortcut', 'Super+KeyQ'); await input('pinShortcut', 'Control+Digit9');
  await tab('general'); await tab('shortcuts'); assert.equal((await read()).capture, 'Super+KeyQ');
  await clickText('保存桌面设置'); await wait(() => document.querySelector('.desktop-settings-message')?.textContent.includes('已保存'));
  await assertActual('Super+KeyQ', 'Control+Digit9');
  await input('captureShortcut', 'Alt+6'); await input('pinShortcut', 'Alt+7');
  await page.evaluate(() => { const m = window._settingsMock; m.failSave = true; m.failureActual = { ...m.settings, captureShortcut: 'Control+5', pinShortcut: 'Alt+4' }; });
  await clickText('保存桌面设置'); await wait(() => document.querySelector('.desktop-settings-message')?.textContent.includes('保存失败'));
  const failed = await read(); assert.equal(failed.capture, 'Alt+6'); assert.equal(failed.pin, 'Alt+7'); await assertActual('Control+5', 'Alt+4');
  results.push({ name: 'tab switches preserve drafts; successful saves update formatted header/help; failures preserve draft while displaying real fallback bindings', pass: true });

  await startRecord();
  assert.equal(await key('#shortcut-captureShortcut', { key: 'Shift', code: 'ShiftLeft', shiftKey: true }), true);
  assert.equal(await page.evaluate(() => window._settingsMock.recording), true);
  await key('#shortcut-captureShortcut', { key: 'q', code: 'KeyQ', metaKey: true }); await waitStopped();
  assert.equal((await read()).capture, 'Super+Q'); assert.equal((await read()).modal, true);
  await wait(() => document.getElementById('shortcut-status-captureShortcut').textContent.includes('当前可用'));
  await startRecord('pinShortcut'); await page.evaluate(() => window._settingsMock.emit('shortcut-recorded', 'CommandOrControl+Shift+7')); await waitStopped();
  assert.equal((await read()).pin, 'CommandOrControl+Shift+7');
  await wait(() => document.getElementById('shortcut-status-pinShortcut').textContent.includes('当前可用'));
  const beforeEsc = (await read()).capture;
  await startRecord(); await key('#shortcut-captureShortcut', { key: 'Escape', code: 'Escape' }); await waitStopped();
  assert.equal((await read()).modal, true); assert.equal((await read()).capture, beforeEsc);
  await startRecord(); await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await waitStopped();
  await startRecord(); await page.evaluate(() => document.getElementById('shortcut-captureShortcut').dispatchEvent(new FocusEvent('blur'))); await waitStopped();
  await startRecord(); await tab('general'); await waitStopped(); assert.equal((await read()).tab, 'settings-tab-general');
  await tab('shortcuts'); await startRecord(); await click('button[aria-label="关闭弹窗"]'); await waitStopped(); assert.equal((await read()).modal, false);
  assert.equal(await page.evaluate(() => window._settingsMock.calls.filter(call => call.command === 'set_shortcut_recording').at(-1).args.enabled), false);
  assert.deepEqual(await page.evaluate(() => window._settingsMock.unexpected), []);
  assert.equal(await page.evaluate(() => window._settingsMock.calls.filter(call => ['start_capture', 'pin_image', 'copy_image', 'save_image'].includes(call.command)).length), 0);
  results.push({ name: 'DOM and native shortcut recording is consumed safely; Escape, window blur, input blur, tab switch and modal close release recording', pass: true });
} catch (error) {
  results.push({ name: 'failure', pass: false, message: String(error), stack: error.stack });
  console.log(await page.snapshot()); throw error;
} finally {
  await fs.writeFile(join(artifacts, 'browser-results.json'), JSON.stringify({ version, layer: 'Chromium real Vue settings UI with mocked IPC; no native shortcut registration or desktop verification', results }, null, 2));
  await page.cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: preload.identifier });
}
console.log({ results, artifact: join(artifacts, 'browser-results.json') });
// The parent owns the shared TaskSpace lifecycle.
