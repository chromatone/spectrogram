import { ref, watchEffect } from 'vue'

export function useClamp(initialValue, min, max) {
  const clampedValue = ref(Math.min(Math.max(initialValue, min), max))
  watchEffect(() => { clampedValue.value = Math.min(Math.max(clampedValue.value, min), max) })
  return clampedValue
}


export function initGetUserMedia() {
  if (typeof window === 'undefined') return;

  window.AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!window.AudioContext) {
    throw new Error("AudioContext not supported");
  }

  if (navigator.mediaDevices === undefined) {
    navigator.mediaDevices = {};
  }

  if (navigator.mediaDevices.getUserMedia === undefined) {
    navigator.mediaDevices.getUserMedia = function (constraints) {
      const getUserMedia = navigator.webkitGetUserMedia || navigator.mozGetUserMedia;

      if (!getUserMedia) {
        throw new Error("getUserMedia is not implemented in this browser");
      }

      return new Promise((resolve, reject) => {
        getUserMedia.call(navigator, constraints, resolve, reject);
      });
    };
  }
}