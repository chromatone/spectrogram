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

// WebGL shaders — demoscene style, minimal but readable
const VERT = `#version 300 es
in vec2 p;
out vec2 uv;
void main(){uv=p*.5+.5;gl_Position=vec4(p,0,1);}
`

// Fragment shader:
// - ring buffer texture scroll via writeRow uniform
// - HSL color from pitch (hue = semitones from A4 * 30deg)
// - sigmoid contrast + brightness from midpoint/steep uniforms
const FRAG = `#version 300 es
precision mediump float;
in vec2 uv;
out vec4 c;
uniform sampler2D tex;
uniform int writeRow;  // current ring buffer write row
uniform int rows;      // texture height == time axis length
uniform float steep, midpoint;
uniform int vert;      // 1 = vertical scroll
uniform int p3;        // 1 = Display P3 available (boost saturation)

// HSL to RGB (compact, no branches)
vec3 hsl(float h,float s,float l){
  vec3 rgb=clamp(abs(mod(h*6.+vec3(0,4,2),6.)-3.)-1.,0.,1.);
  return l+s*(rgb-.5)*(1.-abs(2.*l-1.));
}

void main(){
  // Texture layout: x=bands(freq), y=time(rows)
  // Horizontal mode: screen.x=time, screen.y=freq
  // Vertical mode:   screen.x=freq, screen.y=time
  float freqUV = vert==1 ? uv.x : uv.y;
  float timeUV = vert==1 ? uv.y : uv.x;

  // Ring buffer scroll: newest row is writeRow-1, oldest is writeRow
  // We want oldest at screen left/top (timeUV=0), newest at right/bottom (timeUV=1)
  float offset = float(writeRow) / float(rows);
  float scrolled = mod(timeUV + offset, 1.);

  // Sample raw amplitude (0-1 from Uint8 texture)
  float val = texture(tex, vec2(freqUV, scrolled)).r;

  // Pink noise correction: +3dB/octave (1/f compensation)
  // Applied per-pixel: freqUV 0..1 maps to A0..C9
  float refFreq = 440.; // A4 reference
  float bandFreq = 27.5 * pow(2., freqUV * 111. / 12.); // A0 * 2^(semitones/12)
  float pinkBoost = 2. * log2(bandFreq / refFreq);
  float corrected = val + pinkBoost * 0.01; // scale dB to 0-1 range

  // Sigmoid contrast
  float v = 1./(1.+exp(-steep*(corrected-midpoint)));

  // Hue from freq position (one full rainbow per octave)
  float semitones = freqUV * 111.;
  float hue = semitones / 12.;

  // Boost saturation for P3 wider gamut
  float sat = v * (p3==1 ? 1.15 : 1.);
  float light = v * 0.75;

  c = vec4(hsl(hue, sat, light) * step(.01, v), 1.);
}
`

export function useSpectrogram() {
  let canvas, gl, prog, tex, rowBuf
  let audioCtx, analyzer, micSource
  let fftData
  let bandValues, bandBinLo, bandBinHi // typed arrays instead of objects
  let numBands = 0
  let animationId
  let writeRow = 0   // current ring buffer write position
  let texRows = 1    // texture height, updated on resize
  let uloc = {}      // cached uniform locations

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

  // Compile shader — returns null and logs on error
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

    // Full-screen quad
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, 'p')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)

    // Cache all uniform locations once
    for (const u of ['tex', 'writeRow', 'rows', 'steep', 'midpoint', 'vert', 'p3'])
      uloc[u] = gl.getUniformLocation(prog, u)

    gl.uniform1i(uloc.tex, 0)
    // Don't call initTex here — bands not generated yet
  }

  function initTex() {
    if (!gl || !numBands) return
    texRows = vertical.value ? width.value : height.value

    if (tex) gl.deleteTexture(tex)
    tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    // LUMINANCE/UNSIGNED_BYTE: universally supported, value encoded as 0-255
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, numBands, texRows, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE) // freq axis: clamp
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT)         // time axis: wrap (ring buffer)

    rowBuf = new Uint8Array(numBands) // numBands is now a global variable
    writeRow = 0
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
    const subBands = 10
    const halfSub = (subBands - 1) / 2
    const tempBands = []

    for (let note = MIN_NOTE; note <= MAX_NOTE; note++) {
      const centerFreq = midiToFreq(note)

      for (let i = -halfSub; i <= halfSub; i++) {
        const centsOffset = (i / halfSub) * 50
        const freq = centerFreq * 2 ** (centsOffset / 1200)
        const centsWidth = 50 / halfSub
        const freqLo = freq * 2 ** (-centsWidth / 1200)
        const freqHi = freq * 2 ** (centsWidth / 1200)

        tempBands.push({ freq, freqLo, freqHi, note, centsOffset })
      }
    }

    numBands = tempBands.length
    bandValues = new Float32Array(numBands)
    bandBinLo = new Uint16Array(numBands)
    bandBinHi = new Uint16Array(numBands)

    if (analyzer) {
      const sampleRate = audioCtx.sampleRate
      const fftSize = Math.pow(2, controls.fftSize)

      for (let i = 0; i < numBands; i++) {
        const b = tempBands[i]
        bandBinLo[i] = Math.max(0, Math.floor(b.freqLo * fftSize / sampleRate))
        bandBinHi[i] = Math.min(fftSize / 2, Math.ceil(b.freqHi * fftSize / sampleRate))
      }
    }

    // Keep tempBands for barFrequencies (display only)
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
      initTex() // now bands exist, safe to allocate texture
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

    for (let i = 0; i < numBands; i++) {
      let sum = 0
      let count = 0

      for (let j = bandBinLo[i]; j <= bandBinHi[i]; j++) {
        sum += fftData[j]
        count++
      }

      const avgDb = count > 0 ? sum / count : -100
      bandValues[i] = Math.max(0, Math.pow(10, (avgDb + 100) / 100 - 1))
    }
  }

  function render() {
    if (!analyzer || paused.value) {
      animationId = requestAnimationFrame(render)
      return
    }

    processFFT()

    // Write one row per frame into ring buffer texture
    // `speed` rows written at once for faster scroll
    const speed = controls.speed
    for (let s = 0; s < speed; s++) {
      for (let i = 0; i < numBands; i++) {
        rowBuf[i] = Math.min(255, Math.max(0, bandValues[i] * 255) | 0)
      }

      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texSubImage2D(
        gl.TEXTURE_2D, 0,
        0, writeRow,          // xoffset, yoffset
        numBands, 1,          // width, height of update
        gl.LUMINANCE, gl.UNSIGNED_BYTE, rowBuf
      )
      writeRow = (writeRow + 1) % texRows
    }

    // Set uniforms and draw full-screen quad
    gl.uniform1i(uloc.writeRow, writeRow)
    gl.uniform1i(uloc.rows, texRows)
    gl.uniform1f(uloc.steep, controls.steep)
    gl.uniform1f(uloc.midpoint, controls.midpoint)
    gl.uniform1i(uloc.vert, vertical.value ? 1 : 0)
    gl.uniform1i(uloc.p3, window.matchMedia('(color-gamut: p3)').matches ? 1 : 0)

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

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

    // Read from WebGL canvas, round to avoid subpixel gaps
    const srcX = Math.round(width.value - controls.speed)
    const srcW = Math.round(controls.speed)
    const srcH = Math.round(height.value)
    const dstX = Math.round(recordedWidth.value)

    offscreenCtx.drawImage(
      canvas,
      srcX, 0, srcW, srcH,
      dstX, 0, srcW, srcH
    )

    recordedWidth.value = newWidth
  };

  function clear() {
    if (gl) { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT) }
    if (tex) initTex() // reset ring buffer
  }

  // Update parameters
  watch(() => controls.fftSize, (v) => {
    if (analyzer) {
      analyzer.fftSize = Math.pow(2, v)
      fftData = new Float32Array(analyzer.frequencyBinCount)
      generateBands()
      initTex() // reinit texture since numBands unchanged but bin ranges changed
    }
  })

  watch(() => controls.smooth, (v) => {
    if (analyzer) analyzer.smoothingTimeConstant = v
  })


  // Initialize barFrequencies on first render
  watch(initiated, (v) => {
    if (v && !barFrequencies.value) barFrequencies.value = bands
  })

  return {
    initiate, startRecording, stopRecording, pics, colorFreq, clear, screen, canvasElement, video, paused, recording, recordedWidth, controls, params, initiated, vertical, width, height, barFrequencies
  }
}


