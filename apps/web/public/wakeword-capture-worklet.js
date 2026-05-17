// AudioWorklet that buffers incoming mono frames and posts 1280-sample
// (80 ms at 16 kHz) chunks to the main thread for wake-word inference.
// The owning AudioContext is created with sampleRate:16000 so the worklet
// only handles buffering — no resampling.

class WakeWordCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buffer = new Float32Array(1280)
    this.fill = 0
  }

  process(inputs) {
    const input = inputs[0]
    if (!input || input.length === 0) return true
    const channel = input[0]
    if (!channel) return true

    let i = 0
    while (i < channel.length) {
      const room = this.buffer.length - this.fill
      const take = Math.min(room, channel.length - i)
      this.buffer.set(channel.subarray(i, i + take), this.fill)
      this.fill += take
      i += take
      if (this.fill === this.buffer.length) {
        this.port.postMessage(this.buffer.slice(0))
        this.fill = 0
      }
    }
    return true
  }
}

registerProcessor('wakeword-capture', WakeWordCaptureProcessor)
