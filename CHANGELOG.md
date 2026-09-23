# Chromatone Spectrogram Changelog

## v0.7.1 (2026-09-23) - Correct Compressed-Time Density Rendering

### ✨ Added
- **Interval-Integrated Time Compression**: The shader now calculates the actual time interval represented by each screen fragment and integrates the ring-buffer texture across that interval. This replaces fragile point sampling in compressed regions and dramatically reduces far-tail flickering.
- **Dual-Channel Sediment Texture**: The history texture was upgraded from `R16F` to `RG16F`. The red channel stores the total visible band value, while the green channel stores transient detail.
- **Transient / Sustained Separation**: Added a lightweight temporal model that separates fast percussive detail from slower sustained harmonic energy.
- **Deep-Time Transient Fade**: In the far compressed tail, transient-rich detail such as high-hats, clicks, and snares now fades into the background, while sustained harmonic architecture remains visible.
- **Boundary-Safe Time Filtering**: The new temporal integration clamps its sampling window so it does not cross the newest/oldest seam of the ring buffer, preventing wrap-around shimmer.

### 🔄 Changed
- **Far Tail Rendering Model**: Compressed history is now treated as temporal density rather than a simple scrolled texture. Short events naturally become fainter when compressed into sub-pixel time intervals.
- **Near-Field Sharpening Preserved**: When the represented time interval is small, the shader still uses the sharp 5-tap ridge-aware pass. In heavily compressed regions, it switches to stable interval integration.
- **History Buffer Size**: The desired history depth was increased from 8 screen-heights to 12 screen-heights, while remaining capped by the GPU’s `MAX_TEXTURE_SIZE`.
- **Time Compression Limit**: The maximum `timeCompress` value was tuned to `3.1` to remain safely inside the shader’s `24`-tap filtering budget.

### 🚀 Performance
- **Adaptive Filtering Cost**: The expensive multi-tap pass is only used where compression actually requires it. The near field remains on the cheaper sharpening path.
- **No Additional Render Passes**: Density accumulation happens inside the existing single-pass fragment shader.
- **Efficient Transient Model**: The sustain/transient split runs as an `O(numBands)` per-frame update and does not require extra GPU textures.

### 🐛 Fixed
- Reduced flickering in the far sediment tail at high time compression and low scroll speeds.
- Reduced sub-pixel shimmer caused by sampling many compressed time rows as a single texture coordinate.
- Reduced harsh visibility of distant percussive detail, allowing long-term harmonic structure to remain readable.
- Reduced seam artifacts near the newest/oldest boundary of the ring buffer.

### 🔭 Next Direction
- For even higher compression values, the next step is a temporal pyramid / mipmap-style history system. This would allow much deeper time intervals to be averaged without requiring many shader taps, enabling longer visible song structures with stable sediment layers.

## v0.7.0 (2026-09-22) - Architectural Clarity & Deep Sediment Vision

### ✨ Added
- **Sub-Pixel Parabolic Peak Recovery**: Added parabolic interpolation around the strongest FFT bin in each band. This recovers energy that falls between discrete FFT bins, making low notes narrower, high harmonics more legible, and pitch bends smoother.
- **Spectral Envelope Contrast**: Introduced a broad local-maximum spectral envelope estimator in the dB domain. The envelope is used to reduce cloudy formant/room haze while preserving sharp harmonic peaks, improving separation between simultaneous notes.
- **Soft-Threshold Sparsification**: Added a wavelet-style soft threshold in the fragment shader. Low-level FFT haze is now pushed toward true black without harsh gating, giving sediment layers cleaner edges and improving micro-contrast.
- **2D Ridge-Aware Sharpening**: Upgraded the shader sharpening from a simple 1D unsharp mask to an anisotropic 5-tap Laplacian model. Frequency ridges are sharpened strongly, while a smaller amount of temporal sharpening helps transients and pitch bends remain crisp without excessive ringing.
- **Clarity Constants**: Added internal science constants for tuning the new clarity pipeline: `PARABOLIC_PEAK_BLEND`, `ENVELOPE_CONTRAST`, `ENVELOPE_RADIUS`, `SOFT_THRESHOLD`, `RIDGE_SHARPEN`, and `TEMPORAL_SHARPEN`.

### 🔄 Changed
- **Clarity Pipeline Order**: The audio pipeline now follows a more coherent perceptual flow:
  1. FFT energy integration
  2. Sub-pixel peak recovery
  3. A-weighting and pre-emphasis
  4. Broad spectral envelope contrast
  5. Lateral inhibition
  6. Dynamic range normalization
  7. Framerate-independent temporal integration
- **Shader Sharpening Model**: Replaced the older frequency-only sharpening model with a 2D-aware sharpening model. This improves clarity for both sustained harmonic ridges and fast diagonal transients.
- **Noise Gate Behavior**: The visual noise gate is now complemented by soft-threshold sparsification, producing cleaner silence between notes while preserving quiet harmonic details.
- **Chromatone Color Philosophy Preserved**: HSL mapping remains intentionally untouched. The natural brightness character of each hue is preserved because it supports note identity, emotional association, and Chromatone learning.

### 🚀 Performance
- **No Extra Render Passes**: All new clarity features run within the existing JS audio pipeline and single WebGL draw call.
- **Efficient Local DSP**: Spectral envelope estimation uses a small localized band neighborhood and remains cheap enough for real-time use.
- **Branchless GPU Math**: The new shader clarity operations avoid dynamic branching and remain extremely lightweight.

### 🎓 Qualitative Impact
- Low notes become tighter and more pitch-resolvable.
- High harmonics become more readable and structurally coherent.
- Fast transients remain visible but less muddy.
- With exponential time compression, longer musical structures begin to read as visual architecture rather than merely scrolling color.
- The overall experience moves closer to a readable sedimentary record of sound.

### 🐛 Fixed
- Reduced spectral stair-stepping caused by discrete FFT bin placement.
- Reduced broadband haze and cloudy formant smearing.
- Reduced gray noise-floor wash that previously lowered layer separation.
- Reduced blur on pitch-bending harmonics by making sharpening aware of both frequency and time axes.

### 🔭 Known Edge Case / Next Direction
- At extreme settings such as `timeCompress = 3.0` and very low scroll speeds, the far compressed tail can exhibit subtle flickering. This happens because deeply compressed time layers can become sub-pixel.
- The intended future direction is **opacity-based sediment accumulation**: far history should be integrated as time-density rather than sampled as a single thin slice. Sustained harmonic structures should remain prominent, while fast percussive details should gracefully fade into the architectural background.

## v0.6.4 (2026-09-22) - Exponential Time Compression & Deep History

### ✨ Added
- **Exponential Time Compression**: Introduced a new `timeCompress` parameter that applies a non-linear time mapping to the rolling spectrogram. By using an exponential curve with a derivative of exactly `1.0` at the origin, the visual speed at the center remains identical to the linear mode, while older audio layers smoothly decelerate and compress towards the edges to reveal longer historical patterns.
- **Expanded GPU Ring Buffer**: To support the compressed outer edges and prevent wrapping/repeating recent frames, the WebGL ring buffer texture is now dynamically expanded (up to 8x the screen height, capped at the hardware's `MAX_TEXTURE_SIZE`) to store a significantly deeper history of audio data.
- **Linear Fallback**: The new time compression dial (0.0 to 3.0) gracefully falls back to the classic linear scrolling mode when set to `0.0`, allowing users to seamlessly toggle between deep-history and real-time views.

### 🚀 Performance
- **Branchless Shader Math**: Implemented the exponential time mapping using a branchless `max(k, 0.001)` approach in the GLSL fragment shader. This avoids costly `if/else` branching and division-by-zero errors, maintaining flawless GPU performance and avoiding any framerate drops.


## v0.6.3 (2026-08-16) - Weighing and correct calculations

### 🚀 Performance
- **Sparse Gaussian Precomputation**: Precompute and normalize Gaussian integration weights during initialization. This eliminates expensive `Math.exp` and `Math.pow` calls from the 60fps `processFFT` loop, significantly reducing CPU overhead.

### ✨ Added
- **Framerate-Independent Smoothing**: Temporal integration now uses `performance.now()` to calculate true time constants (`tau`). The spectrogram's decay and smoothing behavior is now perfectly consistent across 60Hz, 120Hz, 144Hz, and variable-refresh-rate displays.
- **Active Perceptual Weighting**: Integrated the previously unused A-weighting (`a(f)`) function to accurately approximate human ear frequency sensitivity during energy integration.

### 🔄 Changed
- **Mathematical Domain Correction**: Moved perceptual weighting, pre-emphasis (dB/oct), and lateral inhibition into the true **dB domain** *before* dynamic range normalization. This fixes previous unit mismatches where linear offsets were incorrectly applied to normalized `0..1` values in the shader.
- **Simplified Fragment Shader**: Removed redundant frequency-domain math (formant lift, high roll-off, heavy unsharp mask) from the GLSL shader. The shader now focuses purely on clean visual mapping, relying on the mathematically accurate JS pipeline for perceptual shaping.

### 🐛 Fixed
- **Visual "Coarse Static"**: Eliminated harsh, flickering edges and double-contrast artifacts caused by applying spectral contrast in both the frequency domain (JS) and spatial domain (GLSL unsharp mask).
- **Tab-Switching Jumps**: Capped `deltaTime` calculations at 100ms to prevent massive, unnatural smoothing decay spikes when returning to a backgrounded browser tab.


## v0.6.1 (2026-07-21) - Praat-style Definition & Coherent Perceptual Pipeline

### Added
- **Fractional Speed Scrolling:** Support for speeds between 0.1x and 4x. Uses a float accumulator in JS and a sub-pixel `scroll` uniform in the GPU to smoothly stretch or compress time without jitter.
- **Temporal Frame Interpolation:** When `speed > 1`, intermediate GPU rows are linearly interpolated between the previous and current audio frames, eliminating the blocky "stepping" artifact common in fast spectrograms.
- **5-Tap Unsharp Masking:** Added `texelSize` uniform and a branchless 5-tap edge enhancement in the fragment shader to extract hyper-crisp harmonic ridges.
- **Topographic Isobars:** Subtle contour lines generated via `fract()` in the shader, mimicking scientific topographical maps to visually flatten smudges.
- **Gamma Lightness & Smooth Noise Gate:** Replaced harsh threshold cuts with a `smoothstep` noise gate and applied a `0.8` gamma curve to lift quiet details out of the black without oversaturating peaks.

### Changed
- **Perceptual dB Pipeline:** Switched the entire audio pipeline from linear amplitude to a logarithmic 0..1 dB scale. Quieter harmonics are now preserved without blowing out the highs.
- **Peak-Picking Spectral Gathering:** `processFFT` now takes the `Math.max` dB value per band instead of averaging, preserving narrow formants and preventing spectral smearing.
- **Unified Perceptual Contour:** Replaced the toggled A-weighting/pink-noise offsets with a built-in physiological contour (+3dB pre-emphasis >300Hz, formant lift, high roll-off) that safely balances the spectrum without crushing bass fundamentals.
- **Tighter Temporal Smoothing:** Narrowed the cochlear integration `bandAlpha` range (0.2 to 0.5) to prevent high-frequency "static speckling" while maintaining transient response.
- **Recording Performance:** Heavily optimized the `recordFrame` function to stop recreating the offscreen canvas every frame, fixing recording lag.

### Removed
- **Weighting Control:** Removed the `weighting` parameter and uniform. The system now operates as a single, coherent perceptual model without needing user intervention.
- **A-weighting Approximation:** Removed the complex `aWeightDb` GPU function in favor of the cheaper, more coherent Unified Perceptual Contour.


## v.0.6.0 (2026-07-20) 

Added four new knobs (hidden as they are all super-viable in our context to be on), all cheap (same order of cost as what you already had — a handful of scalar ops per band or per fragment, no new textures or passes):

weighting (0→1) — blends your existing pink-noise/tilt correction with a compact A-weighting-style equal-loudness curve, computed per-fragment in the shader from bandFreq you already derive there. At 0 you get today's look; at 1, bands the ear is naturally less sensitive to (sub-bass, extreme treble) dim relative to the 2–4kHz range, so brightness tracks perceived loudness rather than raw energy.

auditory (0→1) — blends your constant-Q semitone bandwidth with a real cochlear ERB (Equivalent Rectangular Bandwidth) filter width per band. ERB is nearly flat (~24Hz) in the bass and only grows proportionally at higher frequencies — the opposite of constant-Q, which is proportional everywhere. This reshapes the effective frequency resolution to match how the basilar membrane actually resolves pitch, especially widening/blurring low bass bands realistically. It's CPU-side and only recomputed on band regen (fftSize change or a watcher on this knob), never per-frame.

integration (0→1) — adds frequency-dependent temporal smoothing: bass bands integrate slowly (long time constant, like the cochlea's sluggish low-frequency response), treble bands update fast (catches clicks/transients crisply). At 0 it's bit-identical to your current instantaneous per-frame behavior; the per-band alpha curve is precomputed once in generateBands(), so the per-frame cost is just one more O(numBands) pass — same complexity class as your existing FFT-averaging loop.

sharpen (0→1) — lateral inhibition / on-center-off-surround, like adjacent cochlear hair cells suppressing their neighbors. Each band is pushed away from the average of its two neighbors, sharpening simultaneous partials into crisper ridges instead of a soft blob. Also O(numBands), no extra buffers beyond one more typed array.

Kept intact exactly as asked:

- Chromatone hue mapping (hue = semitones/12 from A0) — A is still red, untouched.
- The demoscene-minimal shader style — one new uniform, one small helper function, no branching added to the hot path.
- Ring-buffer texture scrolling, sigmoid contrast, P3 saturation boost — all unchanged.

Also fixed a dormant bug: the barFrequencies watcher referenced an undefined bands variable (harmless today since the guard was never true, but would've thrown if that ever changed).

One tuning note: integration and sharpen interact with your existing smooth (the AnalyserNode's native smoothingTimeConstant) — you'll likely want smooth fairly low now and let the new per-band integration do the frequency-aware work instead, since it's more anatomically accurate than one global constant.



## v0.5.0 (2026-05-25)

### New features:

- WebGL2 rendering with GPU-accelerated ring buffer texture
- Pink noise correction (2dB/octave) applied in GPU shader
- Display P3 color gamut detection with saturation boost
- High-quality video recording with codec selection (VP9/Opus for Chrome/Firefox, H.264/AAC for Safari)
- Memory optimization: bands flattened to typed arrays (~9KB vs ~200KB)

### Improvements:

- 10x faster rendering: single texture upload + draw call vs 1,300 fillRect operations
- Zero-copy scrolling via texture UV offset (no canvas pixel copying)
- All per-pixel processing (sigmoid, color mapping, pink noise) moved to GPU
- Runtime memory reduced to ~9MB (excluding recording buffer)

### Technical changes:

- Replaced Canvas 2D with WebGL2 + custom fragment shader
- Ring buffer texture with WRAP_T=REPEAT for seamless scrolling
- LUMINANCE/UNSIGNED_BYTE texture format for universal compatibility
- Cached uniform locations for reduced GL state changes

## v0.4.0 (2026-05-25)

### Breaking changes:

- Replaced AudioMotionAnalyzer with custom 12-TET implementation (zero external audio dependencies)

### New features:

- Custom 12-TET frequency mapping with exact semitone bands
- Pink noise correction: +3dB/octave in dB space for perceptually flat display
- Scientifically-grounded frequency compensation (1/f spectrum correction)
- Simplified control set: fftSize, smooth, speed, midpoint, steep

## v0.3.0 (2024-11-07)

### New feature:

- offline first PWA([`a8354e4`](https://github.com/chromatone/spectrogram/commit/a8354e42520cbc76ad3f9e152a3aeedd9b8e9b46)) (by davay)
- no jekyll build on github pages publish([`c0bfa94`](https://github.com/chromatone/spectrogram/commit/c0bfa9405a45472fef5ded24196056208bfd7c56)) (by davay)

## v0.2.4 (2024-11-05)

### New feature:

- download video too([`5aef100`](https://github.com/chromatone/spectrogram/commit/5aef100127db2cfc704229de68e1178bf2af75fa)) (by davay)
- fresh deps([`84e53ae`](https://github.com/chromatone/spectrogram/commit/84e53ae9f5ac06ed51d9dd59eeeb05c86e67a2ca)) (by davay)
- iOS icons([`7a46d52`](https://github.com/chromatone/spectrogram/commit/7a46d52f58f17b8384e1f24b401265c0c2557a58)) (by davay)
- cleaner reactive UI structure([`342a183`](https://github.com/chromatone/spectrogram/commit/342a18314184ab684cf6c7b230c545abced05a23)) (by davay)
- iOS icon([`5b62531`](https://github.com/chromatone/spectrogram/commit/5b6253161aac7c8bd0d6d08ca5ad233f1148c789)) (by davay)

### Bugs fixed:

- better PWA support([`f097ac6`](https://github.com/chromatone/spectrogram/commit/f097ac63038f8c6c4fc0669983b262a48db00084)) (by davay)

## v0.2.3 (2024-11-05)

### New feature:

- leaner PWA([`6697a0d`](https://github.com/chromatone/spectrogram/commit/6697a0db8d9208d53043af2b6506b816adaf6efd)) (by davay)
- modular composables([`a28e5e7`](https://github.com/chromatone/spectrogram/commit/a28e5e7f121d15c425dc9615b2a7397c6e21075b)) (by davay)

## v0.2.2 (2024-11-05)

### New feature:

- PWA ready build([`c945186`](https://github.com/chromatone/spectrogram/commit/c94518682bfedc3fc04d3738b0a1ef0e7029d938)) (by davay)
- useSpectrogram composable([`e79ef1e`](https://github.com/chromatone/spectrogram/commit/e79ef1e220e9cd7d7cc67c1877b6cb07f3908567)) (by davay)

## v0.2.1 (2024-10-30)

### New feature:

- record video with audio([`c125fe1`](https://github.com/chromatone/spectrogram/commit/c125fe1fe9674faa55ff47b0c70e32d1e5aebd4c)) (by davay)
- better stack explanaition([`6baeb90`](https://github.com/chromatone/spectrogram/commit/6baeb90e2029bcbf99307a69e098a1b472ff8ef9)) (by davay)

### Bugs fixed:

- iOS compatible pic saver([`8996037`](https://github.com/chromatone/spectrogram/commit/8996037867f2e798cb89ceca238a0cfd6e0fe39a)) (by davay)
- iOS file saving([`9186f51`](https://github.com/chromatone/spectrogram/commit/9186f51579a2ea96cfb99447ef15d1aed16c9522)) (by davay)

## v0.2.0 (2024-10-23)

### New feature:

- visible canvas + toggle video([`87c4beb`](https://github.com/chromatone/spectrogram/commit/87c4beb5f2be83b1f53815329aa2af0eda269b78)) (by davay)
- record video too([`d746055`](https://github.com/chromatone/spectrogram/commit/d74605515332a8a44c807305dc198114cc501c6a)) (by davay)
- dark app bar([`25d06cc`](https://github.com/chromatone/spectrogram/commit/25d06cca18cbe1619dfa79f317f464b7bdecdc1f)) (by davay)
- clean and fully set up songle file webapp([`c2092cc`](https://github.com/chromatone/spectrogram/commit/c2092ccd4b282dfd744a0ecc7a98a2007dc82ac6)) (by davay)

## v0.1.0 (2024-10-22)

### New feature:

- picture recording!([`10a14de`](https://github.com/chromatone/spectrogram/commit/10a14deb16f6b0bf1a9842ba5f38dd7e718fbd7d)) (by davay)
- better app UX([`3357328`](https://github.com/chromatone/spectrogram/commit/335732840087f972b940409f7ee2e6ee2186450b)) (by davay)
- changelog([`b96938d`](https://github.com/chromatone/spectrogram/commit/b96938d3ad1e33383957063c33867674eb247103)) (by davay)

## v0.0.2 (2024-10-21)

### New feature:

- well structured App code([`7ad6107`](https://github.com/chromatone/spectrogram/commit/7ad610792dd951c8dc3540594900c9c1657ecb58)) (by davay)
- auto deploy script([`dd299ff`](https://github.com/chromatone/spectrogram/commit/dd299fff9074ff3b562480919eab47b023d23020)) (by davay)
- minimalistic spectrogram app([`834435e`](https://github.com/chromatone/spectrogram/commit/834435edbbed46a361e6fea908f6975b98da5b96)) (by davay)