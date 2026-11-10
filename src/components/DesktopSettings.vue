<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { shortcutFromKey, shortcutLabel } from '../shortcuts'

const props = withDefaults(defineProps<{ section?: 'shortcuts' | 'general' | null; shortcutsPaused?: boolean }>(), { section: 'shortcuts' })
const emit = defineEmits<{ shortcuts: [value: { captureShortcut: string; pinShortcut: string }] }>()
type ShortcutField = 'captureShortcut' | 'pinShortcut'
type Check = { status: 'available' | 'current' | 'unavailable' | 'invalid'; message: string }
type Checks = { capture: Check; pin: Check }
const fields = [
  { key: 'captureShortcut' as const, name: '开始截图', result: 'capture' as const },
  { key: 'pinShortcut' as const, name: '贴最近原图', result: 'pin' as const },
]
const desktop = isTauri(), isMac = navigator.platform.includes('Mac')
const busy = ref(false), checking = ref(false), loading = ref(desktop), message = ref(''), failed = ref(false)
const loaded = ref(!desktop)
const checks = ref<Checks>(), recording = ref<ShortcutField | null>(null), recorderBusy = ref(false), recorderReady = ref(false)
const blocked = computed(() => !desktop || !loaded.value || busy.value || loading.value || recorderBusy.value)
const detection = ref<{ platform: string; captureAvailable: boolean; elementDetection?: boolean; error?: string }>()
const settings = ref({ captureShortcut: 'CommandOrControl+Shift+2', pinShortcut: 'CommandOrControl+Alt+3', startInTray: false, autostart: false, pinHalo: true })
let unlisten: UnlistenFn[] = [], mounted = true, haloRevision = 0, checkRevision = 0, recordRevision = 0
let recorderQueue: Promise<unknown> = Promise.resolve()

function applySettings(loaded: typeof settings.value, revision: number, replaceDraft = true) {
  if (replaceDraft) settings.value = { ...loaded, pinHalo: revision === haloRevision ? loaded.pinHalo : settings.value.pinHalo }
  emit('shortcuts', { captureShortcut: loaded.captureShortcut, pinShortcut: loaded.pinShortcut })
}
async function refresh(replaceDraft = true) {
  const revision = haloRevision
  applySettings(await invoke('get_desktop_settings'), revision, replaceDraft)
  detection.value = await invoke('get_app_status')
}
async function checkShortcuts() {
  if (blocked.value || checking.value || recording.value) return
  const revision = ++checkRevision
  const requested = { captureShortcut: settings.value.captureShortcut, pinShortcut: settings.value.pinShortcut }
  checking.value = true; checks.value = undefined; message.value = ''; failed.value = false
  try {
    const result = await invoke<Checks>('check_desktop_shortcuts', requested)
    if (mounted && revision === checkRevision) checks.value = result
  } catch (e) {
    if (mounted && revision === checkRevision) { message.value = String(e); failed.value = true }
  } finally { checking.value = false }
}
async function save() {
  if (blocked.value || checking.value || recording.value) return
  busy.value = true; message.value = ''; failed.value = false
  const revision = haloRevision
  try {
    applySettings(await invoke('set_desktop_settings', { settings: { ...settings.value } }), revision)
    checks.value = undefined; message.value = '桌面设置已保存。'
  } catch (e) {
    message.value = String(e); failed.value = true
    try { await refresh(false) } catch (refreshError) { message.value += `；读取当前设置失败：${String(refreshError)}` }
  } finally { busy.value = false }
}
function fillShortcuts(snipaste: boolean) {
  settings.value.captureShortcut = snipaste ? 'F1' : 'CommandOrControl+Shift+2'
  settings.value.pinShortcut = snipaste ? 'F3' : 'CommandOrControl+Alt+3'
  failed.value = false; message.value = '已填入快捷键，点击“保存桌面设置”后生效。'
}
function setRecorder(enabled: boolean) {
  const request = recorderQueue.catch(() => {}).then(() => invoke('set_shortcut_recording', { enabled }))
  recorderQueue = request
  return request
}
async function stopRecording() {
  if (!recording.value && !recorderBusy.value) return
  const revision = ++recordRevision
  recording.value = null; recorderReady.value = false; recorderBusy.value = true
  try { await setRecorder(false) }
  catch (e) { if (mounted) { failed.value = true; message.value = `结束快捷键录入失败：${String(e)}` } }
  finally { if (revision === recordRevision) recorderBusy.value = false }
}
async function startRecording(field: ShortcutField) {
  if (blocked.value || checking.value || recording.value) return
  const revision = ++recordRevision
  recording.value = field; recorderBusy.value = true; recorderReady.value = false; message.value = ''; failed.value = false
  try {
    await setRecorder(true)
    if (!mounted || revision !== recordRevision) return
    recorderBusy.value = false; recorderReady.value = true
    await nextTick(); document.getElementById(`shortcut-${field}`)?.focus()
  } catch (e) {
    if (revision === recordRevision) { recording.value = null; recorderBusy.value = false; failed.value = true; message.value = String(e) }
  }
}
async function acceptRecorded(value: string) {
  const field = recording.value
  if (!field || !recorderReady.value) return
  settings.value[field] = value
  await stopRecording(); await nextTick()
  if (mounted && props.section === 'shortcuts') await checkShortcuts()
}
function recordKey(event: KeyboardEvent, field: ShortcutField) {
  if (recording.value !== field) return
  event.stopPropagation()
  if (event.key === 'Tab' || event.key === 'Escape') {
    if (event.key === 'Escape') event.preventDefault()
    void stopRecording(); return
  }
  event.preventDefault()
  if (!recorderReady.value) return
  try { const value = shortcutFromKey(event); if (value) void acceptRecorded(value) }
  catch (e) { failed.value = true; message.value = String(e) }
}
function blurRecorder() { void stopRecording() }
async function permissions() {
  message.value = ''; failed.value = false
  try {
    detection.value = await invoke('get_app_status')
    message.value = detection.value?.captureAvailable ? '截图权限已可用。' : detection.value?.error || '请在系统设置中允许星镜录屏。'
    failed.value = !detection.value?.captureAvailable
  } catch (e) { failed.value = true; message.value = String(e) }
}
watch(() => [settings.value.captureShortcut, settings.value.pinShortcut], () => { checkRevision++; checks.value = undefined })
watch(() => props.section, () => { void stopRecording(); if (loaded.value) { message.value = ''; failed.value = false } })
async function loadSettings() {
  if (!desktop) return
  loading.value = true
  unlisten.forEach(off => off()); unlisten = []
  try {
    for (const [name, handler] of [
      ['pin-halo', (payload: unknown) => { if (typeof payload === 'boolean') { haloRevision++; settings.value.pinHalo = payload } }],
      ['shortcut-recorded', (payload: unknown) => { if (typeof payload === 'string') void acceptRecorded(payload) }],
    ] as const) {
      const off = await listen(name, event => handler(event.payload))
      if (!mounted) { off(); return }
      unlisten.push(off)
    }
    await refresh()
    loaded.value = true; message.value = ''; failed.value = false
  } catch (e) { message.value = `读取桌面设置失败：${String(e)}`; failed.value = true }
  finally { loading.value = false }
}
onMounted(() => {
  window.addEventListener('blur', blurRecorder)
  void loadSettings()
})
onBeforeUnmount(() => {
  mounted = false; checkRevision++; void stopRecording()
  unlisten.forEach(off => off()); window.removeEventListener('blur', blurRecorder)
})
</script>

<template>
  <section v-show="section" :id="`settings-panel-${section}`" role="tabpanel" :aria-labelledby="`settings-tab-${section}`" tabindex="0" class="desktop-settings">
    <fieldset :disabled="blocked">
      <div v-show="section === 'shortcuts'">
        <section class="settings-section">
          <h3>全局快捷键</h3>
          <p v-if="shortcutsPaused" class="field-note" role="status">全局快捷键已暂停，组合键已释放。可从托盘菜单恢复；保存设置会保留暂停状态。</p>
          <p class="field-note">点击“录入”后按组合键，也可以直接编辑。修改后点击保存生效。</p>
          <div v-for="field in fields" :key="field.key" class="shortcut-field">
            <label :for="`shortcut-${field.key}`">{{ field.name }} <kbd>{{ shortcutLabel(settings[field.key], isMac) }}</kbd></label>
            <div class="shortcut-entry">
              <input :id="`shortcut-${field.key}`" v-model="settings[field.key]" :aria-label="`${field.name === '开始截图' ? '开始截图' : '贴图'}快捷键`" :aria-describedby="`shortcut-status-${field.key}`" :readonly="recording === field.key" :class="{ recording: recording === field.key }" maxlength="100" :spellcheck="false" @keydown="recordKey($event, field.key)" @blur="recording === field.key && blurRecorder()">
              <button class="button" :disabled="checking || !!recording" :aria-label="`录入${field.name}快捷键`" @click="startRecording(field.key)">录入</button>
            </div>
            <p :id="`shortcut-status-${field.key}`" class="field-note shortcut-result" :class="checks?.[field.result].status" role="status">{{ recording === field.key ? '请按组合键；Esc 取消，Tab 离开。' : checks?.[field.result].message || '尚未检测' }}</p>
          </div>
          <div class="shortcut-actions">
            <button class="button" :disabled="checking || !!recording" @click="checkShortcuts">{{ checking ? '正在检测…' : '检测快捷键占用' }}</button>
            <button class="button" :disabled="checking || !!recording" @click="fillShortcuts(true)">填入 Snipaste 快捷键</button>
            <button class="button" :disabled="checking || !!recording" @click="fillShortcuts(false)">恢复默认快捷键</button>
          </div>
          <p class="field-note">Snipaste 预设：F1 截图、F3 贴图。部分键盘需要同时按 Fn。</p>
          <p class="field-note">检测确认当前能否注册，保存时会再次确认；部分系统快捷键无法提前识别。</p>
          <p class="field-note">CommandOrControl 在 Mac 上表示 ⌘，在 Windows 上表示 Ctrl。例如：CommandOrControl+Shift+2。</p>
        </section>
        <slot name="shortcuts" />
      </div>
      <div v-show="section === 'general'">
        <section class="settings-section">
          <h3>贴图与启动</h3>
          <label class="setting-check"><input v-model="settings.pinHalo" type="checkbox">显示贴图焦点光圈</label>
          <p class="field-note">活跃贴图为蓝色，非活跃贴图为灰色；不影响复制或保存的图片。</p>
          <label class="setting-check"><input v-model="settings.autostart" type="checkbox">开机启动</label>
          <label class="setting-check"><input v-model="settings.startInTray" type="checkbox">启动时收起到菜单栏或托盘</label>
        </section>
        <section class="settings-section">
          <h3>截图权限</h3>
          <button class="button" @click="permissions">重新检查截图权限</button>
          <p v-if="detection?.platform === 'macos'" class="field-note">{{ detection.elementDetection ? '精准控件预选已可用。' : '如需精准控件预选，请在系统设置中允许星镜使用辅助功能。' }}</p>
        </section>
      </div>
      <div class="desktop-settings-save">
        <button class="button primary" :disabled="checking || !!recording" @click="save">{{ busy ? '正在保存…' : '保存桌面设置' }}</button>
        <span class="field-note">保存快捷键、贴图与启动设置。</span>
      </div>
    </fieldset>
    <div v-show="section === 'general'"><slot name="general" /></div>
    <button v-if="desktop && !loaded && !loading" class="button" @click="loadSettings">重新读取设置</button>
    <p v-if="!desktop" class="field-note">全局快捷键与系统权限需要桌面版。</p>
    <p v-if="message" :role="failed ? 'alert' : 'status'" class="field-note desktop-settings-message" :class="{ failure: failed }">{{ message }}</p>
  </section>
</template>

<style scoped>
.shortcut-field{margin:20px 0}.shortcut-field>label{display:flex;justify-content:space-between;gap:12px;font-size:12px;margin-bottom:8px}.shortcut-field kbd{font-size:11px;color:var(--muted)}.shortcut-entry{display:flex;gap:8px}.shortcut-entry input{flex:1;min-width:0;border:1px solid var(--line);border-radius:7px;padding:9px 10px;background:var(--input);color:var(--text);font-size:12px}.shortcut-entry input.recording{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-soft)}.shortcut-result{min-height:18px;margin-top:6px}.shortcut-result.available,.shortcut-result.current{color:var(--accent)}.shortcut-result.unavailable,.shortcut-result.invalid,.failure{color:var(--danger,#e77c88)}.shortcut-actions{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px}.shortcut-actions button{padding:8px 11px}.desktop-settings-save{position:sticky;bottom:-1px;z-index:2;background:var(--panel);border-top:1px solid var(--line);display:flex;align-items:center;flex-wrap:wrap;gap:12px;padding:18px 0 8px}.desktop-settings-message{margin:10px 0;overflow-wrap:anywhere}.setting-check{display:flex;align-items:center;gap:8px;font-size:13px;margin:14px 0}
</style>
