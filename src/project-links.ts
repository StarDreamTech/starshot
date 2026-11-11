import { invoke, isTauri } from '@tauri-apps/api/core'

export const projectLinks = {
  organization: 'https://stardreamtech.github.io/',
  project: 'https://stardreamtech.github.io/projects/starshot/',
  repository: 'https://github.com/StarDreamTech/starshot',
  issues: 'https://github.com/StarDreamTech/starshot/issues/new',
} as const

export async function openProjectLink(event: MouseEvent, target: keyof typeof projectLinks) {
  if (!isTauri()) return
  event.preventDefault()
  await invoke('open_project_link', { target })
}
