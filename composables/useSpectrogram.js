import { ref, onMounted, watch, reactive } from 'vue'
import { useStorage, useWindowSize } from '@vueuse/core'
import { useClamp } from '@vueuse/math';

const params = {
  fftSize: { default: 14, min: 12, max: 14, step: 1, fixed: 0 },
  smooth: { default: 0.5, min: 0, max: 1, step: 0.01, fixed: 2 },
  speed: { default: 2, min: 1, max: 4, step: 1, fixed: 0 },
  midpoint: { default: 0.5, min: 0, max: 1, step: 0.0001, fixed: 2 },
  steep: { default: 10, min: 3, max: 30, step: 0.001, fixed: 2 }
}

function useControls(paramsList) {
  const controls = reactive({})
  for (let param in paramsList) {
    let p = paramsList[param]
    controls[param] = useClamp(useStorage(param, p.default), p.min, p.max)
  }
  return controls
}

export function useSpectrogram() {
  let canvas, ctx, tempCanvas, tempCtx
  let audioCtx, analyzer, micSource
  let fftData
  let bands = []
  let animationId

  const screen = ref()
  const canvasElement = ref()
  const video = ref()

  const initiated = ref(false)
  const paused = ref(false)
  const recording = ref(false)
  const recordedWidth = ref(0)

  const barFrequencies = ref()

  const vertical = useStorage('vertical', false)

  const controls = useControls(params)

  const { width, height } = useWindowSize()
  const setSize = (w, h) => {
    canvas.width = tempCanvas.width = w
    canvas.height = tempCanvas.height = h
    clear()
  }
  watch([width, height], ([w, h]) => setSize(w, h))

  onMounted(() => {
    canvas = canvasElement.value
    ctx = canvas.getContext('2d')
    tempCanvas = document.createElement('canvas')
    tempCtx = tempCanvas.getContext('2d')
    setSize(width.value, height.value)
    const videostream = canvas.captureStream();
    video.value.srcObject = videostream;
  });

  // Musical range (A0 to C9)
  const MIN_NOTE = 21
  const MAX_NOTE = 132
  const BASE_FREQ = 440
  const BASE_NOTE = 69

  function freqPitch(freq) { return 12 * Math.log2(Number(freq) / 440) }
  function colorFreq(freq, value = 1) { return `hsl(${freqPitch(freq) * 30}, ${value * 100}%, ${value * 75}%)`; }
  function midiToFreq(midi) { return BASE_FREQ * 2 ** ((midi - BASE_NOTE) / 12) }
  function sigmoid(value) { return 1 / (1 + Math.exp(-controls.steep * (value - controls.midpoint))); }

  function generateBands() {
    bands = []
    const subBands = 10
    const halfSub = (subBands - 1) / 2

    for (let note = MIN_NOTE; note <= MAX_NOTE; note++) {
      const centerFreq = midiToFreq(note)

      for (let i = -halfSub; i <= halfSub; i++) {
        const centsOffset = (i / halfSub) * 50
        const freq = centerFreq * 2 ** (centsOffset / 1200)
        const centsWidth = 50 / halfSub
        const freqLo = freq * 2 ** (-centsWidth / 1200)
        const freqHi = freq * 2 ** (centsWidth / 1200)

        bands.push({ freq, freqLo, freqHi, note, centsOffset, value: 0 })
      }
    }

    if (analyzer) {
      const sampleRate = audioCtx.sampleRate
      const fftSize = Math.pow(2, controls.fftSize)

      bands.forEach(band => {
        band.binLo = Math.floor(band.freqLo * fftSize / sampleRate)
        band.binHi = Math.ceil(band.freqHi * fftSize / sampleRate)
        band.binLo = Math.max(0, band.binLo)
        band.binHi = Math.min(fftSize / 2, band.binHi)
      })
    }
  }

  function initiate() {
    navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        autoGainControl: false,
        noiseSuppression: false,
      }, video: false
    }).then(async stream => {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)()
      micSource = audioCtx.createMediaStreamSource(stream)
      analyzer = audioCtx.createAnalyser()
      analyzer.fftSize = Math.pow(2, controls.fftSize)
      analyzer.smoothingTimeConstant = controls.smooth

      micSource.connect(analyzer)

      fftData = new Float32Array(analyzer.frequencyBinCount)

      generateBands()
      initiated.value = true
      video.value.play()

      animationId = requestAnimationFrame(render)

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && audioCtx.state === 'suspended') {
          audioCtx.resume()
        }
      })
    }).catch((e) => {
      console.log('mic denied', e)
    })
  }

  // Pink noise (1/f) has power falling 3dB/octave.
  // We apply +3dB/octave in dB space (before linear conversion) so that
  // natural/musical pink-noise signals appear perceptually flat.
  // This is exact: dB is already a log scale, so correction is additive.
  const REF_FREQ = 440 // A4 — normalization point (0dB correction)

  function processFFT() {
    analyzer.getFloatFrequencyData(fftData)

    bands.forEach(band => {
      let sum = 0
      let count = 0

      for (let i = band.binLo; i <= band.binHi; i++) {
        sum += fftData[i]
        count++
      }

      const avgDb = count > 0 ? sum / count : -100
      // Pink noise correction: +3dB per octave above REF_FREQ
      const pinkBoostDb = 3 * Math.log2(band.freq / REF_FREQ)
      const correctedDb = avgDb + pinkBoostDb
      band.value = Math.max(0, Math.pow(10, (correctedDb + 100) / 100 - 1))
    })
  }

  function render() {
    if (!analyzer || paused.value) {
      animationId = requestAnimationFrame(render)
      return
    }

    processFFT()

    const w = width.value
    const h = height.value
    const speed = controls.speed
    const isVert = vertical.value

    tempCtx.drawImage(canvas, 0, 0)

    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, w, h)

    const bandWidth = w / bands.length
    const barHeight = h / bands.length

    for (let i = 0; i < bands.length; i++) {
      const band = bands[i]
      const value = Math.min(1, sigmoid(band.value))

      if (value > 0.01) {
        ctx.fillStyle = colorFreq(band.freq, value)

        if (isVert) {
          ctx.fillRect(i * bandWidth, 0, bandWidth, speed)
        } else {
          ctx.fillRect(w - speed, h - (i + 1) * barHeight, speed, barHeight)
        }
      }
    }


    ctx.setTransform(1, 0, 0, 1, isVert ? 0 : -speed, isVert ? speed : 0)
    ctx.drawImage(tempCanvas, 0, 0)
    ctx.setTransform(1, 0, 0, 1, 0, 0)

    if (recording.value) recordFrame()

    animationId = requestAnimationFrame(render)
  }

  const pics = reactive([])

  let offscreenCanvas, offscreenCtx

  const startRecording = () => {
    offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = controls.speed;
    offscreenCanvas.height = height.value;
    offscreenCtx = offscreenCanvas.getContext('2d');
    recording.value = Date.now();
    recordedWidth.value = controls.speed;
  };

  const stopRecording = () => {
    recording.value = false;
    offscreenCanvas.toBlob((blob) => {
      pics.push(window.URL.createObjectURL(blob))
    }, 'image/png');
  };

  let recTemp, recCtx

  const recordFrame = () => {
    recTemp = recTemp || document.createElement('canvas')
    recCtx = recCtx || recTemp.getContext('2d')

    const newWidth = recordedWidth.value + controls.speed

    recTemp.width = newWidth
    recTemp.height = offscreenCanvas.height
    recCtx.drawImage(offscreenCanvas, 0, 0)
    offscreenCanvas.width = newWidth
    offscreenCtx.drawImage(recTemp, 0, 0)

    offscreenCtx.drawImage(
      canvas,
      width.value - controls.speed, 0,
      controls.speed, height.value,
      recordedWidth.value, 0,
      controls.speed, height.value
    )

    recordedWidth.value = newWidth
  };

  function clear() {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width.value, height.value)
  }

  // Update parameters
  watch(() => controls.fftSize, (v) => {
    if (analyzer) {
      analyzer.fftSize = Math.pow(2, v)
      fftData = new Float32Array(analyzer.frequencyBinCount)
      generateBands()
    }
  })

  watch(() => controls.smooth, (v) => {
    if (analyzer) analyzer.smoothingTimeConstant = v
  })

  watch(() => controls.subBands, () => {
    generateBands()
    if (!barFrequencies.value) barFrequencies.value = bands
  })

  // Initialize barFrequencies on first render
  watch(initiated, (v) => {
    if (v && !barFrequencies.value) barFrequencies.value = bands
  })

  return {
    initiate, startRecording, stopRecording, pics, colorFreq, clear, screen, canvasElement, video, paused, recording, recordedWidth, controls, params, initiated, vertical, width, height, barFrequencies
  }
}


