<script setup>
import { ref, onMounted, watch, reactive } from 'vue'
import { onKeyStroke, useFullscreen, useStorage, useTimestamp, useWindowSize } from '@vueuse/core'

import ControlRotary from './ControlRotary.vue'

import {version, year} from '../package.json'
import { useSpectrogram } from './useSpectrogram';

const {
    initiate, startRecording, stopRecording, pics, startVideo, stopVideo, clear, download, time, screen, canvasElement, video, paused, recording, videoRecording, recordedWidth, smoothing, speed, midpoint, initiated, vertical, width, height, frame, steepness
  } = useSpectrogram()

const { toggle, isSupported } = useFullscreen(screen)

const showVideo = ref(false)




</script>

<template lang="pug">
.flex.flex-col.justify-center.bg-black.relative.w-full.items-center
  .text-center.absolute.m-auto.top-0.w-full.h-full.text-white.flex.flex-col.items-center.justify-center.gap-4.p-4.bg-stone-800(v-if="!initiated") 
    a.m-4.flex.flex-col.items-center.gap-1(href="https://chromatone.center" target="_blank")
      img(src="/logo.svg" width="80px" height="80px")
      .font-bold.text-2xl Chromatone 
    .flex-1
    
    .flex.flex-col.items-center.gap-2
      h1.text-5xl Spectrogram
      h2.text-xl Visual audio feedback instrument
    form(@submit.prevent="initiate()")
      button.m-2.text-2xl.border-1.p-4.rounded-xl(
        title="Press here to start" 
        autofocus
        aria-label=""
        type="submit") START
    .flex-1
    .max-w-40ch.flex.flex-col.gap-1
      h3.text-lg Portable time-frequency analysis tool
      p.text-sm 240 bands of distinct frequencies being extracted with FFT from audio input signal and displayed with colors matching pitch class.
      p.op-80.text-xs A is red, A# is orange, B is yellow, C is lime, C# is green, D is mint, D# is cyan, E is azure, F is blue, F# is violet, G is magenta and G# is rose. 

    .flex.items-center.gap-2
      a.flex.gap-2.p-2.m-2.border-1.rounded-lg(href="https://github.com/chromatone/spectrogram" target="_blank")
        .i-la-github
        .p-0 Open Source
      p v.{{version}} MIT {{ year }}
 
  .fullscreen-container#screen(ref="screen")
    canvas#spectrogram.max-w-full(
      @pointerdown="paused = !paused"
      ref="canvasElement"
      :width="width"
      :height="height"
      )
  .flex.absolute.top-4.z-100.text-white.op-20.hover-op-100.transition(v-if="initiated")
    button.p-4.text-xl.select-none.cursor-pointer(@pointerdown="paused = !paused")
      .i-la-play(v-if="paused")
      .i-la-pause(v-else)
    button.p-4.text-xl.select-none.cursor-pointer(@pointerdown="vertical = !vertical")
      .i-la-arrow-left(v-if="!vertical")
      .i-la-arrow-down(v-else)
    button.p-4.text-xl.select-none.cursor-pointer(@pointerdown="clear()")
      .i-la-trash-alt
    button.p-4.text-xl.select-none.cursor-pointer(
      v-if="isSupported"
      @pointerdown="toggle()")
      .i-la-expand

  .flex.absolute.bottom-2.mx-auto.z-100.text-white.op-20.hover-op-100.transition(v-if="initiated")
    button.p-4.text-xl.select-none.cursor-pointer.transition(
      :style="{ opacity: showVideo ? 1 : 0.5 }"
      @pointerdown="showVideo = !showVideo; showVideo && video?.requestPictureInPicture?.()")
      .i-la-external-link-square-alt
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
      ControlRotary(v-model="midpoint" :min="0" :max="1" :step=".0001" param="MIDPOINT" :fixed="2")
      ControlRotary(v-model="steepness" :min="3" :max="30" :step="0.0001" :fixed="2" param="CONTRAST")
      ControlRotary(v-model="smoothing" :min="0" :max="1" :step=".0001" param="SMOOTH" :fixed="2")
      ControlRotary(v-model="frame" :min="1" :max="4" :step="1" :fixed="0" param="FRAME")
      ControlRotary(v-model="speed" :min="1" :max="5" :step="1" :fixed="0" param="SPEED")

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

<style lang="postcss" scoped>
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