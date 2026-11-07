import {
  type MouseEvent,
  type Ref,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react'
import type { EffectKind } from '../sky/effects'
import type { SkyParams } from '../sky/params'
import { SkyRenderer } from '../sky/renderer'

export type SkyHandle = {
  spawn: (kind: EffectKind) => void
  snapshot: () => Promise<Blob>
}

type Props = {
  ref?: Ref<SkyHandle>
  params: SkyParams
  onClick: (target: 'moon' | 'sky') => void
}

export function SkyCanvas({ ref, params, onClick }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<SkyRenderer>(null)

  useEffect(() => {
    const canvas = canvasRef.current!
    const renderer = new SkyRenderer(canvas)
    rendererRef.current = renderer
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      renderer.resize(width, height)
    })
    observer.observe(canvas)
    renderer.start()
    return () => {
      observer.disconnect()
      renderer.stop()
    }
  }, [])

  useImperativeHandle(ref, () => ({
    spawn: (kind) => rendererRef.current?.spawn(kind),
    snapshot: () => rendererRef.current!.snapshot(),
  }))

  useEffect(() => {
    rendererRef.current?.setParams(params)
  }, [params])

  const onMoon = (e: MouseEvent) =>
    rendererRef.current?.moonAt(e.nativeEvent.offsetX, e.nativeEvent.offsetY) ??
    false

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 size-full"
      role="img"
      aria-label="Simulated sky"
      onPointerMove={(e) => {
        e.currentTarget.style.cursor = onMoon(e) ? 'pointer' : ''
      }}
      onClick={(e) => onClick(onMoon(e) ? 'moon' : 'sky')}
    />
  )
}
