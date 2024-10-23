<script setup>
import { ref, onMounted, watch } from 'vue'
import { onKeyStroke, useFullscreen, useStorage, useTimestamp, useWindowSize } from '@vueuse/core'
import { useClamp } from '@vueuse/math';
import { AudioMotionAnalyzer } from 'audiomotion-analyzer'
import ControlRotary from './ControlRotary.vue';

let canvas, ctx, tempCanvas, tempCtx, audio

const screen = ref()
const canvasElement = ref()
const video = ref()

const { toggle, isSupported } = useFullscreen(screen)

const paused = ref(false)
const recording = ref(false)
const videoRecording = ref(false)
const recordedWidth = ref(0)
const showVideo = ref(false)
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

const startVideo = () => {
  console.log('hello')
  videoRecording.value = Date.now()

  recorder = new MediaRecorder(video.value.srcObject)

  recorder.ondataavailable = (event) => {
    const blob = event.data;
    const url = URL.createObjectURL(blob);

    // Create a new window to display the video
    const newWindow = window.open('', '_blank', `width=${width.value},height=${height.value + 1}`);
    newWindow.document.write(`
      <html style="overscroll-behavior: none;"><body style="margin:0; background: black;  position: relative">
        <button onclick="saveVideo()" style="position: absolute; top: 1em; left: 1em; font-size: 3em;">Download video</button>
        <video controls autoplay >
            <source src="${url}" type="video/mp4">
        </video>
      </body></html>
    `);

    newWindow.saveVideo = () => {
      const a = newWindow.document.createElement('a');
      a.href = url;
      a.download = 'recorded_video.mp4';
      a.click();
      URL.revokeObjectURL(url);
    };
  };
  recorder.start()
}

const stopVideo = () => { videoRecording.value = false; recorder?.stop() }

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
  const filename = `spectrogram_${new Date().toISOString().slice(0, 19).replace(/T/, '_')}.png`;
  offscreenCanvas.toBlob((blob) => {
    const blobUrl = window.URL.createObjectURL(blob);
    // window.open(blobUrl, '_blank');
    const newWindow = window.open(undefined, '_blank');
    if (newWindow) {
      newWindow.document.write(`
        <html>
          <head>
            <title>${filename}</title>
          </head>
          <body style="margin: 0; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #222222;">
            <img src="${blobUrl}" alt="${filename}" style="cursor: pointer; max-width: 100%; max-height: 100vh; object-fit: contain;" onclick="const a = document.createElement('a'); a.href = '${blobUrl}'; a.download = '${filename}'; document.body.appendChild(a); a.click();">
          </body>
        </html>
      `);
    }
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

onKeyStroke('Enter', (e) => { e.preventDefault(); clear(); })

</script>

<template lang="pug">
.flex.flex-col.justify-center.bg-black.relative.w-full.items-center
  .fullscreen-container#screen(ref="screen")
    canvas#spectrogram.max-w-full(
      @pointerdown="paused = !paused"
      ref="canvasElement"
      :width="width"
      :height="height"
      )
    button.absolute.m-auto.top-0.w-full.h-full.text-white.text-2xl(
      title="Press anywhere to start"
      v-if="!initiated" 
      @click="initiate()") START

  .flex.absolute.top-4.z-100.text-white.op-20.hover-op-100.transition(v-if="initiated")
    button.text-xl.select-none.cursor-pointer(@pointerdown="paused = !paused")
      .i-la-play(v-if="paused")
      .i-la-pause(v-else)
    button.text-xl.select-none.cursor-pointer(@pointerdown="vertical = !vertical")
      .i-la-arrow-left(v-if="!vertical")
      .i-la-arrow-down(v-else)
    button.text-xl.select-none.cursor-pointer(@pointerdown="clear()")
      .i-la-trash-alt
    button.text-xl.select-none.cursor-pointer(
      v-if="isSupported"
      @pointerdown="toggle()")
      .i-la-expand

  .flex.absolute.bottom-2.mx-auto.z-100.text-white.op-20.hover-op-100.transition(v-if="initiated")
    button.text-xl.select-none.cursor-pointer.transition(
      :style="{ opacity: showVideo ? 1 : 0.5 }"
      @pointerdown="showVideo = !showVideo; showVideo && video?.requestPictureInPicture?.()")
      .i-la-external-link-square-alt
    button.text-xl.select-none.cursor-pointer.flex.items-center.gap-1(
      :class="{ 'text-red': recording }"
      @pointerdown="recording ? stopRecording() : startRecording()")
      .i-la-circle(v-if="!recording")
      .i-la-dot-circle(v-else)
      .p-0.text-sm.font-mono(v-if="recording && recordedWidth") {{ recordedWidth }}px ({{ ((time - recording) / 1000).toFixed(1) }}s)
    button.text-xl.select-none.cursor-pointer.flex.items-center.gap-1(
      :class="{ 'text-red': videoRecording }"
      @pointerdown="!videoRecording ? startVideo() : stopVideo()")
      .i-la-video
      .p-0.text-sm.font-mono(v-if="videoRecording") {{ ((time - videoRecording) / 1000).toFixed() }}s


  .absolute.my-auto.left-2.flex.flex-col.text-white.items-center.overscroll-none.overflow-x-hidden.overflow-y-scroll.bg-dark-900.bg-op-20.backdrop-blur.op-40.hover-op-100.transition.max-h-100vh.overflow-y-scroll.scrollbar-thin.rounded-xl.p-2(v-show="initiated" style="scrollbar-width: none;") 
    .is-group.flex.flex-col.gap-2
      ControlRotary(v-model="speed" :min="1" :max="5" :step="1" :fixed="0" param="SPEED")
      ControlRotary(v-model="frame" :min="1" :max="4" :step="1" :fixed="0" param="FRAME")
      ControlRotary(v-model="steepness" :min="3" :max="30" :step="0.0001" :fixed="2" param="CONTRAST")
      ControlRotary(v-model="midpoint" :min="0" :max="1" :step=".0001" param="MIDPOINT" :fixed="2")
      ControlRotary(v-model="smoothing" :min="0" :max="1" :step=".0001" param="SMOOTH" :fixed="2")


  .fixed.overflow-clip.text-white.transition.bottom-22.rounded-xl.overflow-hidden.rounded-xl.border-1(v-show="showVideo")
    .relative.mx-auto
      .absolute.p-4.opacity-70.touch-none.select-none.text-md.mr-10 Right click here to enter Picture-In-Picture mode
      video.max-h-80.max-w-full(ref="video")
    button.absolute.top-2.right-2(@click="showVideo = false")
      .i-la-times
</template>

<style lang="postcss" scoped>
button {
  @apply p-4;
}

#screen {
  @apply bg-black;
  width: 100%;
  min-width: 320px;
  min-height: 100vh;
  line-height: 1.3;
  font-family: "Commissioner", -apple-system, BlinkMacSystemFont, "Segoe UI",
    Roboto, Oxygen, Ubuntu, Cantarell, "Fira Sans", "Droid Sans",
    "Helvetica Neue", sans-serif;
  font-size: 1em;
  font-weight: 400;
  color: var(--c-text);
  direction: ltr;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  transition: all 600ms ease;
  overscroll-behavior-y: none;
}
</style>