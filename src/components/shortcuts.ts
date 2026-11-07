import type { EffectKind } from '../sky/effects'
import type { PanelId } from './SettingsDock'

export type Action =
  'photo' | 'immersive' | 'about' | 'play' | 'now' | PanelId | EffectKind

// One key per action, as `KeyboardEvent.key` reads it, upper-cased.
export const SHORTCUTS: Record<Action, string> = {
  photo: 'P',
  immersive: 'F',
  about: 'I',
  play: ' ',
  now: 'N',
  cloudCover: 'C',
  windSpeed: 'W',
  precipitation: 'R',
  temperature: 'T',
  starCount: 'S',
  moon: 'M',
  effects: 'E',
  plane: '1',
  birds: '2',
  shootingStar: '3',
  balloon: '4',
}

const EFFECTS: readonly Action[] = ['plane', 'birds', 'shootingStar', 'balloon']

// Whether the action sends something across the sky.
export const isEffect = (action: Action): action is EffectKind =>
  EFFECTS.includes(action)

// The key as shown on screen.
export const keyName = (action: Action) =>
  SHORTCUTS[action] === ' ' ? 'Space' : SHORTCUTS[action]

// "Clouds (C)", for a button's tooltip.
export const withKey = (label: string, action: Action) =>
  `${label} (${keyName(action)})`

const ACTIONS = Object.keys(SHORTCUTS) as Action[]

// The action a key press asks for, if any. Typing in a field and key
// combinations are left alone, and Space keeps pressing a focused button.
export function actionFor(e: KeyboardEvent): Action | null {
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return null
  const target = e.target as HTMLElement
  if (target.closest('input, textarea, select, [contenteditable="true"]'))
    return null
  if (e.key === ' ' && target.closest('button, a')) return null
  const key = e.key.toUpperCase()
  return ACTIONS.find((a) => SHORTCUTS[a] === key) ?? null
}
