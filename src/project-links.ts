import { invoke, isTauri } from '@tauri-apps/api/core'

export const projectLinks = {
  repository: 'https://github.com/cpython666/starshot',
  issues: 'https://github.com/cpython666/starshot/issues/new',
} as const

export async function openProjectLink(event: MouseEvent, target: keyof typeof projectLinks) {
  if (!isTauri()) return
  event.preventDefault()
  await invoke('open_project_link', { target })
}
