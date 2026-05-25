// Chromatone Spectrogram V2 - Zero dependency 12-TET audio analyzer
export function useSpectrogramV2() {
  // Audio context and nodes
  let audioCtx = null
  let analyzer = null
  let micSource = null

  // Canvas elements
  let canvas = null
  let ctx = null
  let tempCanvas = null
  let tempCtx = null

  // FFT data
  let fftData = null

  // 12-TET band configuration
  let bands = []

  // Recording
  let recordingCanvas = null
  let recordingCtx = null
  let recordingWidth = 0

  // Exposure state
  let maxEnergy = 0
  let energyHistory = []

  // Controls (reactive-like state)
  const controls = {
    subBands: 5,           // Odd number: 3, 5, 7, 9
    fftSize: 8192,         // Power of 2
    smoothing: 0.5,
    speed: 2,
    gain: 1,
    autoExposure: true,
    vertical: false
  }

  // Musical range (C0 to B8)
  const MIN_NOTE = 12      // C0 = MIDI note 12
  const MAX_NOTE = 119     // B8 = MIDI note 119
  const BASE_FREQ = 440    // A4
  const BASE_NOTE = 69     // A4 = MIDI note 69

  // Chromatone color mapping
  function freqPitch(freq, middleA = 440) {
    return 12 * Math.log2(Number(freq) / middleA)
  }

  function colorFreq(freq, value = 1) {
    return `hsl(${freqPitch(freq) * 30}, ${value * 100}%, ${value * 75}%)`
  }

  // MIDI note to frequency (12-TET)
  function midiToFreq(midi) {
    return BASE_FREQ * 2 ** ((midi - BASE_NOTE) / 12)
  }

  // Generate 12-TET frequency grid with odd sub-bands
  function generateBands() {
    bands = []
    const subBands = controls.subBands
    const halfSub = (subBands - 1) / 2  // e.g., 5 bands -> ±2 from center

    for (let note = MIN_NOTE; note <= MAX_NOTE; note++) {
      const centerFreq = midiToFreq(note)

      // Generate sub-bands around the center note
      for (let i = -halfSub; i <= halfSub; i++) {
        const centsOffset = (i / halfSub) * 50  // ±50 cents from center
        const freq = centerFreq * 2 ** (centsOffset / 1200)

        // Calculate band edges (± half sub-band width)
        const centsWidth = 50 / halfSub
        const freqLo = freq * 2 ** (-centsWidth / 1200)
        const freqHi = freq * 2 ** (centsWidth / 1200)

        bands.push({
          freq,
          freqLo,
          freqHi,
          note,
          centsOffset,
          value: 0
        })
      }
    }

    // Pre-calculate FFT bin mappings
    if (analyzer) {
      const sampleRate = audioCtx.sampleRate
      const fftSize = controls.fftSize

      bands.forEach(band => {
        band.binLo = Math.floor(band.freqLo * fftSize / sampleRate)
        band.binHi = Math.ceil(band.freqHi * fftSize / sampleRate)
        band.binLo = Math.max(0, band.binLo)
        band.binHi = Math.min(fftSize / 2, band.binHi)
      })
    }
  }

  // Initialize audio
  async function initiate() {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)()

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          autoGainControl: false,
          noiseSuppression: false
        },
        video: false
      })

      micSource = audioCtx.createMediaStreamSource(stream)
      analyzer = audioCtx.createAnalyser()
      analyzer.fftSize = controls.fftSize
      analyzer.smoothingTimeConstant = controls.smoothing

      micSource.connect(analyzer)

      fftData = new Float32Array(analyzer.frequencyBinCount)

      // Setup canvas
      canvas = document.getElementById('spectrogram')
      ctx = canvas.getContext('2d')

      tempCanvas = document.createElement('canvas')
      tempCtx = tempCanvas.getContext('2d')

      resizeCanvas()
      window.addEventListener('resize', resizeCanvas)

      // Generate bands
      generateBands()

      // Start render loop
      requestAnimationFrame(render)

      // Handle visibility
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && audioCtx.state === 'suspended') {
          audioCtx.resume()
        }
      })

    } catch (e) {
      console.error('Audio init failed:', e)
    }
  }

  function resizeCanvas() {
    const width = window.innerWidth
    const height = window.innerHeight

    canvas.width = width
    canvas.height = height
    tempCanvas.width = width
    tempCanvas.height = height

    clear()
  }

  function clear() {
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }

  // Process FFT data and update band values
  function processFFT() {
    analyzer.getFloatFrequencyData(fftData)

    // Calculate energy for each band
    bands.forEach(band => {
      let sum = 0
      let count = 0

      for (let i = band.binLo; i <= band.binHi; i++) {
        sum += fftData[i]
        count++
      }

      // Convert from dB to linear (0-1 range)
      const avgDb = count > 0 ? sum / count : -100
      band.value = Math.max(0, (avgDb + 100) / 100)
    })

    // Calculate total energy for auto-exposure
    const totalEnergy = bands.reduce((sum, b) => sum + b.value, 0) / bands.length

    if (controls.autoExposure) {
      energyHistory.push(totalEnergy)
      if (energyHistory.length > 60) energyHistory.shift()

      const avgEnergy = energyHistory.reduce((a, b) => a + b, 0) / energyHistory.length
      maxEnergy = maxEnergy * 0.95 + avgEnergy * 0.05
    }
  }

  // Render frame
  function render() {
    if (!analyzer) return

    processFFT()

    const width = canvas.width
    const height = canvas.height
    const speed = controls.speed
    const isVert = controls.vertical

    // Apply exposure (auto-exposure sets base, manual gain scales it)
    const autoGain = controls.autoExposure && maxEnergy > 0 ? 0.5 / maxEnergy : 1
    const exposureGain = autoGain * controls.gain

    // Save current state to temp canvas
    tempCtx.drawImage(canvas, 0, 0)

    // Clear and draw new bands
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, width, height)

    const bandWidth = width / bands.length
    const barHeight = height / bands.length

    for (let i = 0; i < bands.length; i++) {
      const band = bands[i]
      const value = Math.min(1, band.value * exposureGain)

      if (value > 0.01) {
        ctx.fillStyle = colorFreq(band.freq, value)

        if (isVert) {
          ctx.fillRect(i * bandWidth, 0, bandWidth, speed)
        } else {
          ctx.fillRect(width - speed, height - (i + 1) * barHeight, speed, barHeight)
        }
      }
    }

    // Draw out-of-range indicators (gray)
    // Sum energy below C0 and above B8
    const sampleRate = audioCtx.sampleRate
    const minFreq = midiToFreq(MIN_NOTE)
    const maxFreq = midiToFreq(MAX_NOTE)

    const minBin = Math.floor(minFreq * controls.fftSize / sampleRate)
    const maxBin = Math.ceil(maxFreq * controls.fftSize / sampleRate)

    let subBassEnergy = 0
    for (let i = 0; i < minBin; i++) {
      subBassEnergy += Math.max(0, (fftData[i] + 100) / 100)
    }

    let ultraHighEnergy = 0
    for (let i = maxBin; i < fftData.length; i++) {
      ultraHighEnergy += Math.max(0, (fftData[i] + 100) / 100)
    }

    subBassEnergy *= exposureGain
    ultraHighEnergy *= exposureGain

    // Draw gray indicators
    if (subBassEnergy > 0.01) {
      ctx.fillStyle = `rgba(128, 128, 128, ${Math.min(1, subBassEnergy)})`
      if (isVert) {
        ctx.fillRect(0, 0, 20, speed)
      } else {
        ctx.fillRect(width - speed, 0, speed, 20)
      }
    }

    if (ultraHighEnergy > 0.01) {
      ctx.fillStyle = `rgba(128, 128, 128, ${Math.min(1, ultraHighEnergy)})`
      if (isVert) {
        ctx.fillRect(width - 20, 0, 20, speed)
      } else {
        ctx.fillRect(width - speed, height - 20, speed, 20)
      }
    }

    // Feedback loop: draw temp canvas with offset
    ctx.setTransform(1, 0, 0, 1, isVert ? 0 : -speed, isVert ? speed : 0)
    ctx.drawImage(tempCanvas, 0, 0)
    ctx.setTransform(1, 0, 0, 1, 0, 0)

    requestAnimationFrame(render)
  }

  // Update parameters
  function updateParam(key, value) {
    controls[key] = value

    if (key === 'fftSize' && analyzer) {
      analyzer.fftSize = value
      fftData = new Float32Array(analyzer.frequencyBinCount)
      generateBands()
    }

    if (key === 'smoothing' && analyzer) {
      analyzer.smoothingTimeConstant = value
    }

    if (key === 'subBands') {
      generateBands()
    }
  }

  // Proxy for reactive-like control updates
  const controlsProxy = new Proxy(controls, {
    set(target, prop, value) {
      target[prop] = value
      updateParam(prop, value)
      return true
    }
  })

  return {
    initiate,
    clear,
    params: controls,
    controls: controlsProxy
  }
}
