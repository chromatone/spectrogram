import { ref, onMounted, watch, reactive } from 'vue'
import { onKeyStroke, useStorage, useTimestamp, useWindowSize } from '@vueuse/core'
import { useClamp } from '@vueuse/math';
import { AudioMotionAnalyzer } from 'audiomotion-analyzer'

export function useSpectrogram() {
  let canvas, ctx, tempCanvas, tempCtx, audio

  const screen = ref()
  const canvasElement = ref()
  const video = ref()

  const paused = ref(false)
  const recording = ref(false)
  const videoRecording = ref(false)
  const recordedWidth = ref(0)

  const initiated = ref(false)
  const vertical = useStorage('vertical', false)

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

  const smoothing = useClamp(useStorage('smoothing', 0.5), 0, 0.9)
  const frame = useClamp(useStorage('frame', 2), 1, 4)
  const speed = useClamp(useStorage('speed', 1), 1, 4)
  const steepness = useClamp(useStorage('steepness', 10), 3, 30)
  const midpoint = useClamp(useStorage('midpoint', 0.5), 0, 1)

  watch(frame, f => audio && (audio.fftSize = Math.pow(2, 11 + f)))
  watch(smoothing, s => audio && (audio.smoothing = s))

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
        smoothing: smoothing.value,
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

  let recorder

  const startVideo = async () => {
    videoRecording.value = Date.now()
    const videoStream = video.value.srcObject
    const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

    const combinedStream = new MediaStream([...videoStream.getTracks(), ...audioStream.getTracks()]);


    recorder = new MediaRecorder(combinedStream)

    recorder.ondataavailable = (event) => {
      const blob = event.data;
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
    };
    recorder.start()
  }

  const stopVideo = () => { videoRecording.value = false; recorder?.stop() }

  const pics = reactive([])

  let offscreenCanvas, offscreenCtx

  const startRecording = () => {
    offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = speed.value;
    offscreenCanvas.height = height.value;
    offscreenCtx = offscreenCanvas.getContext('2d');
    recording.value = Date.now();
    recordedWidth.value = speed.value;
  };

  const stopRecording = () => {
    recording.value = false;
    offscreenCanvas.toBlob((blob) => {
      pics.push(window.URL.createObjectURL(blob))
    }, 'image/png');
  };

  let recTemp, recCtx

  const time = useTimestamp()

  const recordFrame = () => {

    recTemp = recTemp || document.createElement('canvas')
    recCtx = recCtx || recTemp.getContext('2d')

    const newWidth = recordedWidth.value + speed.value

    recTemp.width = newWidth
    recTemp.height = offscreenCanvas.height
    recCtx.drawImage(offscreenCanvas, 0, 0)
    offscreenCanvas.width = newWidth
    offscreenCtx.drawImage(recTemp, 0, 0)

    offscreenCtx.drawImage(
      canvas,
      width.value - speed.value, 0,
      speed.value, height.value,
      recordedWidth.value, 0,
      speed.value, height.value
    )

    recordedWidth.value = newWidth
  };

  const freqPitch = (freq) => 12 * Math.log2(Number(freq) / 440);
  const colorFreq = (freq, value) => `hsl(${freqPitch(freq) * 30}, ${value * 100}%, ${value * 75}%)`;
  const sigmoid = (value) => 1 / (1 + Math.exp(-steepness.value * (value - midpoint.value)));

  const onCanvasDraw = (instance) => {
    if (paused.value) return;

    tempCtx.drawImage(canvas, 0, 0, width.value, height.value, 0, 0, width.value, height.value);

    const bars = instance.getBars().map(bar => colorFreq(bar.freq, sigmoid(bar.value[0])));

    const barWidth = width.value / bars.length;
    const barHeight = height.value / bars.length;

    bars.forEach((barColor, i) => {
      const [x, y, w, h] = vertical.value
        ? [i * barWidth, 0, barWidth, speed.value]
        : [width.value - speed.value, height.value - (i + 1) * barHeight, speed.value, barHeight];
      ctx.fillStyle = barColor;
      ctx.fillRect(x, y, w, h);
    });

    ctx.translate(vertical.value ? 0 : -speed.value, vertical.value ? speed.value : 0);
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

  onKeyStroke(' ', (e) => { e.preventDefault(); paused.value = !paused.value })

  onKeyStroke('Enter', () => clear())

  function download(url) {
    const a = document.createElement('a');
    a.href = url;
    a.download = `spectrogram_${new Date().toISOString().slice(0, 19).replace(/T/, '_')}.png`
    document.body.appendChild(a);
    a.click();
  }

  return {
    initiate, startRecording, stopRecording, pics, startVideo, stopVideo, clear, download, time, screen, canvasElement, video, paused, recording, videoRecording, recordedWidth, smoothing, speed, midpoint, initiated, vertical, width, height, frame, steepness
  }
}


