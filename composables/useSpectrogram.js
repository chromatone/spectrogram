import { ref, isRef, onMounted, onUnmounted, computed, watch, reactive } from 'vue'

// ---------------------------------------------------------------------------
// Auditory-model constants — the "science defaults" for the cochleagram.
// ---------------------------------------------------------------------------
const AUDITORY_BLEND = 1          // Band-shape: 0 = constant-Q (cents-spaced), 1 = ERB (cochlea-realistic)
const ENERGY_WINDOW_SIGMA = 0.9   // Width (in bin half-widths) of the Gaussian used to integrate FFT energy per band
const LATERAL_INHIBITION = 0.6    // Spectral contrast between neighboring bands (cochlear lateral suppression), 0 = off
const TEMPORAL_INTEGRATION = 1    // 0 = flat smoothing speed, 1 = frequency-dependent (bass integrates slower, like the ear)
const NATIVE_SMOOTHING = 0        // AnalyserNode.smoothingTimeConstant — kept at 0, we do our own integration

// ---------------------------------------------------------------------------
// Clarity / resolution enhancement constants.
// ---------------------------------------------------------------------------
const PARABOLIC_PEAK_BLEND = 0.8   // How much true sub-bin FFT peak energy is blended into the band estimate
const ENVELOPE_CONTRAST = 0.35     // Broad spectral high-pass / formant-haze reduction
const ENVELOPE_RADIUS = 10         // Spectral envelope neighborhood, in bands
const SOFT_THRESHOLD = 0.05        // Soft noise-floor threshold in shader, 0..1
const RIDGE_SHARPEN = 0.16         // Sharpening across frequency ridges
const TEMPORAL_SHARPEN = 0.05      // Mild sharpening along time axis for transients / pitch bends

// ---------------------------------------------------------------------------
// Compressed-time density rendering constants.
// ---------------------------------------------------------------------------
const HISTORY_MULTIPLIER = 12      // Desired number of screen-heights of history stored in the GPU ring buffer
const SUSTAIN_TAU = 0.45           // Time constant for sustained/harmonic background estimation
const TRANSIENT_ATTACK_TAU = 0.012 // Fast attack time constant for transient detection
const TRANSIENT_RELEASE_TAU = 0.14 // Release time constant for transient detail

const params = {
  midpoint: { default: 0.3, min: 0, max: 1, step: 0.0001, fixed: 2 },
  steep: { default: 20, min: 3, max: 40, step: 0.001, fixed: 1 },
  range: { default: 90, min: 40, max: 100, step: 1, fixed: 0, label: 'Dynamic range (dB)' },
  emph: { default: 3, min: 0, max: 9, step: 0.5, fixed: 1, param: 'EMPH' },
  speed: { default: 1, min: 0.1, max: 4, step: 0.1, fixed: 1 },
  fftSize: { default: 13, min: 12, max: 15, step: 1, fixed: 0 },
  offset: { default: 1, min: 0, max: 1, step: 0.01, fixed: 2 },

  // Kept safely below the shader's MAX_TIME_TAPS budget.
  // The fragment shader uses MAX_TIME_TAPS = 24, and log(24) ≈ 3.18.
  timeCompress: { default: 1.5, min: 0.0, max: 3.1, step: 0.1, fixed: 1, label: 'Time compression' },
}

// WebGL shaders
const VERT = `#version 300 es
  in vec2 p;
  out vec2 uv;
  void main(){ uv = p * .5 + .5; gl_Position = vec4(p, 0, 1); }
`

const FRAG = `#version 300 es
precision mediump float;
in vec2 uv;
out vec4 c;

uniform sampler2D tex;
uniform float scroll; 
uniform int rows;      
uniform float steep, midpoint;
uniform int vert;      
uniform int p3;        
uniform float mirror;
uniform vec2 texelSize;

uniform float timeScale;
uniform float timeCompress;

uniform float softThreshold;
uniform float sharpFreq;
uniform float sharpTime;

const int MAX_TIME_TAPS = 24;

vec3 hsl(float h,float s,float l){
  vec3 rgb=clamp(abs(mod(h*6.+vec3(0,4,2),6.)-3.)-1.,0.,1.);
  return l+s*(rgb-.5)*(1.-abs(2.*l-1.));
}

void main(){
  float freqUV = vert==1 ? uv.x : uv.y;
  float screenT = vert==1 ? uv.y : uv.x;

  float side = step(mirror, screenT);
  float zoneWidth = mix(mirror, 1.0 - mirror, side);
  float edgeDist = abs(screenT - mirror) / max(zoneWidth, 1e-5);
  
  // --- Exponential time compression ---
  //
  // T(x) = (e^(kx) - 1)/k
  // derivative at x=0 is exactly 1.0, preserving origin speed.
  float k = clamp(timeCompress, 0.001, 3.2);

  float rawDepthScreens = (exp(k * edgeDist) - 1.0) / k;
  float tDepthScreens = min(rawDepthScreens, timeScale);
  float tDepth = tDepthScreens / max(timeScale, 1e-5);

  float ringOffset = scroll / float(rows);
  float centerTime = mod(ringOffset - tDepth + 1000.0, 1.0);

  // --- Correct compressed-time footprint ---
  //
  // A screen fragment represents an interval of time, not a single instant.
  // We estimate that interval and integrate the ring-buffer texture over it.
  float analyticSpan = exp(k * edgeDist) * texelSize.y;
  float screenSpan = fwidth(tDepth);
  float fullSpan = max(max(analyticSpan, screenSpan), texelSize.y);

  // Keep filtering inside the available ring-buffer window.
  // This prevents sampling across the newest/oldest seam.
  fullSpan = min(fullSpan, float(MAX_TIME_TAPS) * texelSize.y);
  float boundary = min(tDepth, 1.0 - tDepth);
  float halfSpan = min(fullSpan * 0.5, boundary);
  float span = halfSpan * 2.0;

  vec2 avg;

  if (span <= texelSize.y) {
    // Near field / low compression:
    // use the sharper 5-tap ridge-aware pass.
    vec2 tc = vec2(freqUV, centerTime);

    vec2 cRG = texture(tex, tc).rg;
    float center = cRG.r;

    float left  = texture(tex, tc - vec2(texelSize.x, 0.0)).r;
    float right = texture(tex, tc + vec2(texelSize.x, 0.0)).r;

    float dxx = left + right - 2.0 * center;

    // Avoid temporal sharpening across the ring-buffer seam.
    float dyy = 0.0;
    if (tDepth > texelSize.y && tDepth < 1.0 - texelSize.y) {
      float up    = texture(tex, tc - vec2(0.0, texelSize.y)).r;
      float down  = texture(tex, tc + vec2(0.0, texelSize.y)).r;
      dyy = up + down - 2.0 * center;
    }

    float sharpened = center - (sharpFreq * dxx + sharpTime * dyy);

    avg = vec2(sharpened, cRG.g);
  } else {
    // Far field / high compression:
    // integrate over the time interval represented by this fragment.
    float tapsFloat = clamp(ceil(span / texelSize.y), 1.0, float(MAX_TIME_TAPS));
    int taps = int(tapsFloat);

    vec2 acc = vec2(0.0);
    float wsum = 0.0;

    for (int i = 0; i < MAX_TIME_TAPS; i++) {
      if (i >= taps) break;

      float fi = float(i);

      float u = 0.0;
      if (taps > 1) {
        u = fi / float(taps - 1) - 0.5;
      }

      float offset = u * span;

      // Slight triangular weighting is more stable than a hard box filter.
      float w = 1.0 - 0.35 * abs(u * 2.0);

      vec2 tci = vec2(
        freqUV,
        mod(centerTime + offset + 1000.0, 1.0)
      );

      acc += texture(tex, tci).rg * w;
      wsum += w;
    }

    avg = acc / max(wsum, 1e-5);
  }

  // Sanitize density values.
  avg.r = clamp(avg.r, 0.0, 1.0);
  avg.g = clamp(min(avg.g, avg.r), 0.0, 1.0);

  // --- Transient fade in deep time ---
  //
  // Fast percussive detail becomes lower-density sediment in the far tail,
  // while sustained harmonic structure remains visible.
  float far = clamp(tDepth, 0.0, 1.0);
  float tapDensity = clamp(span / texelSize.y, 1.0, float(MAX_TIME_TAPS));

  float transientVis = 1.0 / (1.0 + 0.10 * (tapDensity - 1.0));
  transientVis *= mix(1.0, 0.25, far);

  float val = avg.r - avg.g * (1.0 - transientVis);
  val = clamp(val, 0.0, 1.0);

  // --- Soft threshold / wavelet-style sparsification ---
  float t = clamp(softThreshold, 0.0, 0.95);
  val = max(val - t, 0.0) / max(1.0 - t, 1e-5);
  val = clamp(val, 0.0, 1.0);

  // Sigmoid contrast
  float v = 1. / (1. + exp(-steep * (val - midpoint)));

  // Topographic Isobars
  v = v - fract(v * 16.0) * 0.025;

  float semitones = freqUV * 111.;
  float hue = semitones / 12.;

  float sat = clamp(v * 1.1, 0.0, 0.9) * (p3==1 ? 1.1 : 1.0);
  float light = pow(v, 0.8) * 0.80;
  float gate = smoothstep(0.01, 0.06, v);

  c = vec4(hsl(hue, sat, light) * gate, 1.);
}
`

// Minimal Float32 -> Half-float (Uint16) conversion.
const _f32 = new Float32Array(1)
const _u32 = new Uint32Array(_f32.buffer)
function toHalf(v) {
  _f32[0] = v
  const x = _u32[0]
  const sign = (x >> 16) & 0x8000
  const exp = (x >> 23) & 0xff
  const mant = x & 0x7fffff
  if (exp < 103) return sign
  if (exp > 142) return sign | 0x7c00
  if (exp < 113) return sign | ((mant | 0x800000) >> (126 - exp))
  return sign | ((exp - 112) << 10) | (mant >> 13)
}

export function useSpectrogram() {
  let canvas, gl, prog, tex, rowBuf
  let audioCtx, analyzer, micSource
  let fftData

  let bandValues, bandBinLo, bandBinHi, bandBinCenter, bandBinSigma
  let bandRaw, bandSharp, bandSmooth, bandAlpha
  let bandDb, bandDbSharp, bandWeights, bandWeightingDb, bandFreqs
  let bandEnv, bandEnvTmp

  // Density rendering channels:
  // bandValues       -> total visible value
  // bandTransient    -> transient detail amount
  // bandSustain      -> slow sustained background estimate
  let bandSustain, bandTransient, prevBandTransient

  let prevBandValues = new Float32Array(1024)
  let numBands = 0
  let animationId
  let lastTime = 0

  let scrollPos = 0.0;
  let lastWrittenRow = -1;
  let texRows = 1
  let actualMultiplier = HISTORY_MULTIPLIER
  let uloc = {}

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

  function mkShader(type, src) {
    const s = gl.createShader(type)
    gl.shaderSource(s, src)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      console.error(gl.getShaderInfoLog(s))
    return s
  }

  function initGL() {
    gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true })
    prog = gl.createProgram()
    gl.attachShader(prog, mkShader(gl.VERTEX_SHADER, VERT))
    gl.attachShader(prog, mkShader(gl.FRAGMENT_SHADER, FRAG))
    gl.linkProgram(prog)
    gl.useProgram(prog)

    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, 'p')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)

    for (const u of [
      'tex', 'scroll', 'rows', 'steep', 'midpoint', 'vert', 'p3',
      'mirror', 'texelSize', 'timeScale', 'timeCompress',
      'softThreshold', 'sharpFreq', 'sharpTime'
    ]) {
      uloc[u] = gl.getUniformLocation(prog, u)
    }

    gl.uniform1i(uloc.tex, 0)
  }

  function initTex() {
    if (!gl || !numBands) return

    const maxTexSize = gl ? (gl.getParameter(gl.MAX_TEXTURE_SIZE) || 8192) : 8192
    const screenRows = vertical.value ? width.value : height.value
    const desiredRows = Math.max(1, Math.floor(screenRows * HISTORY_MULTIPLIER))

    texRows = Math.min(desiredRows, maxTexSize)
    actualMultiplier = screenRows > 0 ? texRows / screenRows : HISTORY_MULTIPLIER

    if (tex) gl.deleteTexture(tex)
    tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)

    // Two-channel history:
    // R = total value
    // G = transient detail
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RG16F,
      numBands,
      texRows,
      0,
      gl.RG,
      gl.HALF_FLOAT,
      null
    )

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT)

    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)

    rowBuf = new Uint16Array(numBands * 2)

    scrollPos = 0.0;
    lastWrittenRow = -1;

    if (bandSmooth) bandSmooth.fill(0)
    if (bandSustain) bandSustain.fill(0)
    if (bandTransient) bandTransient.fill(0)
  }

  const setSize = (w, h) => {
    canvas.width = w
    canvas.height = h
    if (gl) { gl.viewport(0, 0, w, h); initTex() }
  }
  watch([width, height], ([w, h]) => setSize(w, h))

  onMounted(() => {
    canvas = canvasElement.value
    setSize(width.value, height.value)
    initGL()
    const videostream = canvas.captureStream()
    video.value.srcObject = videostream
  })

  const MIN_NOTE = 21
  const MAX_NOTE = 132
  const BASE_FREQ = 440
  const BASE_NOTE = 69

  function freqPitch(freq) { return 12 * Math.log2(Number(freq) / 440) }
  function colorFreq(freq, value = 1) { return `hsl(${freqPitch(freq) * 30}, ${value * 100}%, ${value * 75}%)`; }
  function midiToFreq(midi) { return BASE_FREQ * 2 ** ((midi - BASE_NOTE) / 12) }
  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x }
  function erb(freq) { return 24.7 * (4.37 * freq / 1000 + 1) }

  function generateBands() {
    const subBands = 10
    const halfSub = (subBands - 1) / 2
    const tempBands = []

    for (let note = MIN_NOTE; note <= MAX_NOTE; note++) {
      const centerFreq = midiToFreq(note)
      for (let i = -halfSub; i <= halfSub; i++) {
        const centsOffset = (i / halfSub) * 50
        const freq = centerFreq * 2 ** (centsOffset / 1200)
        const centsWidth = 50 / halfSub
        const freqLoQ = freq * 2 ** (-centsWidth / 1200)
        const freqHiQ = freq * 2 ** (centsWidth / 1200)
        const halfErb = erb(freq) / (2 * subBands)
        const freqLoErb = freq - halfErb
        const freqHiErb = freq + halfErb

        const freqLo = freqLoQ + (freqLoErb - freqLoQ) * AUDITORY_BLEND
        const freqHi = freqHiQ + (freqHiErb - freqHiQ) * AUDITORY_BLEND
        tempBands.push({ freq, freqLo, freqHi, note, centsOffset })
      }
    }

    numBands = tempBands.length

    bandValues = new Float32Array(numBands)
    bandDb = new Float32Array(numBands)
    bandDbSharp = new Float32Array(numBands)
    bandRaw = new Float32Array(numBands)
    bandSharp = new Float32Array(numBands)
    bandSmooth = new Float32Array(numBands)
    bandAlpha = new Float32Array(numBands)
    prevBandValues = new Float32Array(numBands)
    bandWeightingDb = new Float32Array(numBands)
    bandFreqs = new Float32Array(numBands)
    bandWeights = new Array(numBands)

    bandEnv = new Float32Array(numBands)
    bandEnvTmp = new Float32Array(numBands)

    bandSustain = new Float32Array(numBands)
    bandTransient = new Float32Array(numBands)
    prevBandTransient = new Float32Array(numBands)

    const logLo = Math.log2(tempBands[0].freq)
    const logHi = Math.log2(tempBands[numBands - 1].freq)

    if (analyzer) {
      const sampleRate = audioCtx.sampleRate
      const fftSize = Math.pow(2, controls.fftSize)

      for (let i = 0; i < numBands; i++) {
        const b = tempBands[i]
        bandFreqs[i] = b.freq

        // 1. Precompute perceptual weighting in dB (ZERO per-frame cost)
        bandWeightingDb[i] = 20 * Math.log10(a(b.freq) + 1e-12)

        // 2. Adaptive bandAlpha based on actual frequency range
        const t = clamp01((Math.log2(b.freq) - logLo) / (logHi - logLo))
        bandAlpha[i] = 0.2 + t * 0.5

        // 3. Precompute SPARSE Gaussian weights
        const lo = Math.max(0, Math.floor(b.freqLo * fftSize / sampleRate))
        const hi = Math.min(fftSize / 2, Math.ceil(b.freqHi * fftSize / sampleRate))
        const centerBin = b.freq * fftSize / sampleRate
        const sigma = Math.max(0.5, (hi - lo) / 2 * ENERGY_WINDOW_SIGMA)

        const weights = []
        let weightSum = 0
        for (let j = lo; j <= hi; j++) {
          const d = (j - centerBin) / sigma
          const w = Math.exp(-0.5 * d * d)
          if (w > 0.005) { // Sparse threshold: ignore negligible tails
            weights.push({ bin: j, weight: w })
            weightSum += w
          }
        }

        // Normalize weights so they sum to exactly 1.0
        for (let k = 0; k < weights.length; k++) {
          weights[k].weight /= weightSum
        }
        bandWeights[i] = weights
      }
    }

    if (!barFrequencies.value) barFrequencies.value = tempBands
  }

  function initiate() {
    navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, autoGainControl: false, noiseSuppression: false },
      video: false
    }).then(async stream => {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)()
      micSource = audioCtx.createMediaStreamSource(stream)
      analyzer = audioCtx.createAnalyser()
      analyzer.fftSize = Math.pow(2, controls.fftSize)
      analyzer.smoothingTimeConstant = NATIVE_SMOOTHING
      micSource.connect(analyzer)

      fftData = new Float32Array(analyzer.frequencyBinCount)
      generateBands()
      initTex()
      initiated.value = true
      video.value.play()
      lastTime = performance.now()
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

  function processFFT() {
    analyzer.getFloatFrequencyData(fftData)

    const dynamicRange = controls.range
    const fftBins = fftData.length

    // ---------------------------------------------------------------------
    // 1. Sparse weighted energy integration + sub-pixel parabolic peak fit.
    // ---------------------------------------------------------------------
    for (let i = 0; i < numBands; i++) {
      const weights = bandWeights[i]

      if (!weights || weights.length === 0) {
        bandDb[i] = -dynamicRange
        continue
      }

      let powerSum = 0
      let maxDb = -Infinity
      let maxBin = -1

      for (let k = 0; k < weights.length; k++) {
        const bin = weights[k].bin
        const weight = weights[k].weight
        const binDb = fftData[bin]

        powerSum += Math.pow(10, binDb / 10) * weight

        if (binDb > maxDb) {
          maxDb = binDb
          maxBin = bin
        }
      }

      let db = 10 * Math.log10(powerSum + 1e-12)

      // Parabolic interpolation around the strongest bin.
      let peakDb = maxDb

      if (maxBin > 0 && maxBin < fftBins - 1) {
        const ym1 = fftData[maxBin - 1]
        const y0 = fftData[maxBin]
        const yp1 = fftData[maxBin + 1]

        if (Number.isFinite(ym1) && Number.isFinite(y0) && Number.isFinite(yp1)) {
          const denom = ym1 - 2 * y0 + yp1

          // For a true local peak, the parabola curvature is negative.
          if (denom < -1e-6) {
            let delta = 0.5 * (ym1 - yp1) / denom
            delta = Math.max(-0.5, Math.min(0.5, delta))

            const interp = y0 - 0.25 * (ym1 - yp1) * delta
            if (interp > peakDb) peakDb = interp
          }
        }
      }

      const perceptualDb = bandWeightingDb[i]
      const octaves = Math.max(0, Math.log2(bandFreqs[i] / 300))
      const emphDb = octaves * controls.emph

      db += perceptualDb + emphDb
      peakDb += perceptualDb + emphDb

      // Blend the interpolated peak into the integrated energy estimate.
      bandDb[i] = db + Math.max(0, peakDb - db) * PARABOLIC_PEAK_BLEND
    }

    // ---------------------------------------------------------------------
    // 2. Broad spectral envelope contrast.
    // ---------------------------------------------------------------------
    if (ENVELOPE_CONTRAST > 0) {
      for (let i = 0; i < numBands; i++) {
        let m = bandDb[i]

        const lo = Math.max(0, i - ENVELOPE_RADIUS)
        const hi = Math.min(numBands - 1, i + ENVELOPE_RADIUS)

        for (let j = lo; j <= hi; j++) {
          if (bandDb[j] > m) m = bandDb[j]
        }

        bandEnvTmp[i] = m
      }

      // Light smoothing of the envelope prevents blocky local-max contours.
      for (let i = 0; i < numBands; i++) {
        const prev = bandEnvTmp[i > 0 ? i - 1 : i]
        const curr = bandEnvTmp[i]
        const next = bandEnvTmp[i < numBands - 1 ? i + 1 : i]
        bandEnv[i] = (prev + curr + next) / 3
      }

      for (let i = 0; i < numBands; i++) {
        bandDb[i] += (bandDb[i] - bandEnv[i]) * ENVELOPE_CONTRAST
      }
    }

    // ---------------------------------------------------------------------
    // 3. Lateral inhibition in dB space.
    // ---------------------------------------------------------------------
    if (LATERAL_INHIBITION > 0) {
      for (let i = 0; i < numBands; i++) {
        const prev = bandDb[i > 0 ? i - 1 : i]
        const next = bandDb[i < numBands - 1 ? i + 1 : i]
        const lateral = (prev + next) * 0.5
        bandDbSharp[i] = bandDb[i] + (bandDb[i] - lateral) * LATERAL_INHIBITION
      }
    } else {
      bandDbSharp.set(bandDb)
    }

    // ---------------------------------------------------------------------
    // 4. Normalize to 0..1 ONLY AFTER all perceptual math is complete.
    // ---------------------------------------------------------------------
    for (let i = 0; i < numBands; i++) {
      bandRaw[i] = clamp01((bandDbSharp[i] + dynamicRange) / dynamicRange)
    }

    // ---------------------------------------------------------------------
    // 5. Framerate-independent temporal integration.
    // ---------------------------------------------------------------------
    const now = performance.now()
    const dt = Math.min((now - lastTime) / 1000, 0.1) // Cap at 100ms to prevent jumps on tab switch
    lastTime = now

    for (let i = 0; i < numBands; i++) {
      const alpha60 = TEMPORAL_INTEGRATION > 0
        ? (1 - TEMPORAL_INTEGRATION) + TEMPORAL_INTEGRATION * bandAlpha[i]
        : 1

      // Calculate tau based on a 60fps reference (1/60 = 0.01666s)
      const tau = -0.01666 / Math.log(Math.max(0.001, 1 - alpha60))
      const a = 1 - Math.exp(-dt / tau) // Framerate-independent smoothing factor

      bandSmooth[i] += (bandRaw[i] - bandSmooth[i]) * a
      bandValues[i] = bandSmooth[i]
    }

    // ---------------------------------------------------------------------
    // 6. Transient / sustained separation for deep-time density rendering.
    // ---------------------------------------------------------------------
    const sustainA = 1 - Math.exp(-dt / SUSTAIN_TAU)

    for (let i = 0; i < numBands; i++) {
      bandSustain[i] += (bandValues[i] - bandSustain[i]) * sustainA

      const transientTarget = Math.max(0, bandValues[i] - bandSustain[i])

      const tau = transientTarget > bandTransient[i]
        ? TRANSIENT_ATTACK_TAU
        : TRANSIENT_RELEASE_TAU

      const a = 1 - Math.exp(-dt / tau)

      bandTransient[i] += (transientTarget - bandTransient[i]) * a

      // Transient detail should never exceed the total visible value.
      if (bandTransient[i] > bandValues[i]) {
        bandTransient[i] = bandValues[i]
      }
    }
  }

  function render() {
    if (!analyzer || paused.value) {
      animationId = requestAnimationFrame(render)
      return
    }

    prevBandValues.set(bandValues)
    prevBandTransient.set(bandTransient)

    processFFT()

    scrollPos += controls.speed;
    const currentRow = Math.floor(scrollPos);
    let rowsToWrite = currentRow - lastWrittenRow;
    lastWrittenRow = currentRow;
    rowsToWrite = Math.min(rowsToWrite, texRows);

    for (let s = 0; s < rowsToWrite; s++) {
      const t = rowsToWrite > 1 ? (s + 1) / rowsToWrite : 1.0;

      for (let i = 0; i < numBands; i++) {
        const lerpTotal =
          prevBandValues[i] +
          (bandValues[i] - prevBandValues[i]) * t

        const lerpTransient =
          prevBandTransient[i] +
          (bandTransient[i] - prevBandTransient[i]) * t

        const total = clamp01(lerpTotal)
        const transient = clamp01(Math.min(lerpTransient, total))

        rowBuf[i * 2 + 0] = toHalf(total)
        rowBuf[i * 2 + 1] = toHalf(transient)
      }

      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        (currentRow - rowsToWrite + s) % texRows,
        numBands,
        1,
        gl.RG,
        gl.HALF_FLOAT,
        rowBuf
      )
    }

    gl.uniform1f(uloc.scroll, scrollPos % texRows);
    gl.uniform1i(uloc.rows, texRows);
    gl.uniform1f(uloc.steep, controls.steep);
    gl.uniform1f(uloc.midpoint, controls.midpoint);
    gl.uniform1i(uloc.vert, vertical.value ? 1 : 0);
    gl.uniform1i(uloc.p3, window.matchMedia('(color-gamut: p3)').matches ? 1 : 0);
    gl.uniform1f(uloc.mirror, controls.offset);
    gl.uniform2f(uloc.texelSize, 1.0 / numBands, 1.0 / texRows);

    gl.uniform1f(uloc.timeScale, actualMultiplier);
    gl.uniform1f(uloc.timeCompress, controls.timeCompress);

    gl.uniform1f(uloc.softThreshold, SOFT_THRESHOLD);
    gl.uniform1f(uloc.sharpFreq, RIDGE_SHARPEN);
    gl.uniform1f(uloc.sharpTime, TEMPORAL_SHARPEN);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

    if (recording.value) recordFrame()
    animationId = requestAnimationFrame(render)
  }

  const pics = reactive([])
  let offscreenCanvas, offscreenCtx

  const startRecording = () => {
    offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = 2000;
    offscreenCanvas.height = vertical.value ? width.value : height.value;
    offscreenCtx = offscreenCanvas.getContext('2d');
    offscreenCtx.imageSmoothingEnabled = false;
    recording.value = Date.now();
    recordedWidth.value = 0;
  };

  const stopRecording = () => {
    recording.value = false;
    const finalWidth = Math.ceil(recordedWidth.value);
    const finalHeight = offscreenCanvas.height;

    if (finalWidth > 0 && finalHeight > 0) {
      const temp = document.createElement('canvas');
      temp.width = finalWidth;
      temp.height = finalHeight;
      const tempCtx = temp.getContext('2d');
      tempCtx.drawImage(offscreenCanvas, 0, 0);
      offscreenCanvas = temp;
      offscreenCtx = tempCtx;
    }

    offscreenCanvas.toBlob((blob) => {
      pics.push(window.URL.createObjectURL(blob))
    }, 'image/png');
  };

  const recordFrame = () => {
    const isVertical = vertical.value;
    const mirrorPos = controls.offset;

    let srcX, srcY, srcW, srcH;
    if (!isVertical) {
      srcX = Math.round(mirrorPos * (width.value - 1));
      srcY = 0;
      srcW = 1;
      srcH = height.value;
    } else {
      srcX = 0;
      srcY = Math.round(mirrorPos * (height.value - 1));
      srcW = width.value;
      srcH = 1;
    }

    const newWidth = recordedWidth.value + 1;
    if (offscreenCanvas.width < newWidth) {
      const temp = document.createElement('canvas');
      temp.width = offscreenCanvas.width;
      temp.height = offscreenCanvas.height;
      temp.getContext('2d').drawImage(offscreenCanvas, 0, 0);
      offscreenCanvas.width = offscreenCanvas.width * 2;
      offscreenCtx.drawImage(temp, 0, 0);
      offscreenCtx.imageSmoothingEnabled = false;
    }

    if (!isVertical) {
      offscreenCtx.drawImage(canvas, srcX, srcY, srcW, srcH, recordedWidth.value, 0, 1, height.value);
    } else {
      offscreenCtx.drawImage(canvas, srcX, srcY, srcW, srcH, 0, recordedWidth.value, width.value, 1);
    }
    recordedWidth.value = newWidth;
  };

  const takeScreenshot = () => {
    if (!canvas) return;
    canvas.toBlob((blob) => {
      pics.push(window.URL.createObjectURL(blob))
    }, 'image/png');
  };

  function clear() {
    if (gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT) }
    if (tex) initTex()
  }

  watch(() => controls.fftSize, (v) => {
    if (analyzer) {
      analyzer.fftSize = Math.pow(2, v)
      fftData = new Float32Array(analyzer.frequencyBinCount)
      generateBands()
      initTex()
    }
  })

  return {
    initiate, startRecording, stopRecording, pics, colorFreq, clear, screen, canvasElement, video,
    paused, recording, recordedWidth, controls, params, initiated, vertical, width, height, barFrequencies, takeScreenshot
  }
}

// ---------------------------------------------------------------------------
// Helpers & Weighting Functions
// ---------------------------------------------------------------------------

function useControls(paramsList) {
  const controls = reactive({})
  for (let param in paramsList) {
    let p = paramsList[param]
    controls[param] = useClamp(useStorage(param, p.default), p.min, p.max)
  }
  return controls
}

function useStorage(key, init) {
  const val = ref(localStorage.getItem(key) ? JSON.parse(localStorage.getItem(key)) : init)
  watch(val, v => localStorage.setItem(key, JSON.stringify(v)), { deep: true })
  return val
}

function useWindowSize() {
  const width = ref(window.innerWidth), height = ref(window.innerHeight)
  const update = () => { width.value = window.innerWidth; height.value = window.innerHeight }
  onMounted(() => window.addEventListener('resize', update))
  onUnmounted(() => window.removeEventListener('resize', update))
  return { width, height }
}

export function useClamp(v, min, max) {
  const refVal = isRef(v) ? v : ref(v)
  const clamp = n => Math.min(Math.max(n, min), max)
  return computed({ get: () => clamp(refVal.value), set: val => refVal.value = clamp(val) })
}

// A-weighting: approximates human ear frequency sensitivity
export function a(f) {
  let f2 = f * f
  return 1.2588966 * 148840000 * f2 * f2 /
    ((f2 + 424.36) * Math.sqrt((f2 + 11599.29) * (f2 + 544496.41)) * (f2 + 148840000))
}

// B-weighting: moderate loudness
export function b(f) {
  let f2 = f * f
  return 1.019764760044717 * 148840000 * f * f2 /
    ((f2 + 424.36) * Math.sqrt(f2 + 25122.25) * (f2 + 148840000))
}

// C-weighting: high loudness
export function c(f) {
  let f2 = f * f
  return 1.0069316688518042 * 148840000 * f2 /
    ((f2 + 424.36) * (f2 + 148840000))
}

// D-weighting: aircraft noise
export function d(f) {
  let f2 = f * f
  return (f / 6.8966888496476e-5) * Math.sqrt(
    (((1037918.48 - f2) * (1037918.48 - f2) + 1080768.16 * f2) /
      ((9837328 - f2) * (9837328 - f2) + 11723776 * f2)) / ((f2 + 79919.29) * (f2 + 1345600))
  )
}

// ITU-R 468 noise weighting
export function m(f) {
  let f2 = f * f
  let h1 = -4.737338981378384e-24 * f2 * f2 * f2 + 2.043828333606125e-15 * f2 * f2 - 1.363894795463638e-7 * f2 + 1
  let h2 = 1.306612257412824e-19 * f2 * f2 * f - 2.118150887518656e-11 * f2 * f + 5.559488023498642e-4 * f
  return 8.128305161640991 * 1.246332637532143e-4 * f / Math.sqrt(h1 * h1 + h2 * h2)
}

// Z-weighting (zero/flat weighting)
export function z() {
  return 1
}