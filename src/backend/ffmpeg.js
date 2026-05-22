import { FFmpeg } from '@ffmpeg/ffmpeg';

const ffmpeg = new FFmpeg();

export default ffmpeg;

export async function loadFFmpeg(options = {}) {
    if (!ffmpeg.loaded) {
        await ffmpeg.load(options);
    }

    return ffmpeg;
}
