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

    const combinedStream = new MediaStream([...videoStream.getTracks(), ...audioStream.getTracks()]);


    recorder = new MediaRecorder(combinedStream)

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
