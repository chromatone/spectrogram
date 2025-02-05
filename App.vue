<script setup>
import { computed, ref } from 'vue'
import { onKeyStroke, useFullscreen, useTimestamp } from '@vueuse/core'

import ControlRotary from './components/ControlRotary.vue'

import { version, year } from './package.json'
import { useSpectrogram } from './composables/useSpectrogram';
import { useVideoRecorder } from './composables/useVideoRecorder';

function download(url, ext = 'png') {
  const a = document.createElement('a');
  a.href = url;
  a.download = `spectrogram_${new Date().toISOString().slice(0, 19).replace(/T/, '_')}.${ext}`
  document.body.appendChild(a);
  a.click();
}

const time = useTimestamp()

const {
  screen, canvasElement, video, paused, recording, recordedWidth, controls, params, initiated, vertical, width, height, initiate, startRecording, stopRecording, pics, clear, barFrequencies, colorFreq
} = useSpectrogram()

import { useWakeLock } from '@vueuse/core'

const { isSupported: isWakeLockSupported, request } = useWakeLock()

const { toggle, isSupported } = useFullscreen(screen)

const { videoRecording, startVideo, stopVideo } = useVideoRecorder(video)

const showVideo = ref(false)

onKeyStroke(' ', (e) => { e.preventDefault(); paused.value = !paused.value })

onKeyStroke('Enter', () => clear())


import { useWindowSize, useMouse } from '@vueuse/core'
const { x, y } = useMouse()
const { width: winW, height: winH } = useWindowSize()

const frequency = computed(() => {
  if (!barFrequencies.value) return 0
  return barFrequencies.value[Math.floor((1 - y.value / winH.value) * barFrequencies.value.length)].freq
})

function freqPitch(freq, middleA = 440) {
  return 12 * (Math.log(Number(freq) / middleA) / Math.log(2))
}

const notes = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#']


</script>

<template lang="pug">
template(v-if="initiated")
  .w-2px.h-full.absolute.bg-light-100.bg-op-80.backdrop-blur.z-100.filter-invert(inert :style="{ transform: `translate(${x}px,0)` }")
  .h-2px.w-full.absolute.bg-light-100.bg-op-80.backdrop-blur.z-100.filter-invert(inert :style="{ transform: `translate(0,${y}px)` }")
  .h-4px.w-4px.absolute.z-150.rounded-4px(inert :style="{ backgroundColor: colorFreq(frequency), transform: `translate(${x - 1}px,${y - 1}px)` }")
  .z-140.text-white.absolute.text-right.w-110px.p-2.backdrop-blur-lg.bg-dark-100.bg-op-20.transition-opacity(inert :style="{ color: colorFreq(frequency), transform: `translate(${x - 110}px,${y - 65}px)` }") 
    .font-bold.text-xl.flex(:style="{ opacity: Math.round((freqPitch(frequency) - Math.floor(freqPitch(frequency))) * 10) % 10 > 0 ? .7 : 1, }") 
      .p-0 {{ notes[(Math.round(freqPitch(frequency) - .2) % 12 + 12) % 12] }}{{ Math.floor((Math.round(freqPitch(frequency) - .2) - 3) / 12) + 4 }}
      .flex-1
      .p-0.op-80 {{ Math.round((freqPitch(frequency) - Math.floor(freqPitch(frequency))) * 10) % 10 > 0 ? '~' : '' }} 
    .p-0 {{ frequency.toFixed(1) }} Hz  

.flex.flex-col.justify-center.bg-black.relative.w-full.items-center
  .text-center.absolute.m-auto.top-0.w-full.h-full.text-white.flex.flex-col.items-center.justify-center.gap-4.p-4.bg-stone-800(v-if="!initiated") 

    .flex-1

    .flex.flex-col.items-center.gap-2
      a.m-4.flex.flex-col.items-center.gap-1(href="https://chromatone.center" target="_blank")
        img(src="/logo.svg" width="80px" height="80px")
        .font-bold.text-3xl.op-70 Chromatone 
      h1.text-6xl Spectrogram
      h2.text-xl Visual audio feedback instrument
    form(@submit.prevent="initiate(); isWakeLockSupported && request()")
      button.m-2.text-2xl.border-1.p-4.rounded-xl(
        title="Press here to start" 
        autofocus
        aria-label="Start button"
        type="submit") START
    .flex-1
    .max-w-40ch.flex.flex-col.gap-1
      h3.text-lg Portable time-frequency analysis tool
      p.text-sm 240 bands of distinct frequencies being extracted with FFT from audio input signal and displayed in colors matching pitch class.
      p.op-80.text-xs A is red, A#/Bb is orange, B is yellow, C is lime, C#/Dd is green, D is mint, D#/Eb is cyan, E is azure, F is blue, F#/Gb is violet, G is magenta and G#/Ab is rose. 

    .flex.items-center.gap-2
      a.flex.gap-2.p-2.m-2.border-1.rounded-lg(href="https://github.com/chromatone/spectrogram" target="_blank")
        .i-la-github
        .p-0 Open Source
      .flex.gap-1
        .p-0  v.{{ version }} 
        .p-0 by
        a.underline(href="https://github.com/davay42" target="_blank") davay42 
        .p-0.op-50 MIT {{ year }}

  .fullscreen-container#screen.cursor-none(ref="screen")
    canvas#spectrogram.max-w-full(
      ref="canvasElement"
      :width="width"
      :height="height")

  .flex.absolute.top-6.z-100.text-white.op-20.hover-op-100.transition(v-if="initiated")
    button.p-4.text-xl.select-none.cursor-pointer(@pointerdown="paused = !paused")
      .i-la-play(v-if="paused")
      .i-la-pause(v-else)
    button.p-4.text-xl.select-none.cursor-pointer(@pointerdown="vertical = !vertical")
      .i-la-arrow-left(v-if="!vertical")
      .i-la-arrow-down(v-else)
    button.p-4.text-xl.select-none.cursor-pointer(@pointerdown="clear()")
      .i-la-trash-alt

  .flex.absolute.bottom-6.mx-auto.z-100.text-white.op-20.hover-op-100.transition(v-if="initiated")
    button.p-4.text-xl.select-none.cursor-pointer.transition(
      :style="{ opacity: showVideo ? 1 : 0.5 }"
      @pointerdown="showVideo = !showVideo; showVideo && video?.requestPictureInPicture?.()")
      .i-la-external-link-square-alt
    button.p-4.text-xl.select-none.cursor-pointer(
      v-if="isSupported"
      @pointerdown="toggle()")
      .i-la-expand
    button.p-4.text-xl.select-none.cursor-pointer.flex.items-center.gap-1(
      :class="{ 'text-red': recording }"
      @pointerdown="recording ? stopRecording() : startRecording()")
      .i-la-circle(v-if="!recording")
      .i-la-dot-circle(v-else)
      .p-0.text-sm.font-mono(v-if="recording && recordedWidth") {{ ((time - recording) / 1000).toFixed(0) }}s ({{ recordedWidth }}px)
    button.p-4.text-xl.select-none.cursor-pointer.flex.items-center.gap-1(
      :class="{ 'text-red': videoRecording }"
      @pointerdown="!videoRecording ? startVideo() : stopVideo()")
      .i-la-video
      .p-0.text-sm.font-mono(v-if="videoRecording") {{ ((time - videoRecording) / 1000).toFixed() }}s


  .absolute.my-auto.left-2.flex.flex-col.text-white.items-center.overscroll-none.overflow-x-hidden.overflow-y-scroll.bg-dark-900.bg-op-20.backdrop-blur.op-40.hover-op-100.transition.max-h-100vh.overflow-y-scroll.scrollbar-thin.rounded-xl.p-2.z-50(v-show="initiated" style="scrollbar-width: none;") 
    .is-group.flex.flex-col.gap-2
      ControlRotary(v-for="(param, p) in params" v-model="controls[p]" :min="param.min" :max="param.max" :step="param.step" :param="p" :fixed="param.fixed")

  .absolute.bottom-20.border-1.border-light-200.border-op-50.p-2.text-white.flex.gap-2.max-w-80vw.overflow-x-scroll.rounded-xl.z-20(v-if="pics.length")
    .p-0.relative.min-w-30.bg-black.flex.justify-center.border-1.border-light-200.border-op-50.rounded-lg.overflow-hidden(v-for="(pic, p) in pics" :key="pic") 
      img.max-h-50( :src="pic")
      button.p-2.absolute.top-2.left-2(@click="download(pic)")
        .i-la-download
      button.p-2.absolute.top-2.right-2(@click="pics.splice(p, 1)") 
        .i-la-trash

  .absolute.overflow-clip.text-white.transition.bottom-22.rounded-xl.overflow-hidden.rounded-xl.border-1(v-show="showVideo")
    .relative.mx-auto
      .absolute.p-4.opacity-70.touch-none.select-none.text-md.mr-10 Right click here to enter Picture-In-Picture mode
      video.max-h-80.max-w-full(ref="video")
    button.absolute.top-2.right-2(@click="showVideo = false")
      .i-la-times
</template>

<style lang="postcss">
#screen {
  width: 100%;
  height: 100%;
}

html,
body {
  background-color: black;
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
  overscroll-behavior: none;
  overflow: hidden;
}
</style>