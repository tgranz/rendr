import mediaInfoFactory from 'mediainfo.js';

class ClipMediaInfo {
    constructor(options = {}) {
        const baseUrl = import.meta.env.BASE_URL || '/';
        const defaultWasmUrl = `${baseUrl}MediaInfoModule.wasm`;
        this.wasmUrl = options.wasmUrl || defaultWasmUrl;
        this.chunkSize = options.chunkSize || 1024 * 1024;
        this.mediaInfoPromise = null;
    }

    async getClipProperties(clipSource) {
        const sourceBlob = await this.resolveSourceBlob(clipSource);
        const mediaInfo = await this.getMediaInfoInstance();

        const result = await mediaInfo.analyzeData(
            () => sourceBlob.size,
            (chunkSize, offset) => this.readChunk(sourceBlob, chunkSize, offset)
        );

        const resp = JSON.parse(result).media;
        const generalTrack = resp.track.find(t => t['@type'] === 'General') || {};
        const videoTrack = resp.track.find(t => t['@type'] === 'Video') || {};
        const audioTrack = resp.track.find(t => t['@type'] === 'Audio') || {};
        const formatDuration = function(durationStr) {
            if (!durationStr) return null;
            const duration = parseFloat(durationStr);
            if (isNaN(duration)) return null;
            const seconds = Math.floor(duration % 60);
            const minutes = Math.floor((duration / 60) % 60);
            const hours = Math.floor(duration / 3600);
            return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }

        const formattedResp = {
            video_tracks: generalTrack.VideoCount || null,
            audio_tracks: generalTrack.AudioCount || null,
            mediaFormat: generalTrack.Format || null,
            duration: formatDuration(generalTrack.Duration),
            fps: generalTrack.FrameRate || null,
            is_supported: this._isLikelyBrowserSupportedAudioCodec(audioTrack.Format || false)
        }

        console.log(JSON.stringify(resp, null, 2));

        return formattedResp;
    }

    async getMediaInfoInstance() {
        if (!this.mediaInfoPromise) {
            this.mediaInfoPromise = mediaInfoFactory({
                format: 'JSON',
                chunkSize: this.chunkSize,
                locateFile: () => this.wasmUrl
            });
        }

        return this.mediaInfoPromise;
    }

    async resolveSourceBlob(clipSource) {
        if (!clipSource) {
            throw new Error('ClipMediaInfo expected a clip source.');
        }

        if (clipSource instanceof Blob) {
            return clipSource;
        }

        if (clipSource.file instanceof Blob) {
            return clipSource.file;
        }

        if (typeof clipSource.url === 'string') {
            return this.fetchBlobFromUrl(clipSource.url);
        }

        if (typeof clipSource === 'string') {
            return this.fetchBlobFromUrl(clipSource);
        }

        throw new Error('Unsupported clip source. Expected a Blob, File, clip object, or URL string.');
    }

    async fetchBlobFromUrl(url) {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to load clip from URL: ${url}`);
        }

        return response.blob();
    }

    async readChunk(sourceBlob, chunkSize, offset) {
        const chunk = sourceBlob.slice(offset, offset + chunkSize);
        const buffer = await chunk.arrayBuffer();
        return new Uint8Array(buffer);
    }

    _isLikelyBrowserSupportedAudioCodec(codecLabel) {
        const normalized = codecLabel.toLowerCase();
        const likelySupportedPatterns = [
            /aac/,
            /mp3/,
            /opus/,
            /vorbis/,
            /flac/,
            /pcm/,
            /alac/
        ];

        return likelySupportedPatterns.some((pattern) => pattern.test(normalized));
    }
}

window.ClipMediaInfo = ClipMediaInfo;
export default ClipMediaInfo;