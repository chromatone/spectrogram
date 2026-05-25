import { ref } from "vue"

function download(url, ext = 'png') {
  const a = document.createElement('a');
  a.href = url;
  a.download = `spectrogram_${new Date().toISOString().slice(0, 19).replace(/T/, '_')}.${ext}`
  document.body.appendChild(a);
  a.click();
}

export function useVideoRecorder(video) {
  let recorder

  const videoRecording = ref(false)

  const startVideo = async () => {
    videoRecording.value = Date.now()
    const videoStream = video.value.srcObject
    const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

    const combinedStream = new MediaStream([...videoStream.getTracks(), ...audioStream.getTracks()])

    // High quality video recording options (must include audio codec)
    // Safari prefers MP4/H.264, others prefer WebM/VP9
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent)
    let options

    if (isSafari) {
      // Safari: MP4 with H.264 and AAC
      options = { mimeType: 'video/mp4;codecs=h264,aac', videoBitsPerSecond: 8000000 }
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options = { mimeType: 'video/mp4' }
      }
    } else {
      // Chrome/Firefox: WebM with VP9/Opus
      options = { mimeType: 'video/webm;codecs=vp9,opus', videoBitsPerSecond: 8000000 }
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options = { mimeType: 'video/webm;codecs=vp8,opus' }
      }
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options = { mimeType: 'video/webm' }
      }
    }

    recorder = new MediaRecorder(combinedStream, options)

    recorder.ondataavailable = (event) => {
      const blob = event.data;
      const url = URL.createObjectURL(blob);
      download(url, 'mp4')
      window.open(url, '_blank');
    };
    recorder.start()
  }

  const stopVideo = () => { videoRecording.value = false; recorder?.stop() }

  return {
    videoRecording,
    startVideo,
    stopVideo
  }
}
