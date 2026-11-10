<script setup lang="ts">
import { nextTick, ref, useId } from 'vue';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { SHARE_TEXT, createShareImage } from '../share';

const props = defineProps<{ disabled?: boolean }>();
const picture = ref(''), message = ref(''), busy = ref(false);
const previewKind = ref<'text' | 'image' | null>(null);
const previewPanel = ref<HTMLElement>();
const previewId = useId();
const image = () => picture.value || (picture.value = createShareImage());

async function preview(kind: 'text' | 'image') {
  if (busy.value || props.disabled) return;
  message.value = '';
  try {
    if (kind === 'image') image();
    previewKind.value = kind;
    await nextTick();
    previewPanel.value?.focus();
  } catch (e) { message.value = String(e); }
}

async function action(kind: 'text' | 'copy' | 'save') {
  if (busy.value || props.disabled || previewKind.value !== (kind === 'text' ? 'text' : 'image')) return;
  busy.value = true;
  message.value = '';
  try {
    if (kind === 'text') {
      if (isTauri()) await invoke('copy_text', { text: SHARE_TEXT });
      else await navigator.clipboard.writeText(SHARE_TEXT);
      message.value = '已复制分享文案。';
    } else if (kind === 'copy') {
      const dataUrl = image();
      if (isTauri()) await invoke('copy_image', { dataUrl });
      else await navigator.clipboard.write([new ClipboardItem({ 'image/png': await (await fetch(dataUrl)).blob() })]);
      message.value = '已复制产品介绍图。';
    } else if (isTauri()) {
      const path = await invoke<string | null>('save_image', { dataUrl: image(), suggestedName: '星镜产品介绍.png' });
      message.value = path ? `已保存到 ${path}` : '已取消保存。';
    } else {
      const a = document.createElement('a');
      a.href = image(); a.download = '星镜产品介绍.png'; a.click();
      message.value = '已发起产品介绍图下载。';
    }
  } catch (e) { message.value = String(e); }
  finally { busy.value = false; }
}
</script>

<template>
  <section class="settings-section">
    <h3>分享星镜</h3>
    <p class="field-note">先预览，再确认复制。分享图使用本地生成的原创示意画面。</p>
    <fieldset :disabled="busy || disabled">
      <button class="button" :aria-controls="previewId" :aria-expanded="previewKind === 'text'" @click="preview('text')">预览介绍文案</button>
      <button class="button" :aria-controls="previewId" :aria-expanded="previewKind === 'image'" @click="preview('image')">预览产品图</button>
    </fieldset>
    <div v-if="previewKind" :id="previewId" ref="previewPanel" class="share-preview-panel" tabindex="-1" role="region" :aria-label="previewKind === 'text' ? '分享文案预览' : '分享图片预览'" :aria-busy="busy">
      <template v-if="previewKind === 'text'">
        <h4>分享文案预览</h4>
        <p class="share-preview-text">{{ SHARE_TEXT }}</p>
      </template>
      <template v-else>
        <h4>分享图片预览</h4>
        <img :src="picture" class="share-preview" alt="星镜原创产品介绍图" />
      </template>
      <fieldset :disabled="busy || disabled" class="share-preview-actions">
        <button class="button primary" @click="action(previewKind === 'text' ? 'text' : 'copy')">{{ busy ? '正在处理…' : previewKind === 'text' ? '确认复制文案' : '确认复制图片' }}</button>
        <button v-if="previewKind === 'image'" class="button" @click="action('save')">保存产品图</button>
      </fieldset>
    </div>
    <p v-if="message" class="field-note" role="status">{{ message }}</p>
  </section>
</template>
