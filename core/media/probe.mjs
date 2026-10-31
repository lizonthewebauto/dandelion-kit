// ffprobe to MediaInfo.
import { runFfprobe, KitMediaError } from './ffmpeg.mjs';

/** "30000/1001" to 29.97. Returns 0 for "0/0". @param {string | undefined} text */
export function parseRate(text) {
  if (!text) return 0;
  const [a, b] = text.split('/').map(Number);
  if (!Number.isFinite(a)) return 0;
  if (b === undefined) return a;
  return b === 0 ? 0 : a / b;
}

function rotationOf(stream) {
  const side = Array.isArray(stream.side_data_list) ? stream.side_data_list : [];
  for (const entry of side) {
    if (typeof entry.rotation === 'number') return entry.rotation;
  }
  const tag = Number(stream.tags?.rotate);
  return Number.isFinite(tag) ? tag : 0;
}

/**
 * Turn ffprobe JSON into MediaInfo (width and height after rotation).
 * @param {any} json
 * @returns {import('../types.mjs').MediaInfo}
 */
export function mediaInfoFromProbe(json) {
  const streams = Array.isArray(json?.streams) ? json.streams : [];
  const video = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  if (!video) throw new KitMediaError('That file has no video in it.');
  const audio = streams.find((s) => s.codec_type === 'audio');
  const rotation = Math.abs(rotationOf(video)) % 180;
  const swap = rotation === 90;
  const width = Number(swap ? video.height : video.width);
  const height = Number(swap ? video.width : video.height);
  const seconds = Number(json?.format?.duration ?? video.duration ?? 0);
  const fps = parseRate(video.avg_frame_rate) || parseRate(video.r_frame_rate);
  /** @type {import('../types.mjs').MediaInfo} */
  const info = {
    duration_ms: Math.round((Number.isFinite(seconds) ? seconds : 0) * 1000),
    fps: Math.round(fps * 1000) / 1000,
    width,
    height,
    has_audio: Boolean(audio),
  };
  if (audio?.sample_rate) info.audio_rate = Number(audio.sample_rate);
  if (video.codec_name) info.video_codec = String(video.codec_name);
  return info;
}

/**
 * Read facts about a media file.
 * @param {string} path
 * @returns {Promise<import('../types.mjs').MediaInfo>}
 */
export async function probeMedia(path) {
  const text = await runFfprobe(['-print_format', 'json', '-show_streams', '-show_format', path]);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new KitMediaError('ffprobe gave an answer the kit could not read.');
  }
  return mediaInfoFromProbe(json);
}

/**
 * Read facts about an audio file (a wav, or the sound of a video).
 * @param {string} path
 * @returns {Promise<{duration_ms: number, audio_rate: number, channels: number}>}
 */
export async function probeAudio(path) {
  const text = await runFfprobe(['-print_format', 'json', '-show_streams', '-show_format', path]);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new KitMediaError('ffprobe gave an answer the kit could not read.');
  }
  const audio = (Array.isArray(json?.streams) ? json.streams : []).find((s) => s.codec_type === 'audio');
  if (!audio) throw new KitMediaError('That file has no sound in it.');
  const seconds = Number(json?.format?.duration ?? audio.duration ?? 0);
  return {
    duration_ms: Math.round((Number.isFinite(seconds) ? seconds : 0) * 1000),
    audio_rate: Number(audio.sample_rate),
    channels: Number(audio.channels),
  };
}
