# Chromatone Spectrogram

![Colorized spectrogram](https://raw.githubusercontent.com/chromatone/spectrogram/refs/heads/main/public/spectrogram.png)

## Real-time musical spectrogram for your browser

A zero-dependency, scientifically-grounded audio visualization tool built for musicians, researchers, and audio engineers. Displays audio as a colorized 12-TET (12-tone equal temperament) spectrogram with perceptually accurate frequency representation.

**Features:**
- **12-TET frequency mapping** — Musical notes (A0 to C9) mapped to exact semitone bands
- **Pink noise correction** — +3dB/octave compensation in dB space for perceptually flat display
- **High-resolution analysis** — Configurable FFT size (4096-16384) for precise frequency resolution
- **Signal-to-noise control** — Sigmoid-based threshold and steepness adjustments
- **Recording & capture** — Video recording and screenshot capabilities
- **PWA support** — Install as a standalone app, works offline
- **Zero external audio dependencies** — Pure Web Audio API implementation

## How it works

The spectrogram uses the Web Audio API's `AnalyserNode` with custom 12-TET band mapping:

1. **FFT analysis** — Raw frequency data captured via `getFloatFrequencyData()`
2. **12-TET band integration** — FFT bins summed into musical semitone bands (10 sub-bands per semitone)
3. **Pink noise correction** — +3dB/octave added in dB space to compensate for 1/f spectral slope
4. **Sigmoid processing** — Signal-to-noise ratio control via midpoint and steepness parameters
5. **Chromatic color mapping** — HSL colors based on pitch class

The pink noise correction ensures that natural/musical signals (which typically follow a 1/f spectrum) appear perceptually flat across the frequency range.

## Controls

- **FFT Size** — 12-14 (4096-16384) — Higher values improve low-frequency resolution
- **Smooth** — 0-1 — Temporal smoothing of the analyzer
- **Speed** — 1-4 — Scrolling speed of the spectrogram
- **Midpoint** — 0-1 — Sigmoid threshold for signal visibility
- **Steep** — 3-30 — Sigmoid steepness for noise floor control

## Tech Stack

- **Vue 3** — Reactive UI framework
- **Vite** — Build tool and dev server
- **UnoCSS** — Utility-first CSS
- **Web Audio API** — Native browser audio processing (no external audio libraries)

## Installation

```bash
# Clone the repository
git clone https://github.com/chromatone/spectrogram.git
cd spectrogram

# Install dependencies
pnpm install

# Run development server
pnpm dev

# Build for production
pnpm build
```

## Usage

1. Open the app in a modern browser
2. Grant microphone access when prompted
3. Adjust controls to fine-tune the visualization
4. Use the camera button to capture screenshots
5. Use the video button to record the spectrogram

## Musical Range

- **A0** — 27.5 Hz (lowest piano key)
- **C9** — 15,870 Hz (highest piano key + 1 octave)

The spectrogram covers the full piano range plus one octave above, suitable for most musical analysis.

## License

MIT