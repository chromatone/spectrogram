<script setup>
import { ref, computed, reactive, onMounted, watch, onUnmounted, watchEffect } from 'vue'
import { onKeyStroke, useCycleList, useStorage, useWindowSize } from '@vueuse/core'
import { useGesture } from '@vueuse/gesture';
import { AudioMotionAnalyzer } from 'audiomotion-analyzer'

import ControlRotary from './ControlRotary.vue';

import { initGetUserMedia, useClamp } from './utils'

let canvas, ctx, tempCanvas, tempCtx, audio

const { width, height } = useWindowSize()

const canvasElement = ref()
const video = ref()
const paused = ref(false)
const showVideo = ref(false)

const frame = useClamp(1, 1, 4)

watch(frame, f => audio && (audio.fftSize = Math.pow(2, 11 + f)))

const state = reactive({
  initiated: false,
  open: false,
  width,
  height,
  speed: useClamp(1, 1, 4),
  vertical: false,
})

watch([width, height], ([w, h]) => {
  if (!canvas && !tempCanvas) return
  state.width = canvas.width = tempCanvas.width = w
  state.height = canvas.height = tempCanvas.height = h
  clear()
})

onMounted(() => {
  initGetUserMedia()
  canvas = canvasElement.value
  ctx = canvas.getContext('2d')
  tempCanvas = document.createElement('canvas')
  tempCtx = tempCanvas.getContext('2d')
  tempCanvas.width = state.width
  tempCanvas.height = state.height
  clear()
  const stream = canvasElement.value.captureStream();
  video.value.srcObject = stream;
  video.value.play()
    .then(() => video.value?.requestPictureInPicture?.())
    .catch(error => console.error(error));
});

const smoothing = useClamp(0.5, 0, 0.9)

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
    state.initiated = true
    state.open = true

  }).catch((e) => {
    console.log('mic denied', e)
  })
}

const freqPitch = (freq) => 12 * (Math.log(Number(freq) / 440) / Math.log(2))

const colorIt = (freq, value) => `hsl(${freqPitch(freq) * 30}, ${value * 100}%, ${value * 75}%)`

const steepness = useClamp(10, 3, 30)
const midpoint = useClamp(0.5, 0, 1)
const sigmoid = (value) => 1 / (1 + Math.exp(-steepness.value * (value - midpoint.value)))

const onCanvasDraw = (instance) => {
  if (paused.value) return
  tempCtx.drawImage(canvas, 0, 0, state.width, state.height)
  let bars = instance.getBars()
  for (let i = 0; i < bars.length; i++) {
    const centerFreq = (bars[i].freqLo + bars[i].freqHi) / 2
    ctx.fillStyle = colorIt(centerFreq, sigmoid(bars[i].value[0]))

    if (state.vertical) {
      ctx.fillRect(i * (state.width / bars.length), 0, state.width / bars.length, state.speed)
    } else {
      ctx.fillRect(state.width - state.speed, state.height - (i + 1) * (state.height / bars.length), state.speed, state.height / bars.length)
    }
  }
  if (state.vertical) {
    ctx.translate(0, state.speed)
  } else {
    ctx.translate(-state.speed, 0)
  }
  ctx.drawImage(tempCanvas, 0, 0, state.width, state.height)
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function clear() {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, state.width, state.height)
}

onKeyStroke(' ', (e) => { e.preventDefault(); paused.value = !paused.value })

onKeyStroke('Enter', (e) => { e.preventDefault(); clear(); })

</script>

<template lang="pug">
.flex.flex-col.justify-center.bg-black
  .fullscreen-container.text-white#screen
    canvas#spectrogram.max-w-full(
      ref="canvasElement"
      :width="state.width"
      :height="state.height"
      )
    button.absolute.m-auto.top-0.w-full.h-full(
      v-if="!state.initiated" 
      @click="initiate()") START
  
  .absolute.top-0.bottom-0.flex.flex-col.gap-2.text-white.items-center.overscroll-none.overflow-x-hidden.overflow-y-scroll.bg-dark-900.bg-op-20.backdrop-blur.op-40.hover-op-100.transition(
    v-show="state.initiated"
    ) 
    button.bottom-4.left-4.text-xl.select-none.cursor-pointer(@pointerdown="paused = !paused")
      .i-la-play(v-if="paused")
      .i-la-pause(v-else)
    button.bottom-4.right-4.text-xl.select-none.cursor-pointer(@pointerdown="state.vertical = !state.vertical")
      .i-la-arrow-left(v-if="!state.vertical")
      .i-la-arrow-down(v-else)
    button.top-4.right-4.text-xl.select-none.cursor-pointer(@pointerdown="clear()")
      .i-la-trash-alt

    .is-group.flex.flex-col.gap-2(v-if="state.initiated")
      ControlRotary(v-model="state.speed" :min="1" :max="5" :step="1" :fixed="0" param="SPEED")
      ControlRotary(v-model="steepness" :min="3" :max="30" :step="0.0001" :fixed="2" param="CONTRAST")
      ControlRotary(v-model="midpoint" :min="0" :max="1" :step=".0001" param="MIDPOINT" :fixed="2")
      ControlRotary(v-model="smoothing" :min="0" :max="1" :step=".0001" param="SMOOTH" :fixed="2")
    .flex-1
    button.top-4.right-4.text-xl.select-none.cursor-pointer.transition(
     :style="{opacity: showVideo ? 1 : 0.2}"
      @pointerdown="showVideo = !showVideo")
      .i-la-external-link-square-alt
  .fixed.overflow-clip.text-white.transition.bottom-4.left-18.rounded-xl.overflow-hidden(v-show="showVideo")
    .relative
      .absolute.p-2.opacity-70.touch-none.select-none.text-md Right click here to enter Picture-In-Picture mode
      video.max-h-50.max-w-full(ref="video")
    
</template>

<style lang="postcss" scoped>
button {
  @apply p-4;
}
</style>