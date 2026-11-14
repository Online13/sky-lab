import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import { AboutDialog } from './components/AboutDialog'
import { ImmersiveDialog } from './components/ImmersiveDialog'
import { type Photo, PhotoDialog } from './components/PhotoDialog'
import { SceneBar } from './components/SceneBar'
import { type PanelId, SettingsDock } from './components/SettingsDock'
import { actionFor, isEffect } from './components/shortcuts'
import { playShutter } from './components/shutter'
import { type SkyHandle, SkyCanvas } from './components/SkyCanvas'
import type { Speed, TimeMode } from './components/TimeModeBar'
import { TimerBar } from './components/TimerBar'
import {
  currentHour,
  DEFAULT_PARAMS,
  paramsFromSearch,
  shareURL,
  type SkyParams,
} from './sky/params'

// What fills the screen: the editor, the bare sky, or the sky being shot.
type View = 'editor' | 'immersive' | 'photo'

const FLASH_MS = 450
// Two taps closer than this leave the immersive mode.
const DOUBLE_TAP_MS = 350

// A shared link opens on the sky it describes; otherwise the sky starts now.
const initialParams = (): SkyParams => ({
  ...DEFAULT_PARAMS,
  hour: currentHour(),
  ...paramsFromSearch(window.location.search),
})

function App() {
  const [params, setParams] = useState(initialParams)
  const [panel, setPanel] = useState<PanelId | null>(null)
  const [timeMode, setTimeMode] = useState<TimeMode>('manual')
  const [speed, setSpeed] = useState<Speed>(60)
  const [dialog, setDialog] = useState<'about' | 'immersive' | null>(null)
  const [view, setView] = useState<View>('editor')
  const [flash, setFlash] = useState(false)
  const [photo, setPhoto] = useState<Photo | null>(null)
  // Shown when the browser cannot draw the clouds, until dismissed.
  const [noClouds, setNoClouds] = useState(false)
  const onChange = (patch: Partial<SkyParams>) =>
    setParams((p) => ({ ...p, ...patch }))

  const sky = useRef<SkyHandle>(null)
  const lastTap = useRef(0)

  // The link has been read: the address goes back to the bare page, so a
  // reload does not undo later changes.
  useEffect(() => {
    if (window.location.search)
      history.replaceState(null, '', window.location.pathname)
  }, [])

  // In auto mode the hour runs on, at the chosen speed, from wherever it is.
  useEffect(() => {
    if (timeMode !== 'auto') return
    let last = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const hours = (Math.min(now - last, 100) / 1000 / 3600) * speed
      last = now
      setParams((p) => ({ ...p, hour: (p.hour + hours) % 24 }))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [timeMode, speed])

  const leaveImmersive = useCallback(() => setView('editor'), [])

  // The toolbars hide; the page stays as it is in the browser.
  const enterImmersive = () => {
    setDialog(null)
    setPanel(null)
    setView('immersive')
  }

  // The interface steps aside, the shutter flashes, then the shot comes out
  // as a print over the sky.
  const takePhoto = async () => {
    playShutter()
    setPanel(null)
    setView('photo')
    setFlash(true)
    const link = shareURL(params)
    const { hour } = params
    try {
      const [blob] = await Promise.all([
        sky.current!.snapshot(),
        new Promise((resolve) => setTimeout(resolve, FLASH_MS)),
      ])
      setPhoto({ blob, hour, link })
    } catch (error) {
      console.warn(error)
      setView('editor')
    } finally {
      setFlash(false)
    }
  }

  const closePhoto = () => {
    setPhoto(null)
    setView('editor')
  }

  // Keyboard shortcuts. Open dialogs keep their own keys (Esc closes them).
  // With the toolbars hidden, only what needs no toolbar still works.
  const onShortcut = useEffectEvent((e: KeyboardEvent) => {
    if (dialog || photo || view === 'photo') return
    if (view === 'immersive' && e.key === 'Escape') return leaveImmersive()
    const action = actionFor(e)
    if (!action) return
    if (view === 'immersive' && !isEffect(action) && action !== 'play') return
    e.preventDefault()
    if (isEffect(action)) return sky.current?.spawn(action)
    switch (action) {
      case 'photo':
        return void takePhoto()
      case 'immersive':
        return setDialog('immersive')
      case 'about':
        return setDialog('about')
      case 'play':
        return setTimeMode((m) => (m === 'auto' ? 'manual' : 'auto'))
      case 'now':
        return onChange({ hour: currentHour() })
      default:
        return setPanel((p) => (p === action ? null : action))
    }
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => onShortcut(e)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const hidden = view !== 'editor'

  return (
    <main
      className="relative h-svh overflow-hidden bg-slate-950 text-ink"
      onPointerUp={(e) => {
        if (view !== 'immersive') return
        if (e.timeStamp - lastTap.current < DOUBLE_TAP_MS) leaveImmersive()
        lastTap.current = e.timeStamp
      }}
    >
      <SkyCanvas
        ref={sky}
        params={params}
        onClick={(target) =>
          !hidden &&
          setPanel((p) => (target === 'moon' && p !== 'moon' ? 'moon' : null))
        }
        onNoClouds={() => setNoClouds(true)}
      />

      <div
        inert={hidden}
        className={`transition-opacity duration-300 ${hidden ? 'opacity-0' : ''}`}
      >
        {/* The moon is only a picture on the canvas: keyboard users reach its
            menu through this button, shown when focused. */}
        <button
          type="button"
          onClick={() => setPanel((p) => (p === 'moon' ? null : 'moon'))}
          aria-expanded={panel === 'moon'}
          className="sr-only rounded-lg bg-panel px-3 py-2 text-xs focus:not-sr-only focus:absolute focus:top-3 focus:left-1/2 focus:z-30 focus:-translate-x-1/2 focus-visible:outline-2 focus-visible:outline-accent"
        >
          Moon phase
        </button>

        {/* The title of the scene and what to do with the whole view. */}
        <div className="absolute top-3 left-3 z-20">
          <SceneBar
            onAbout={() => setDialog('about')}
            onImmersive={() => setDialog('immersive')}
            onPhoto={takePhoto}
          />
        </div>

        {/* What the sky holds: a rail on the right. */}
        <div className="absolute top-3 right-3 z-20">
          <SettingsDock
            params={params}
            onChange={onChange}
            panel={panel}
            onPanel={setPanel}
            onEffect={(kind) => sky.current?.spawn(kind)}
          />
        </div>

        {/* When: the most used control, at the bottom under the hand. */}
        <div className="pointer-events-none absolute inset-x-3 bottom-3 z-20 flex flex-col items-center gap-2">
          {noClouds && (
            <p
              role="status"
              className="pointer-events-auto flex max-w-full items-center gap-2 rounded-xl bg-black/55 py-1.5 pr-1.5 pl-3 text-[11px] text-white/90 backdrop-blur-sm"
            >
              Clouds need WebGL2: turn on hardware acceleration in your browser
              settings.
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => setNoClouds(false)}
                className="grid size-5 shrink-0 place-items-center rounded-full text-white/70 hover:bg-white/15 hover:text-white focus-visible:outline-2 focus-visible:outline-accent"
              >
                <svg viewBox="0 0 24 24" aria-hidden className="size-3">
                  <path
                    d="M6 6l12 12M18 6L6 18"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </p>
          )}
          <TimerBar
            hour={params.hour}
            // Setting the hour by hand stops the clock.
            onHour={(hour) => {
              setTimeMode('manual')
              onChange({ hour })
            }}
            onNow={() => onChange({ hour: currentHour() })}
            isNow={Math.abs(params.hour - currentHour()) < 1 / 60}
            mode={timeMode}
            onMode={setTimeMode}
            speed={speed}
            onSpeed={setSpeed}
          />
        </div>
      </div>

      {view === 'immersive' && (
        <p
          aria-live="polite"
          className="pointer-events-none absolute top-4 left-1/2 z-30 -translate-x-1/2 animate-[hint_3.5s_ease_forwards] rounded-full bg-black/45 px-3 py-1.5 text-[11px] text-white/90 backdrop-blur-sm"
        >
          Press Esc or double-tap to bring the toolbars back
        </p>
      )}

      {flash && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-40 animate-[flash_450ms_ease-out_forwards] bg-white motion-reduce:animate-[flash-soft_450ms_ease-out_forwards]"
        />
      )}

      <AboutDialog open={dialog === 'about'} onClose={() => setDialog(null)} />
      <ImmersiveDialog
        open={dialog === 'immersive'}
        onClose={() => setDialog(null)}
        onConfirm={enterImmersive}
      />
      <PhotoDialog photo={photo} onClose={closePhoto} />
    </main>
  )
}

export default App
