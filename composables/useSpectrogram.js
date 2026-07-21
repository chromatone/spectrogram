
import { ref, isRef, onMounted, onUnmounted, computed, watch, reactive } from 'vue'

const params = {
  midpoint: { default: 0.3, min: 0, max: 1, step: 0.0001, fixed: 2 },
  steep: { default: 20, min: 3, max: 40, step: 0.001, fixed: 1 },
  speed: { default: 1, min: 0.1, max: 4, step: 0.1, fixed: 1 },
  fftSize: { default: 13, min: 12, max: 14, step: 1, fixed: 0 },
  smooth: { default: 0, min: 0, max: 1, step: 0.01, fixed: 1 },
  offset: { default: 1, min: 0, max: 1, step: 0.01, fixed: 2 },
  // Changed speed to allow fractional values (down to 0.1)
  weighting: { default: 1, min: 0, max: 1, step: 0.01, fixed: 2, hidden: true },
  auditory: { default: 1, min: 0, max: 1, step: 0.01, fixed: 2, hidden: true },
  integration: { default: 1, min: 0, max: 1, step: 0.01, fixed: 2, hidden: true },
  sharpen: { default: 1, min: 0, max: 1, step: 0.01, fixed: 2, hidden: true },

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
  float timeUV = clamp(1.0 - edgeDist, 0.0, 1.0); 

  float ringOffset = scroll / float(rows);
  float scrolled = mod(timeUV + ringOffset, 1.);

  vec2 tc = vec2(freqUV, scrolled);
  
  // --- Softer 5-Tap Unsharp Mask ---
  // Prevents the "coarse static" look while keeping harmonics crisp
  float center = texture(tex, tc).r;
  float left   = texture(tex, tc - vec2(texelSize.x, 0.0)).r;
  float right  = texture(tex, tc + vec2(texelSize.x, 0.0)).r;
  float down   = texture(tex, tc - vec2(0.0, texelSize.y)).r;
  float up     = texture(tex, tc + vec2(0.0, texelSize.y)).r;
  
  float sharp = 0.6; 
  float val = center * (1.0 + 4.0 * sharp) - (left + right + down + up) * sharp;
  val = clamp(val, 0.0, 1.0);

  // --- Unified Perceptual Contour (Operating in 0..1 dB space) ---
  float bandFreq = 27.5 * pow(2., freqUV * 111. / 12.);
  
  // 1. Gentle Pre-emphasis: +3dB/oct above 300Hz. 
  // In our 0..1 scale (100dB total), 3dB = 0.03.
  float octaves = max(0.0, log2(bandFreq / 300.0));
  float preEmph = octaves * 0.03; 
  
  // 2. Subtle Formant Lift: Additive offset for 1-4kHz vocal/energy bands
  float formantLift = smoothstep(0.3, 0.5, freqUV) * smoothstep(0.9, 0.5, freqUV) * 0.06;
  
  // 3. High Roll-off: Attenuates visual hiss at extreme highs
  float highRollOff = smoothstep(0.85, 1.0, freqUV) * -0.15;
  
  float corrected = val + preEmph + formantLift + highRollOff;
  corrected = clamp(corrected, 0.0, 1.0);

  // Sigmoid contrast
  float v = 1./(1.+exp(-steep*(corrected-midpoint)));

  // --- Topographic Isobars ---
  v = v - fract(v * 16.0) * 0.025;

  float semitones = freqUV * 111.;
  float hue = semitones / 12.;

  // 1. Capped saturation (prevents neon blowouts)
  float sat = clamp(v * 1.1, 0.0, 0.9) * (p3==1 ? 1.1 : 1.0);

  // 2. Gamma Lightness Curve
  // Pow(v, 0.8) lifts the mids/quieter sounds slightly out of the black,
  // while preventing the loudest sounds from turning into pure white.
  float light = pow(v, 0.8) * 0.75;

  // 3. Smooth Noise Gate
  // A hard step(.01, v) causes harsh, flickering edges at the noise floor.
  // smoothstep gracefully fades the noise floor into true black.
  float gate = smoothstep(0.01, 0.06, v);

  c = vec4(hsl(hue, sat, light) * gate, 1.);
}
   
`

export function useSpectrogram() {
  let canvas, gl, prog, tex, rowBuf
  let audioCtx, analyzer, micSource
  let fftData
  let bandValues, bandBinLo, bandBinHi
  let bandRaw, bandSharp, bandSmooth, bandAlpha
  let prevBandValues = new Float32Array(1024) // Add this for high-speed interpolation
  let numBands = 0
  let animationId

  // Accumulator for fractional speed
  let scrollPos = 0.0;
  let lastWrittenRow = -1;

  let texRows = 1
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

    // Updated uniform cache: replaced 'writeRow' with 'scroll'
    // Updated uniform cache: added 'texelSize'
    for (const u of ['tex', 'scroll', 'rows', 'steep', 'midpoint', 'vert', 'p3', 'mirror', 'texelSize'])
      uloc[u] = gl.getUniformLocation(prog, u)

    gl.uniform1i(uloc.tex, 0)
  }

  function initTex() {
    if (!gl || !numBands) return
    texRows = vertical.value ? width.value : height.value

    if (tex) gl.deleteTexture(tex)
    tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, numBands, texRows, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT)

    rowBuf = new Uint8Array(numBands)

    // Reset accumulators when texture clears/resizes
    scrollPos = 0.0;
    lastWrittenRow = -1;
    if (bandSmooth) bandSmooth.fill(0)
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
  function sigmoid(value) { return 1 / (1 + Math.exp(-controls.steep * (value - controls.midpoint))); }
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

        const a = controls.auditory
        const freqLo = freqLoQ + (freqLoErb - freqLoQ) * a
        const freqHi = freqHiQ + (freqHiErb - freqHiQ) * a

        tempBands.push({ freq, freqLo, freqHi, note, centsOffset })
      }
    }

    numBands = tempBands.length
    bandValues = new Float32Array(numBands)
    bandBinLo = new Uint16Array(numBands)
    bandBinHi = new Uint16Array(numBands)
    bandRaw = new Float32Array(numBands)
    bandSharp = new Float32Array(numBands)
    bandSmooth = new Float32Array(numBands)
    bandAlpha = new Float32Array(numBands)
    prevBandValues = new Float32Array(numBands) // Add this

    const logLo = Math.log2(20), logHi = Math.log2(8000)
    for (let i = 0; i < numBands; i++) {
      const t = clamp01((Math.log2(tempBands[i].freq) - logLo) / (logHi - logLo))
      // Tighter range: bass is smooth, treble is responsive but not speckled
      bandAlpha[i] = 0.2 + t * 0.5
    }

    if (analyzer) {
      const sampleRate = audioCtx.sampleRate
      const fftSize = Math.pow(2, controls.fftSize)

      for (let i = 0; i < numBands; i++) {
        const b = tempBands[i]
        bandBinLo[i] = Math.max(0, Math.floor(b.freqLo * fftSize / sampleRate))
        bandBinHi[i] = Math.min(fftSize / 2, Math.ceil(b.freqHi * fftSize / sampleRate))
      }
    }

    if (!barFrequencies.value) barFrequencies.value = tempBands
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
      initTex()
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

  function processFFT() {
    analyzer.getFloatFrequencyData(fftData)

    // 1. Raw per-band dB amplitude (Peak picking, mapped to 0..1 perceptual scale)
    for (let i = 0; i < numBands; i++) {
      let maxDb = -100
      for (let j = bandBinLo[i]; j <= bandBinHi[i]; j++) {
        if (fftData[j] > maxDb) maxDb = fftData[j]
      }
      // Map -100dB..0dB directly to 0.0..1.0
      bandRaw[i] = Math.max(0, Math.min(1, (maxDb + 100) / 100))
    }

    // 2. Lateral inhibition (Works perfectly on dB scale)
    const sharpen = controls.sharpen
    if (sharpen > 0) {
      for (let i = 0; i < numBands; i++) {
        const prev = bandRaw[i > 0 ? i - 1 : i]
        const next = bandRaw[i < numBands - 1 ? i + 1 : i]
        const lateral = (prev + next) * 0.5
        bandSharp[i] = Math.max(0, bandRaw[i] + (bandRaw[i] - lateral) * sharpen)
      }
    } else {
      bandSharp.set(bandRaw)
    }

    // 3. Frequency-dependent temporal integration
    const integ = controls.integration
    for (let i = 0; i < numBands; i++) {
      const a = integ > 0 ? (1 - integ) + integ * bandAlpha[i] : 1
      bandSmooth[i] += (bandSharp[i] - bandSmooth[i]) * a
      bandValues[i] = bandSmooth[i]
    }
  }

  function render() {
    if (!analyzer || paused.value) {
      animationId = requestAnimationFrame(render)
      return
    }

    // 1. Save previous frame's data BEFORE processing the new one
    prevBandValues.set(bandValues)
    processFFT()

    // 2. Accumulate fractional speed
    scrollPos += controls.speed;
    const currentRow = Math.floor(scrollPos);
    let rowsToWrite = currentRow - lastWrittenRow;
    lastWrittenRow = currentRow;
    rowsToWrite = Math.min(rowsToWrite, texRows);

    // 3. Write rows with temporal interpolation to prevent stepping/smudging
    for (let s = 0; s < rowsToWrite; s++) {
      const t = rowsToWrite > 1 ? (s + 1) / rowsToWrite : 1.0;

      for (let i = 0; i < numBands; i++) {
        // Interpolate between previous frame and current frame
        const lerpVal = prevBandValues[i] + (bandValues[i] - prevBandValues[i]) * t;
        rowBuf[i] = Math.min(255, Math.max(0, lerpVal * 255) | 0)
      }

      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texSubImage2D(
        gl.TEXTURE_2D, 0,
        0, (currentRow - rowsToWrite + s) % texRows,
        numBands, 1,
        gl.LUMINANCE, gl.UNSIGNED_BYTE, rowBuf
      )
    }

    // 4. Set uniforms and draw
    gl.uniform1f(uloc.scroll, scrollPos % texRows);
    gl.uniform1i(uloc.rows, texRows);
    gl.uniform1f(uloc.steep, controls.steep);
    gl.uniform1f(uloc.midpoint, controls.midpoint);
    gl.uniform1i(uloc.vert, vertical.value ? 1 : 0);
    gl.uniform1i(uloc.p3, window.matchMedia('(color-gamut: p3)').matches ? 1 : 0);
    gl.uniform1f(uloc.weighting, controls.weighting);
    gl.uniform1f(uloc.mirror, controls.offset);

    // Tell the shader the exact size of one texture pixel for the unsharp mask
    gl.uniform2f(uloc.texelSize, 1.0 / numBands, 1.0 / texRows);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

    if (recording.value) recordFrame()

    animationId = requestAnimationFrame(render)
  }

  const pics = reactive([])
  let offscreenCanvas, offscreenCtx
  let recordingAccumulator = 0;

  const startRecording = () => {
    offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = 2000; // Start with a buffer, it will resize if needed
    offscreenCanvas.height = vertical.value ? width.value : height.value;
    offscreenCtx = offscreenCanvas.getContext('2d');
    offscreenCtx.imageSmoothingEnabled = false; // Prevent AA on pixel edges
    recording.value = Date.now();
    recordedWidth.value = 0; // Now strictly an integer (pixels)
  };

  const stopRecording = () => {
    recording.value = false;

    // Crop canvas to exact final width without clearing the image
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
    const mirrorPos = controls.offset; // 0 to 1, where 1 is far edge, 0.5 is center

    // Source slice is ALWAYS exactly 1px from the point of newest data entry
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

    // Destination is ALWAYS exactly 1px wide. No fractional math = no gray lines.
    const newWidth = recordedWidth.value + 1;

    // Resize offscreen canvas if we need more space (back up to temp first to prevent clearing)
    if (offscreenCanvas.width < newWidth) {
      const temp = document.createElement('canvas');
      temp.width = offscreenCanvas.width;
      temp.height = offscreenCanvas.height;
      temp.getContext('2d').drawImage(offscreenCanvas, 0, 0);

      // Double the canvas width to avoid frequent resizes
      offscreenCanvas.width = offscreenCanvas.width * 2;
      offscreenCtx.drawImage(temp, 0, 0);
      offscreenCtx.imageSmoothingEnabled = false;
    }

    // Draw exactly 1 pixel from the WebGL canvas to the offscreen canvas
    if (!isVertical) {
      offscreenCtx.drawImage(
        canvas,
        srcX, srcY, srcW, srcH,
        recordedWidth.value, 0, 1, height.value
      );
    } else {
      offscreenCtx.drawImage(
        canvas,
        srcX, srcY, srcW, srcH,
        0, recordedWidth.value, width.value, 1
      );
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

  watch(() => controls.smooth, (v) => {
    if (analyzer) analyzer.smoothingTimeConstant = v
  })

  watch(() => controls.auditory, () => {
    if (analyzer) generateBands()
  })

  watch(initiated, (v) => {
    if (v && !barFrequencies.value) barFrequencies.value = barFrequencies.value
  })

  return {
    initiate, startRecording, stopRecording, pics, colorFreq, clear, screen, canvasElement, video, paused, recording, recordedWidth, controls, params, initiated, vertical, width, height, barFrequencies, takeScreenshot
  }
}

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
  return watch(val, v => localStorage.setItem(key, JSON.stringify(v)), { deep: true }), val
}

function useWindowSize() {
  const width = ref(innerWidth), height = ref(innerHeight)
  const update = () => (width.value = innerWidth, height.value = innerHeight)
  return onMounted(() => window.addEventListener('resize', update)),
    onUnmounted(() => window.removeEventListener('resize', update)),
    { width, height }
}

export function useClamp(v, min, max) {
  const refVal = isRef(v) ? v : ref(v)
  const clamp = n => Math.min(Math.max(n, min), max)
  return computed({ get: () => clamp(refVal.value), set: val => refVal.value = clamp(val) })
}
