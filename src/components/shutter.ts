// A camera shutter, synthesised: two short bursts of filtered noise, the
// blades opening then closing, over a soft low thump of the mechanism.

let audio: AudioContext | null = null

function click(ctx: AudioContext, at: number, gain: number, pitch: number) {
  const length = Math.round(ctx.sampleRate * 0.045)
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i++)
    data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (length * 0.18))
  const source = ctx.createBufferSource()
  source.buffer = buffer
  const filter = ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = pitch
  filter.Q.value = 0.9
  const level = ctx.createGain()
  level.gain.value = gain
  source.connect(filter).connect(level).connect(ctx.destination)
  source.start(at)
}

function thump(ctx: AudioContext, at: number) {
  const osc = ctx.createOscillator()
  osc.frequency.setValueAtTime(140, at)
  osc.frequency.exponentialRampToValueAtTime(60, at + 0.08)
  const level = ctx.createGain()
  level.gain.setValueAtTime(0.25, at)
  level.gain.exponentialRampToValueAtTime(0.001, at + 0.1)
  osc.connect(level).connect(ctx.destination)
  osc.start(at)
  osc.stop(at + 0.12)
}

// Must be called from a click or key press: browsers only start audio then.
export function playShutter() {
  try {
    audio ??= new AudioContext()
    if (audio.state === 'suspended') void audio.resume()
    const t = audio.currentTime + 0.01
    click(audio, t, 0.9, 3200)
    thump(audio, t)
    click(audio, t + 0.075, 0.6, 2400)
  } catch (error) {
    // No sound is no reason to miss the shot.
    console.warn(error)
  }
}
