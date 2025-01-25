import { ref, onMounted, watch, reactive } from 'vue'
import { useStorage, useWindowSize } from '@vueuse/core'
import { useClamp } from '@vueuse/math';
import { AudioMotionAnalyzer } from 'audiomotion-analyzer'

const params = {
  midpoint: { default: 0.5, min: 0, max: 1, step: 0.0001, fixed: 2 },
  steep: { default: 10, min: 3, max: 30, step: 0.001, fixed: 2 },
  smooth: { default: 0.5, min: 0, max: 1, step: 0.0001, fixed: 2 },
  frame: { default: 2, min: 1, max: 4, step: 1, fixed: 0 },
  speed: { default: 1, min: 1, max: 4, step: 1, fixed: 0 }
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
  let canvas, ctx, tempCanvas, tempCtx, audio

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

  watch(() => controls.frame, f => audio && (audio.fftSize = Math.pow(2, 11 + f)))
  watch(() => controls.smooth, s => audio && (audio.smooth = s))

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

  function freqPitch(freq) { return 12 * Math.log2(Number(freq) / 440) }
  function colorFreq(freq, value = 1) { return `hsl(${freqPitch(freq) * 30}, ${value * 100}%, ${value * 75}%)`; }
  function sigmoid(value) { return 1 / (1 + Math.exp(-controls.steep * (value - controls.midpoint))); }

  function initiate() {
    navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        autoGainControl: true,
        noiseSuppression: false,
      }, video: false
    }).then(async stream => {

      audio = new AudioMotionAnalyzer(null, {
        mode: 1,
        connectSpeakers: false,
        volume: 0,
        fftSize: 8192,
        smoothing: controls.smooth,
        useCanvas: false,
        onCanvasDraw,
      })

      const micStream = audio.audioCtx.createMediaStreamSource(stream)
      audio.connectInput(micStream)
      initiated.value = true
      video.value.play()
    }).catch((e) => {
      console.log('mic denied', e)
    })
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



  const onCanvasDraw = (instance) => {
    if (paused.value) return;

    tempCtx.drawImage(canvas, 0, 0, width.value, height.value, 0, 0, width.value, height.value);

    const bars = instance.getBars()

    const colors = bars.map(bar => colorFreq(bar.freq, sigmoid(bar.value[0])));

    if (!barFrequencies.value) barFrequencies.value = bars

    const barWidth = width.value / colors.length;
    const barHeight = height.value / colors.length;

    colors.forEach((barColor, i) => {
      const [x, y, w, h] = vertical.value
        ? [i * barWidth, 0, barWidth, controls.speed]
        : [width.value - controls.speed, height.value - (i + 1) * barHeight, controls.speed, barHeight];
      ctx.fillStyle = barColor;
      ctx.fillRect(x, y, w, h);
    });

    ctx.translate(vertical.value ? 0 : -controls.speed, vertical.value ? controls.speed : 0);
    ctx.drawImage(tempCanvas, 0, 0, width.value, height.value, 0, 0, width.value, height.value);
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    if (recording.value) {
      recordFrame()
    }
  };


  function clear() {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width.value, height.value)
  }

  return {
    initiate, startRecording, stopRecording, pics, colorFreq, clear, screen, canvasElement, video, paused, recording, recordedWidth, controls, params, initiated, vertical, width, height, barFrequencies
  }
}


