# Chromatone Spectrogram — Code Bible

## Stack Information

### Core Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| vue | 3.6.0-beta.12 | Reactive UI framework |
| @vueuse/core | 14.3.0 | Vue composition utilities |
| @vueuse/gesture | 2.0.0 | Touch/mouse gesture handling |
| @vueuse/math | 14.3.0 | Math utilities (useClamp) |
| @unocss/reset | 66.7.0 | CSS reset |
| unocss | 66.7.0 | Utility-first CSS framework |

### Dev Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| vite | 8.0.14 | Build tool and dev server |
| @vitejs/plugin-vue | 6.0.7 | Vue SFC support |
| vite-plugin-singlefile | 2.3.3 | Inline all assets into single HTML |
| pug | 3.0.4 | Template language |
| @vue/language-plugin-pug | 3.3.1 | Pug syntax highlighting |
| @iconify-json/la | 1.2.1 | Line Awesome icons |
| @iconify-json/ph | 1.2.2 | Phosphor icons |
| @unocss/extractor-pug | 66.7.0 | UnoCSS Pug extractor |

### Build Configuration

- **Node version**: ^24.x
- **Package manager**: pnpm@11.3.0
- **Dev server port**: 3542
- **Preview port**: 4222
- **Base path**: ./ (relative for GitHub Pages)

### Language/Template Choices

- **UI**: Vue 3 Composition API with `<script setup>`
- **Templates**: Pug (indented HTML)
- **Styling**: UnoCSS utility classes with PostCSS
- **Graphics**: WebGL2 (fragment shader for rendering)
- **Audio**: Web Audio API (no external libraries)

---

## Reactive State Patterns

### useStorage + useClamp Pattern

All persistent controls use the same pattern: `useClamp(useStorage(key, default), min, max)`

```javascript
const params = {
  fftSize: { default: 13, min: 12, max: 14, step: 1, fixed: 0 },
  smooth: { default: 0, min: 0, max: 1, step: 0.01, fixed: 1 },
  speed: { default: 1, min: 1, max: 4, step: 1, fixed: 0 },
  midpoint: { default: 0.3, min: 0, max: 1, step: 0.0001, fixed: 2 },
  steep: { default: 20, min: 3, max: 40, step: 0.001, fixed: 1 }
}

function useControls(paramsList) {
  const controls = reactive({})
  for (let param in paramsList) {
    let p = paramsList[param]
    controls[param] = useClamp(useStorage(param, p.default), p.min, p.max)
  }
  return controls
}
```

### State Storage Keys

| Key | Default | Range | Description |
|-----|---------|-------|-------------|
| fftSize | 13 | 12-14 | FFT size (2^N, 4096-16384) |
| smooth | 0 | 0-1 | Temporal smoothing |
| speed | 1 | 1-4 | Scrolling speed (rows per frame) |
| midpoint | 0.3 | 0-1 | Sigmoid threshold |
| steep | 20 | 3-40 | Sigmoid steepness |
| vertical | false | - | Orientation mode |

### Transient State (Not Persisted)

- `initiated` — Audio context initialized
- `paused` — Rendering paused
- `recording` — Screenshot recording active
- `recordedWidth` — Current recording width
- `videoRecording` — Video recording timestamp

### Computed Values

- `frequency` — Mouse position mapped to frequency (App.vue)
- `external` — ControlRotary internal-to-external value mapping

---

## Audio/External Node Patterns

### Web Audio API Nodes

```javascript
// Lazy instantiation (on user gesture)
audioCtx = new (window.AudioContext || window.webkitAudioContext)()
micSource = audioCtx.createMediaStreamSource(stream)
analyzer = audioCtx.createAnalyser()

// Parameter updates (direct, no ramping)
analyzer.fftSize = Math.pow(2, controls.fftSize)
analyzer.smoothingTimeConstant = controls.smooth

// Connection order
micSource.connect(analyzer)
```

### WebGL2 Context

```javascript
// Eager instantiation (on mount)
gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true })

// Cached uniform locations (set once, updated per frame)
for (const u of ['tex', 'writeRow', 'rows', 'steep', 'midpoint', 'vert', 'p3'])
  uloc[u] = gl.getUniformLocation(prog, u)
```

### Effect Chain

```
Microphone → MediaStreamSource → AnalyserNode → FFT Data → Band Summation → Texture Upload → Shader → Canvas
```

---

## Reusable Math/Algorithms

### Frequency Calculations

```javascript
// MIDI to frequency conversion
function midiToFreq(midi) { 
  return 440 * 2 ** ((midi - 69) / 12) 
}

// Frequency to pitch (semitones from A4)
function freqPitch(freq) { 
  return 12 * Math.log2(Number(freq) / 440) 
}

// Frequency to HSL color
function colorFreq(freq, value = 1) { 
  return `hsl(${freqPitch(freq) * 30}, ${value * 100}%, ${value * 75}%)` 
}

// Sigmoid contrast
function sigmoid(value) { 
  return 1 / (1 + Math.exp(-controls.steep * (value - controls.midpoint))) 
}
```

### Band Generation (12-TET)

```javascript
const MIN_NOTE = 21  // A0
const MAX_NOTE = 132 // C9
const subBands = 10  // sub-bands per semitone

for (let note = MIN_NOTE; note <= MAX_NOTE; note++) {
  const centerFreq = midiToFreq(note)
  for (let i = -4.5; i <= 4.5; i++) {
    const centsOffset = (i / 4.5) * 50
    const freq = centerFreq * 2 ** (centsOffset / 1200)
    // ... store freq, freqLo, freqHi, note, centsOffset
  }
}
```

### FFT Bin Mapping

```javascript
const sampleRate = audioCtx.sampleRate
const fftSize = Math.pow(2, controls.fftSize)

bandBinLo[i] = Math.max(0, Math.floor(freqLo * fftSize / sampleRate))
bandBinHi[i] = Math.min(fftSize / 2, Math.ceil(freqHi * fftSize / sampleRate))
```

---

## Gesture Handling

### ControlRotary Component

```javascript
useGesture({
  onDrag: ({ delta: [x, y], dragging, shiftKey, event }) => {
    if (event) event.preventDefault();
    const diff = shiftKey ? 12 : event.type === 'wheel' ? -8 : 2;
    state.internal = useClamp(0, state.internal - y / diff + x / diff, 100);
    model.value = external.value;
  },
  onWheel: ({ delta: [x, y], event }) => {
    if (event) event.preventDefault();
    state.internal = useClamp(0, state.internal + y / 8 - x / 8, 100);
    model.value = external.value;
  }
}, {
  wheel: { preventWindowScrollY: true },
  eventOptions: { capture: false, passive: false },
  domTarget: knob
});
```

### Sensitivity Constants

- **Drag sensitivity**: 2 (normal), 12 (shift key), 8 (wheel)
- **Wheel sensitivity**: 8
- **preventDefault**: Always called on drag/wheel events

---

## Centralized Systems

### RAF Loop (Render Cycle)

```javascript
function render() {
  if (!analyzer || paused.value) {
    animationId = requestAnimationFrame(render)
    return
  }

  processFFT()           // Get FFT data, sum into bands
  // Upload to texture    // Write rows to ring buffer
  // Set uniforms          // Update shader parameters
  gl.drawArrays(...)      // Draw full-screen quad
  
  if (recording.value) recordFrame()  // Capture screenshot

  animationId = requestAnimationFrame(render)
}
```

### Ring Buffer Texture

- **Texture format**: LUMINANCE/UNSIGNED_BYTE (universally supported)
- **Dimensions**: width = numBands (1120), height = canvas height
- **Scrolling**: WRAP_T=REPEAT, UV offset based on writeRow
- **Update**: texSubImage2D per row, not full texture

### No Event Bus

No centralized event bus — components communicate via props/emit and composables.

---

## Component Conventions

### ControlRotary Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| max | Number | 100 | Maximum value |
| min | Number | 0 | Minimum value |
| step | Number | 1 | Value step size |
| param | String | "param" | Parameter name (display) |
| unit | String | "" | Unit suffix |
| fixed | Number | 1 | Decimal places for display |
| cc | Number | 0 | MIDI CC (unused) |
| channel | Number | 0 | MIDI channel (unused) |

### Model Binding

```javascript
const model = defineModel({ default: 50 })

// Internal state (0-100 percentage)
const state = reactive({
  internal: useClamp(0, 0, 100),
  initial: computed(() => ((model.value - props.min) / (props.max - props.min)) * 100)
})

// External value (min-max range)
const external = computed({
  get: () => Math.round(((state.internal / 100) * (props.max - props.min) + props.min) / props.step) * props.step,
  set: (val) => { state.internal = ((val - props.min) / (props.max - props.min)) * 100; }
});
```

### DOM Ref Usage

```javascript
const knob = ref()
useGesture({ ... }, { domTarget: knob })
```

### Template Language

- **Template**: Pug (indented, compact)
- **Styling**: UnoCSS utility classes (atomic)
- **Icons**: Iconify (@iconify-json/la, @iconify-json/ph)

---

## Layout/Visual Patterns

### Root Layout Structure

```pug
.fullscreen-container#screen.cursor-none(ref="screen")
  canvas#spectrogram.max-w-full(
    ref="canvasElement"
    :width="width"
    :height="height")
```

### Overlay Controls

- **Top-left**: Play/pause, orientation toggle, clear
- **Bottom-center**: Video PiP, fullscreen, screenshot, video record
- **Left sidebar**: Rotary controls (scrollable)

### Color Derivation Logic

```javascript
// Hue from pitch (30 degrees per semitone)
hue = freqPitch(freq) * 30

// Saturation and lightness from value
saturation = value * 100%
lightness = value * 75%

// Display P3 boost (15% more saturation)
if (p3) saturation *= 1.15
```

### Active/Inactive States

- **Initiated**: Show canvas, hide start screen
- **Paused**: Show play icon, hide pause icon
- **Recording**: Red dot icon, show timer
- **Video recording**: Red video icon, show timer

### Touch/Gesture Target Styling

```css
.knob {
  touch-action: none;  // Critical for gesture handling
  cursor: grab;
  active: cursor: grabbing;
}
```

---

## File Structure

```
spectrogram/
├── App.vue                    # Main application component
├── bible.md                   # This file
├── CHANGELOG.md               # Version history
├── LICENSE                    # MIT license
├── README.md                  # Project documentation
├── index.html                 # Entry point
├── jsconfig.json              # JS configuration
├── package.json               # Dependencies and scripts
├── pnpm-lock.yaml             # Lock file
├── pnpm-workspace.yaml        # Workspace config
├── vite.config.js             # Vite configuration
├── components/
│   └── ControlRotary.vue      # Rotary knob component
├── composables/
│   ├── useSpectrogram.js      # Main spectrogram logic
│   └── useVideoRecorder.js    # Video recording logic
└── public/
    ├── .nojekyll              # Disable Jekyll on GitHub Pages
    ├── CNAME                  # Custom domain
    ├── icon-m.png             # 192x192 icon
    ├── icon-s.png             # 48x48 icon
    ├── icon.png               # 512x512 icon
    ├── logo.png               # 1600x1600 logo
    ├── logo.svg               # SVG logo
    ├── manifest.json          # PWA manifest
    ├── screenshot-n.jpg       # Narrow screenshot (720x1280)
    ├── screenshot-w.png       # Wide screenshot (1280x720)
    ├── spectrogram.png        # OG image
    └── sw.js                  # Service worker
```

### Entry Points

- **HTML**: `index.html` → mounts `#app`
- **JS**: `index.html` script → imports `App.vue`
- **Vue**: `App.vue` → uses `useSpectrogram()` composable

---

## PWA Configuration

### manifest.json Key Fields

| Field | Value | Description |
|-------|-------|-------------|
| id | chromatone-spectrogram | App ID |
| name | Chromatone Spectrogram | Full name |
| short_name | Spectrogram | Short name |
| start_url | / | Entry point |
| background_color | #000000 | Splash screen background |
| theme_color | #000000 | Browser UI theme |
| display | standalone | Display mode |
| orientation | any | Screen orientation |
| display_override | window-controls-overlay, minimal-ui, standalone | Preferred display modes |

### Icons

| Size | Type | Purpose |
|------|------|---------|
| any | SVG | Scalable (logo.svg) |
| 1600x1600 | PNG | High-res (logo.png) |
| 512x512 | PNG | Standard (icon.png) |
| 192x192 | PNG | Medium (icon-m.png) |
| 48x48 | PNG | Small (icon-s.png) |

### index.html Meta Tags

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="theme-color" content="black">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-touch-fullscreen" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Spectrogram">
```

### Service Worker Strategy

**Cache name**: `spectrogram-v.0.3.2-a`

**Cached assets**:
- `/`
- `/index.html`
- `/logo.svg`

**Strategy**: Cache-first (stale-while-revalidate not implemented)

**Activation**: Deletes old caches, claims clients immediately

```javascript
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      return cachedResponse || fetch(event.request)
    })
  );
});
```

---

## WebGL Shader Reference

### Vertex Shader

```glsl
#version 300 es
in vec2 p;
out vec2 uv;
void main(){uv=p*.5+.5;gl_Position=vec4(p,0,1);}
```

### Fragment Shader

**Uniforms**:
- `tex` — Ring buffer texture (sampler2D)
- `writeRow` — Current write position (int)
- `rows` — Texture height (int)
- `steep` — Sigmoid steepness (float)
- `midpoint` — Sigmoid threshold (float)
- `vert` — Vertical mode flag (int)
- `p3` — Display P3 flag (int)

**Processing pipeline**:
1. Sample texture with ring buffer scroll offset
2. Apply pink noise correction (2dB/octave)
3. Apply sigmoid contrast
4. Calculate hue from frequency (semitones * 30deg)
5. Apply Display P3 saturation boost
6. Convert HSL to RGB
7. Output with alpha=1

---

## Build Process

### Development

```bash
pnpm dev      # Vite dev server on port 3542
```

### Production

```bash
pnpm build    # Single-file HTML build
```

**Build steps**:
1. Vue SFC compilation
2. UnoCSS extraction and generation
3. vite-plugin-singlefile inlines all assets
4. Custom build script injects:
   - Analytics script (stats.chromatone.center)
   - Service worker registration

### Single-File Strategy

All CSS, JS, and assets are inlined into a single `index.html` for:
- Easy deployment (single file to host)
- Offline capability (no external requests)
- GitHub Pages compatibility

---

## Performance Notes

### Memory Usage

- **Runtime**: ~9MB (excluding recording buffer)
  - Canvas: ~8MB (RGBA backing store)
  - Texture: ~706KB (LUMINANCE, 1120x631)
  - Bands: ~9KB (Float32Array + Uint16Array×2)
  - FFT data: ~32KB (Float32Array)
- **Recording buffer**: ~200MB for 10s at 1080p (unbounded)

### Rendering Performance

- **GPU-bound**: Single texture upload + draw call per frame
- **Previous CPU-bound**: 1,300 fillRect operations per frame
- **Speedup**: ~10x faster rendering

### Optimization Techniques

- Typed arrays for band data (reduced GC pressure)
- Cached uniform locations (reduced GL state changes)
- Ring buffer scrolling (zero-copy via UV offset)
- All per-pixel processing in GPU shader

---

## Browser Compatibility

### WebGL2

- **Required**: WebGL2 context
- **Fallback**: None (app requires WebGL2)
- **Texture format**: LUMINANCE/UNSIGNED_BYTE (universal support)

### Web Audio API

- **Required**: AudioContext, AnalyserNode
- **Microphone**: getUserMedia with audio constraints
- **Echo cancellation**: Disabled (for accurate analysis)

### Video Recording

| Browser | Codec | MIME Type |
|---------|-------|-----------|
| Safari | H.264/AAC | video/mp4;codecs=h264,aac |
| Chrome/Firefox | VP9/Opus | video/webm;codecs=vp9,opus |
| Fallback | Default | video/webm |

### PWA Support

- **Service Worker**: Cache-first strategy
- **Display Modes**: window-controls-overlay, minimal-ui, standalone
- **Orientation**: Any (auto-rotate)

---

## Debugging

### Console Logs

- **Shader compilation errors**: Logged on compile failure
- **Microphone denial**: Logged on getUserMedia rejection
- **Service worker**: Logs registration success/failure

### Debug Mode

No explicit debug mode toggle. Remove/comment logs for production.

### Common Issues

- **Black canvas**: Check WebGL2 support, shader compilation
- **No audio**: Check microphone permissions, audio context state
- **Recording artifacts**: Check preserveDrawingBuffer flag
- **Subpixel gaps**: Ensure Math.round() on drawImage coordinates

---

## Deployment

### GitHub Pages

- **Branch**: Tags only (`v*`)
- **Source**: `./dist` directory
- **CNAME**: spectrogram.chromatone.center
- **Workflow**: `.github/workflows/deploy.yml`

### Environment Variables

None required. All configuration in code.
