# Chromatone Spectrogram Changelog

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