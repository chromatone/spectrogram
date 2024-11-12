export function download(url, ext = 'png') {
  const a = document.createElement('a');
  a.href = url;
  a.download = `spectrogram_${new Date().toISOString().slice(0, 19).replace(/T/, '_')}.${ext}`
  document.body.appendChild(a);
  a.click();
}