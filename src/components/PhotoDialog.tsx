import { useEffect, useState } from 'react'
import { formatHour } from './formatHour'
import { Modal, PRIMARY, SECONDARY } from './Modal'

export type Photo = { blob: Blob; hour: number; link: string }

type Props = { photo: Photo | null; onClose: () => void }

type ShareStatus = 'idle' | 'copied' | 'failed'

// The sky just taken, printed like an instant photo over the interface, to
// download as an image or share as a link that reopens the same sky.
export function PhotoDialog({ photo, onClose }: Props) {
  const [src, setSrc] = useState<string | null>(null)
  const [status, setStatus] = useState<ShareStatus>('idle')

  useEffect(() => {
    if (!photo) return
    const url = URL.createObjectURL(photo.blob)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- object URL lives with the photo
    setSrc(url)
    setStatus('idle')
    return () => URL.revokeObjectURL(url)
  }, [photo])

  const download = () => {
    if (!src || !photo) return
    const a = document.createElement('a')
    a.href = src
    a.download = `sky-lab-${formatHour(photo.hour).replace(':', '-')}.png`
    a.click()
  }

  const share = async () => {
    if (!photo) return
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Sky Lab', url: photo.link })
        return
      } catch (error) {
        // Dismissed by the user: nothing to do.
        if (error instanceof DOMException && error.name === 'AbortError') return
      }
    }
    try {
      await navigator.clipboard.writeText(photo.link)
      setStatus('copied')
    } catch {
      setStatus('failed')
    }
  }

  return (
    <Modal
      open={photo !== null}
      onClose={onClose}
      labelledBy="photo-title"
      // The tilted print must not raise scrollbars.
      className="overflow-visible"
    >
      {photo && src && (
        <div className="flex flex-col items-center gap-4">
          <h2 id="photo-title" className="sr-only">
            Photo of the sky
          </h2>
          {/* The white print, its wider bottom edge holding the caption. */}
          <figure className="flex -rotate-1 flex-col bg-white p-3 pb-0 shadow-2xl shadow-black/60 motion-safe:animate-[print_700ms_cubic-bezier(0.2,0.8,0.2,1)]">
            <img
              src={src}
              alt={`The sky at ${formatHour(photo.hour)}`}
              className="block max-h-[62svh] w-auto max-w-[min(80vw,56rem)] object-contain motion-safe:animate-[develop_1600ms_ease-out]"
            />
            <figcaption className="flex items-baseline justify-between px-1 py-3 font-serif text-sm text-neutral-700">
              <span>Sky Lab</span>
              <span className="tabular-nums">{formatHour(photo.hour)}</span>
            </figcaption>
          </figure>
          <div className="flex flex-wrap items-center justify-center gap-2 rounded-xl border border-line bg-panel/95 p-1.5 shadow-xl shadow-black/40">
            <button
              type="button"
              onClick={download}
              className={PRIMARY}
              data-autofocus
            >
              Download
            </button>
            <button type="button" onClick={share} className={SECONDARY}>
              Share link
            </button>
            <button type="button" onClick={onClose} className={SECONDARY}>
              Close
            </button>
          </div>
          <p role="status" className="min-h-4 text-center text-[11px] text-ink">
            {status === 'copied' && 'Link copied: it reopens this exact sky.'}
            {status === 'failed' && (
              <>
                Could not copy, here is the link:{' '}
                <span className="break-all select-all">{photo.link}</span>
              </>
            )}
          </p>
        </div>
      )}
    </Modal>
  )
}
