<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Icon from './Icon.vue'

const props = defineProps<{
  progress?: { width: number; height: number; frames: number; previewDataUrl: string; message: string; viewportWidth?: number; viewportHeight?: number }
  busy: boolean
  automatic: boolean
  error: string
  status: string
}>()
const direction = defineModel<'vertical' | 'horizontal'>('direction', { required: true })
const reverse = defineModel<boolean>('reverse', { required: true })
defineEmits<{ append: []; 'toggle-auto': []; finish: [action: 'copy' | 'save' | 'pin' | 'edit']; cancel: [] }>()
const preview = ref<HTMLElement>()
const previewSize = ref({ width: 300, height: 180 })
let observer: ResizeObserver | undefined
onMounted(() => {
  observer = new ResizeObserver(entries => {
    const bounds = entries[0]?.contentRect
    if (bounds) previewSize.value = { width: bounds.width, height: bounds.height }
  })
  if (preview.value) observer.observe(preview.value)
})
onBeforeUnmount(() => observer?.disconnect())
const sheetStyle = computed(() => {
  if (!props.progress) return {}
  const { width, height } = props.progress
  const scale = Math.min(previewSize.value.width / width, previewSize.value.height / height)
  return { width: `${width * scale}px`, height: `${height * scale}px` }
})
const viewportStyle = computed(() => {
  if (!props.progress) return {}
  const { width, height, viewportWidth = width, viewportHeight = height } = props.progress
  const fraction = Math.min(1, direction.value === 'horizontal' ? viewportWidth / width : viewportHeight / height)
  return direction.value === 'horizontal'
    ? { left: `${(1 - fraction) * 100}%`, top: '0', width: `${fraction * 100}%`, height: '100%' }
    : { left: '0', top: `${(1 - fraction) * 100}%`, width: '100%', height: `${fraction * 100}%` }
})
</script>

<template>
  <main class="scroll-capture" aria-label="滚动长截图" :aria-busy="busy">
    <header><strong><Icon name="scroll" :size="17" />滚动长截图</strong><button aria-label="取消长截图" :title="automatic ? '先暂停自动滚动（Esc）' : '取消（Esc）'" :disabled="busy && !automatic" @click="$emit('cancel')"><Icon name="close" :size="16" /></button></header>
    <p class="instructions">{{ automatic ? `正在原选区向${direction === 'horizontal' ? '右' : '下'}滚动，画面静止后拼接。` : '选区中心应位于可滚动内容内，避开动态区域。' }}<br />{{ automatic ? 'Esc / 空格暂停；暂停后可保存或手动补采。' : '蓝框标出最近采集的一屏，可检查是否衔接。' }}</p>
    <fieldset class="scroll-directions" :disabled="busy || automatic || (progress?.frames ?? 1) > 1" title="开始拼接后方向锁定；重新框选可更换方向">
      <legend>拼接方向</legend>
      <label><input v-model="direction" type="radio" value="vertical" />竖向</label>
      <label><input v-model="direction" type="radio" value="horizontal" />横向</label>
    </fieldset>
    <label class="reverse-scroll" title="系统或滚轮增强软件使自动滚动方向相反时勾选；只影响本次自动滚动">
      <input v-model="reverse" type="checkbox" :disabled="busy || automatic" />反向滚轮<span>自动滚动方向相反时使用</span>
    </label>
    <section ref="preview" class="scroll-preview" aria-label="长截图拼接预览">
      <div v-if="progress" class="scroll-sheet" :style="sheetStyle">
        <img :src="progress.previewDataUrl" alt="当前已拼接的长截图" />
        <div class="scroll-current-viewport" :style="viewportStyle" aria-label="最近采集的一屏"><span>当前屏</span></div>
      </div>
      <span v-else>正在准备长截图…</span>
    </section>
    <div v-if="progress" class="scroll-dimensions"><strong>{{ progress.width }} × {{ progress.height }}</strong><span>已采集 {{ progress.frames }} 屏</span></div>
    <p class="scroll-status" :class="{ failure: error }" :role="error ? 'alert' : 'status'">{{ error || status || (automatic ? '自动滚动中；画面不变或拼接失败时暂停，保留已采集内容。' : progress?.message) || '点击开始后才采集选区。' }}</p>
    <div class="capture-controls">
      <button class="append-screen" :aria-pressed="automatic" :disabled="!automatic && (busy || !progress)" @click="$emit('toggle-auto')">{{ automatic ? '暂停自动滚动' : '开始自动滚动' }}</button>
      <button :disabled="busy || automatic || !progress" @click="$emit('append')"><Icon name="plus" :size="16" />采集下一屏</button>
    </div>
    <footer aria-label="长截图完成操作">
      <button :disabled="busy || automatic || !progress" @click="$emit('finish', 'edit')" title="在编辑器中标注、美化">更多编辑</button>
      <button :disabled="busy || automatic || !progress" @click="$emit('finish', 'pin')">贴到桌面</button>
      <button :disabled="busy || automatic || !progress" @click="$emit('finish', 'save')">保存</button>
      <button class="finish-copy" :disabled="busy || automatic || !progress" @click="$emit('finish', 'copy')">复制完成</button>
    </footer>
  </main>
</template>

<style scoped>
.scroll-capture{position:fixed;inset:0;box-sizing:border-box;display:flex;flex-direction:column;gap:8px;padding:12px 14px;background:#121a29;color:#e9eef8;font:12px/1.5 Inter,"PingFang SC","Microsoft YaHei",sans-serif;overflow:auto;user-select:none;border:1px solid #34435e}
.capture-controls{display:flex;gap:8px}.capture-controls>button{flex:1}.capture-controls>.append-screen{width:auto}
.scroll-directions{display:flex;align-items:center;gap:18px;margin:0;padding:0;border:0;font-size:11px}.scroll-directions legend{float:left;margin-right:18px;color:#879bb7}.scroll-directions label{display:flex;align-items:center;gap:4px}.scroll-directions input{margin:0;accent-color:#81baff}.scroll-directions:disabled{opacity:.5}
.reverse-scroll{display:flex;align-items:center;gap:5px;font-size:11px}.reverse-scroll input{margin:0;accent-color:#81baff}.reverse-scroll span{margin-left:auto;font-size:10px;color:#879bb7}
.scroll-capture .scroll-preview{flex:1;min-height:60px;height:auto;padding:8px}.scroll-capture .scroll-sheet{position:relative;display:block;flex:none}.scroll-capture .scroll-sheet img{display:block;width:100%;height:100%;max-width:none;object-fit:fill}.scroll-capture .scroll-current-viewport{position:absolute;display:block;box-sizing:border-box;border:2px solid #5ba5ff;box-shadow:0 0 0 1px #09244280;pointer-events:none}.scroll-current-viewport span{position:absolute;right:0;top:0;padding:0 4px;background:#2d78ce;color:white;font-size:9px}.scroll-dimensions{display:flex;justify-content:space-between;color:#b7c5dc;font-size:11px}.scroll-dimensions strong{font-variant-numeric:tabular-nums;color:#e4edf9}
header,header strong,footer{display:flex;align-items:center;gap:8px}header{justify-content:space-between}header strong{font-size:14px;font-weight:600;color:#d2eeb5}button{display:inline-flex;align-items:center;justify-content:center;gap:5px;min-height:29px;padding:4px 9px;border:1px solid #34435e;border-radius:5px;background:#202d42;color:inherit;font:inherit;cursor:pointer}header button{min-height:24px;padding:2px 4px;background:transparent;border:0}.instructions{margin:0;color:#b9c5d8;font-size:11px;line-height:1.6}.scroll-preview{display:flex;align-items:center;justify-content:center;gap:16px;height:76px;min-height:60px;border-radius:5px;background:#0b111d;overflow:hidden}.scroll-preview img{max-width:40%;height:100%;object-fit:contain;object-position:top}.scroll-preview div{display:flex;flex-direction:column;gap:2px}.scroll-preview strong{font-variant-numeric:tabular-nums;font-size:13px}.scroll-preview span{color:#b7c5dc}.scroll-preview small{color:#7186a7;font-size:10px}.scroll-status{margin:0;min-height:30px;max-height:44px;overflow:auto;font-size:11px;color:#a9c994;overflow-wrap:anywhere}.scroll-status.failure{color:#ffb0a6}.append-screen{width:100%;background:#2d4531;border-color:#506d44;color:#d8edc4;font-weight:600}footer{gap:6px}footer button{flex:1;padding-inline:4px;font-size:11px;white-space:nowrap}.finish-copy{background:#d4e9bd;color:#283b21;border-color:#d4e9bd}button:hover:not(:disabled){filter:brightness(1.15)}button:disabled{opacity:.45;cursor:default}button:focus-visible{outline:2px solid #c4e9a7;outline-offset:2px}
</style>
