import * as VideoThumbnails from 'expo-video-thumbnails';

export interface VideoThumbnail {
  uri: string;
  width: number;
  height: number;
}

/** Grabs a poster frame from a local video (native implementation). */
export async function generateVideoThumbnail(uri: string, timeMs = 500): Promise<VideoThumbnail | null> {
  try {
    const result = await VideoThumbnails.getThumbnailAsync(uri, { time: timeMs, quality: 0.75 });
    return { uri: result.uri, width: result.width, height: result.height };
  } catch (error) {
    console.warn('[thumbnail] failed', error);
    return null;
  }
}
