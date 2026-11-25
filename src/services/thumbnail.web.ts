export interface VideoThumbnail {
  uri: string;
  width: number;
  height: number;
}

/** Grabs a poster frame from a video using an off-screen <video> + canvas (web implementation). */
export function generateVideoThumbnail(uri: string, timeMs = 500): Promise<VideoThumbnail | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve(null);
      return;
    }
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';
    let done = false;
    const finish = (value: VideoThumbnail | null) => {
      if (done) return;
      done = true;
      video.removeAttribute('src');
      video.load();
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), 8000);
    video.onerror = () => {
      clearTimeout(timer);
      finish(null);
    };
    video.onloadedmetadata = () => {
      const target = Math.min(Math.max(timeMs / 1000, 0), Math.max(0, (video.duration || 1) - 0.1));
      video.currentTime = target;
    };
    video.onseeked = () => {
      try {
        const scale = Math.min(1, 720 / Math.max(video.videoWidth, video.videoHeight, 1));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          clearTimeout(timer);
          finish(null);
          return;
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(
          (blob) => {
            clearTimeout(timer);
            if (!blob) {
              finish(null);
              return;
            }
            finish({ uri: URL.createObjectURL(blob), width: canvas.width, height: canvas.height });
          },
          'image/jpeg',
          0.8,
        );
      } catch {
        clearTimeout(timer);
        finish(null);
      }
    };
    video.src = uri;
  });
}
