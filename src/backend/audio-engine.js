class AudioEngine {
    constructor() {
        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        this.masterGainNode = this.audioCtx.createGain();
        this.masterGainNode.gain.value = 1;
        // Main audio output (preserves all channels for surround)
        this.masterGainNode.connect(this.audioCtx.destination);

        // Separate metering tap: split to extract left/right for analysis
        this.stereoSplitter = this.audioCtx.createChannelSplitter(2);
        this.masterGainNode.connect(this.stereoSplitter);

        this.leftAnalyserNode = this.audioCtx.createAnalyser();
        this.leftAnalyserNode.fftSize = 2048;
        this.leftAnalyserNode.smoothingTimeConstant = 0.85;
        this.rightAnalyserNode = this.audioCtx.createAnalyser();
        this.rightAnalyserNode.fftSize = 2048;
        this.rightAnalyserNode.smoothingTimeConstant = 0.85;

        this.stereoSplitter.connect(this.leftAnalyserNode, 0);
        this.stereoSplitter.connect(this.rightAnalyserNode, 1);

        this.levelSampleBuffer = new Float32Array(this.leftAnalyserNode.fftSize);
        this.leftSampleBuffer = new Float32Array(this.leftAnalyserNode.fftSize);
        this.rightSampleBuffer = new Float32Array(this.rightAnalyserNode.fftSize);
        this.tracks = [];
        this.clipBufferCache = new Map();
        this.waveformPreviewCache = new Map();
        this.activeSources = [];
        this.activeMediaPlaybacks = [];
        this.playbackEndTimerId = null;
        this.isPlaybackActive = false;
        this.timelineStartSeconds = 0;
        this.playbackStartWallclockMs = 0;
        this.lastKnownTimelineSeconds = 0;
        this.endedCallbacks = [];
        this.maxDecodedClipBytes = 24 * 1024 * 1024;
        this.maxWaveformClipBytes = 48 * 1024 * 1024;
        this.activeDecodeJobs = 0;

        // Browsers may start contexts suspended until a user gesture.
        if (this.audioCtx.state === 'suspended') {
            const resumeOnGesture = () => {
                this.audioCtx.resume().catch(() => {
                    // Ignore resume errors here; playback will retry later.
                });

                window.removeEventListener('pointerdown', resumeOnGesture);
                window.removeEventListener('keydown', resumeOnGesture);
            };

            window.addEventListener('pointerdown', resumeOnGesture, { once: true });
            window.addEventListener('keydown', resumeOnGesture, { once: true });
        }
    }

    addEndedHook(callback) {
        if (typeof callback !== 'function') {
            return;
        }

        if (!this.endedCallbacks.includes(callback)) {
            this.endedCallbacks.push(callback);
        }
    }

    removeEndedHook(callback) {
        this.endedCallbacks = this.endedCallbacks.filter(cb => cb !== callback);
    }

    emitEnded() {
        this.endedCallbacks.forEach(callback => {
            try {
                callback();
            } catch (error) {
                console.warn('AudioEngine ended hook failed:', error);
            }
        });
    }

    getTrackEndTime(tracks) {
        let maxEnd = 0;

        tracks.forEach(track => {
            (track.sequence || []).forEach(clip => {
                const start = Number(clip.position) || 0;
                const duration = Number(clip.duration) || 0;
                maxEnd = Math.max(maxEnd, start + duration);
            });
        });

        return maxEnd;
    }

    isPlaying() {
        return this.isPlaybackActive;
    }

    getDecibel(channel = null) {
        if (channel === 'left') {
            return this._computeDecibelFromAnalyser(this.leftAnalyserNode, this.leftSampleBuffer);
        }

        if (channel === 'right') {
            return this._computeDecibelFromAnalyser(this.rightAnalyserNode, this.rightSampleBuffer);
        }

        const leftDb = this._computeDecibelFromAnalyser(this.leftAnalyserNode, this.leftSampleBuffer);
        const rightDb = this._computeDecibelFromAnalyser(this.rightAnalyserNode, this.rightSampleBuffer);
        return Math.max(leftDb, rightDb);
    }

    _computeDecibelFromAnalyser(analyserNode, sampleBuffer) {
        if (!analyserNode || !sampleBuffer) {
            return -100;
        }

        analyserNode.getFloatTimeDomainData(sampleBuffer);

        let sumSquares = 0;
        for (let i = 0; i < sampleBuffer.length; i += 1) {
            const sample = sampleBuffer[i] || 0;
            sumSquares += sample * sample;
        }

        const rms = Math.sqrt(sumSquares / sampleBuffer.length);
        if (!Number.isFinite(rms) || rms <= 1e-7) {
            return -100;
        }

        const db = 20 * Math.log10(rms);
        return Math.min(0, db);
    }

    getLinearLevel(channel = null) {
        const db = this.getDecibel(channel);
        if (db <= -100) {
            return 0;
        }
        return Math.pow(10, db / 20);
    }

    getCurrentPlaybackPosition() {
        if (!this.isPlaybackActive) {
            return this.lastKnownTimelineSeconds;
        }

        const elapsed = Math.max(0, (performance.now() - this.playbackStartWallclockMs) / 1000);
        return this.timelineStartSeconds + elapsed;
    }

    async syncTracks(tracks, playPosition = 0) {
        this.tracks = Array.isArray(tracks) ? tracks : [];
        this.lastKnownTimelineSeconds = playPosition;
    }

    async warmClipCache(clipSource) {
        if (!clipSource) {
            return null;
        }

        try {
            return await this.preloadClipMetadata(clipSource);
        } catch (error) {
            console.warn('Failed to warm clip metadata:', clipSource?.name || clipSource?.url || clipSource, error);
            return null;
        }
    }

    isClipTooLargeForDecode(clipSource, limitBytes) {
        const sourceFile = clipSource?.file;
        if (sourceFile instanceof Blob && Number.isFinite(sourceFile.size)) {
            return sourceFile.size > limitBytes;
        }

        return false;
    }

    beginDecodeProgress(label = 'Decoding audio...') {
        this.activeDecodeJobs += 1;
        if (typeof window.setProgress === 'function') {
            window.setProgress(label, 1);
        }
    }

    updateDecodeProgress(percent, label = 'Decoding audio...') {
        if (typeof window.setProgress !== 'function') {
            return;
        }

        const boundedPercent = Math.max(1, Math.min(99, Math.floor(percent)));
        window.setProgress(label, boundedPercent);
    }

    endDecodeProgress() {
        this.activeDecodeJobs = Math.max(0, this.activeDecodeJobs - 1);
        if (this.activeDecodeJobs === 0 && typeof window.stopProgress === 'function') {
            window.stopProgress();
        }
    }

    failDecodeProgress(message = 'Error decoding audio') {
        if (typeof window.progressError === 'function') {
            window.progressError(message);
        }
        this.activeDecodeJobs = 0;
        if (typeof window.stopProgress === 'function') {
            setTimeout(() => {
                window.stopProgress();
            }, 1200);
        }
    }

    async resolveClipDecodeArrayBuffer(clipSource) {
        if (clipSource.file instanceof Blob) {
            this.updateDecodeProgress(20);
            const buffer = await clipSource.file.arrayBuffer();
            this.updateDecodeProgress(65);
            return buffer;
        }

        if (typeof clipSource.url === 'string') {
            const response = await fetch(clipSource.url);
            if (!response.ok) {
                throw new Error(`Failed to fetch clip for audio extraction: ${clipSource.url}`);
            }

            const totalBytes = Number(response.headers.get('content-length')) || 0;
            if (response.body && totalBytes > 0) {
                const reader = response.body.getReader();
                const chunks = [];
                let receivedBytes = 0;

                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;

                    chunks.push(value);
                    receivedBytes += value.length;

                    const fetchProgress = Math.min(60, Math.floor((receivedBytes / totalBytes) * 60));
                    this.updateDecodeProgress(fetchProgress);
                }

                const merged = new Uint8Array(receivedBytes);
                let offset = 0;
                chunks.forEach(chunk => {
                    merged.set(chunk, offset);
                    offset += chunk.length;
                });

                this.updateDecodeProgress(65);
                return merged.buffer;
            }

            const arrayBuffer = await response.arrayBuffer();
            this.updateDecodeProgress(65);
            return arrayBuffer;
        }

        throw new Error('Unsupported clip source for audio extraction.');
    }

    async getBufferForClip(clipSource) {
        const cacheKey = clipSource.id || clipSource.url || clipSource.name;
        if (!cacheKey) {
            throw new Error('Clip has no cache key for audio extraction.');
        }

        if (this.isClipTooLargeForDecode(clipSource, this.maxDecodedClipBytes)) {
            throw new Error('Clip exceeds decode memory budget.');
        }

        const cached = this.clipBufferCache.get(cacheKey);
        if (cached) {
            return cached;
        }

        const promise = (async () => {
            this.beginDecodeProgress();
            const rawArrayBuffer = await this.resolveClipDecodeArrayBuffer(clipSource);
            const decodeInput = rawArrayBuffer.slice(0);

            this.updateDecodeProgress(75);
            const decodedBuffer = await this.audioCtx.decodeAudioData(decodeInput);
            this.updateDecodeProgress(100);
            return decodedBuffer;
        })();

        this.clipBufferCache.set(cacheKey, promise);

        try {
            const resolved = await promise;
            this.clipBufferCache.set(cacheKey, resolved);
            this.endDecodeProgress();
            return resolved;
        } catch (error) {
            this.clipBufferCache.delete(cacheKey);
            this.failDecodeProgress('Error decoding audio');
            throw error;
        }
    }

    getClipCacheKey(clipSource) {
        return clipSource?.id || clipSource?.url || clipSource?.name || null;
    }

    async getWaveformPreview(clipOrTimelineClip, widthPx = 120, heightPx = 48) {
        const timelineClip = clipOrTimelineClip?.clip ? clipOrTimelineClip : null;
        const clipSource = timelineClip ? timelineClip.clip : clipOrTimelineClip;
        const clipKey = this.getClipCacheKey(clipSource);

        if (!clipKey) {
            return null;
        }

        if (this.isClipTooLargeForDecode(clipSource, this.maxWaveformClipBytes)) {
            return null;
        }

        const width = Math.max(24, Math.min(1600, Math.floor(widthPx)));
        const height = Math.max(24, Math.min(180, Math.floor(heightPx)));
        const clipOffset = Math.max(0, Number(timelineClip?.start) || 0);
        const clipDuration = Number(timelineClip?.duration);
        const previewDuration = Number.isFinite(clipDuration)
            ? Math.max(0, clipDuration)
            : null;

        const cacheKey = [
            clipKey,
            width,
            height,
            clipOffset.toFixed(3),
            previewDuration == null ? 'full' : previewDuration.toFixed(3)
        ].join('::');

        const cached = this.waveformPreviewCache.get(cacheKey);
        if (cached) {
            return cached;
        }

        const previewPromise = (async () => {
            const buffer = await this.getBufferForClip(clipSource);
            if (!buffer) {
                return null;
            }

            const sampleRate = buffer.sampleRate;
            const totalSamples = buffer.length;
            const startSample = Math.max(0, Math.floor(clipOffset * sampleRate));
            const requestedEndSample = previewDuration == null
                ? totalSamples
                : Math.floor((clipOffset + previewDuration) * sampleRate);
            const endSample = Math.max(startSample + 1, Math.min(totalSamples, requestedEndSample));
            const rangeSamples = endSample - startSample;
            if (rangeSamples <= 1) {
                return null;
            }

            const channels = [];
            for (let c = 0; c < buffer.numberOfChannels; c += 1) {
                channels.push(buffer.getChannelData(c));
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                return null;
            }

            ctx.clearRect(0, 0, width, height);
            ctx.fillStyle = 'rgba(138, 230, 138, 0.82)';

            const centerY = height / 2;
            const halfHeight = Math.max(1, Math.floor((height - 4) / 2));

            for (let x = 0; x < width; x += 1) {
                const segmentStart = startSample + Math.floor((x / width) * rangeSamples);
                const segmentEnd = startSample + Math.floor(((x + 1) / width) * rangeSamples);
                let peak = 0;

                for (let i = segmentStart; i < segmentEnd; i += 1) {
                    for (let c = 0; c < channels.length; c += 1) {
                        const sampleAbs = Math.abs(channels[c][i] || 0);
                        if (sampleAbs > peak) {
                            peak = sampleAbs;
                        }
                    }
                }

                const barHeight = Math.max(1, Math.floor(peak * halfHeight));
                ctx.fillRect(x, Math.floor(centerY - barHeight), 1, Math.max(1, barHeight * 2));
            }

            ctx.fillStyle = 'rgba(200, 255, 200, 0.33)';
            ctx.fillRect(0, Math.floor(centerY), width, 1);

            return canvas.toDataURL('image/png');
        })();

        this.waveformPreviewCache.set(cacheKey, previewPromise);

        try {
            const resolved = await previewPromise;
            this.waveformPreviewCache.set(cacheKey, resolved);
            // Waveforms are cached as images; release decoded audio buffer memory.
            this.clipBufferCache.delete(clipKey);
            return resolved;
        } catch (error) {
            this.waveformPreviewCache.delete(cacheKey);
            this.clipBufferCache.delete(clipKey);
            throw error;
        }
    }

    async preloadClipMetadata(clipSource) {
        if (!clipSource || !clipSource.url) {
            return null;
        }

        const mediaElement = document.createElement('video');
        mediaElement.preload = 'metadata';
        mediaElement.playsInline = true;
        mediaElement.muted = true;
        mediaElement.crossOrigin = 'anonymous';
        mediaElement.src = clipSource.url;

        await new Promise((resolve, reject) => {
            const onLoaded = () => {
                cleanup();
                resolve();
            };
            const onError = () => {
                cleanup();
                reject(new Error(`Failed metadata preload for ${clipSource.url}`));
            };
            const cleanup = () => {
                mediaElement.removeEventListener('loadedmetadata', onLoaded);
                mediaElement.removeEventListener('error', onError);
            };

            mediaElement.addEventListener('loadedmetadata', onLoaded, { once: true });
            mediaElement.addEventListener('error', onError, { once: true });
        });

        return true;
    }

    createScheduledMediaElement(clipSource) {
        const mediaElement = document.createElement('video');
        mediaElement.preload = 'metadata';
        mediaElement.playsInline = true;
        mediaElement.muted = false;
        mediaElement.crossOrigin = 'anonymous';
        mediaElement.src = clipSource.url;

        let sourceNode = null;
        try {
            sourceNode = this.audioCtx.createMediaElementSource(mediaElement);
            sourceNode.connect(this.masterGainNode);
        } catch (error) {
            console.warn('Unable to route media element through AudioContext:', clipSource?.name || clipSource?.url, error);
        }

        const readyPromise = new Promise((resolve, reject) => {
            const onLoaded = () => {
                cleanup();
                resolve();
            };

            const onError = () => {
                cleanup();
                reject(new Error(`Failed to load clip for playback: ${clipSource.url}`));
            };

            const cleanup = () => {
                mediaElement.removeEventListener('loadedmetadata', onLoaded);
                mediaElement.removeEventListener('error', onError);
            };

            mediaElement.addEventListener('loadedmetadata', onLoaded, { once: true });
            mediaElement.addEventListener('error', onError, { once: true });
        });

        return { mediaElement, readyPromise, sourceNode };
    }

    stopPlayback() {
        if (this.playbackEndTimerId) {
            clearTimeout(this.playbackEndTimerId);
            this.playbackEndTimerId = null;
        }

        this.activeSources.forEach(source => {
            try {
                source.stop(0);
            } catch {
                // Ignore if source has already ended.
            }

            try {
                source.disconnect();
            } catch {
                // Ignore disconnect races.
            }
        });

        this.activeSources = [];

        this.activeMediaPlaybacks.forEach(playback => {
            if (playback.startTimerId) {
                clearTimeout(playback.startTimerId);
            }
            if (playback.stopTimerId) {
                clearTimeout(playback.stopTimerId);
            }

            try {
                playback.mediaElement.pause();
            } catch {
                // Ignore pause races.
            }
            playback.mediaElement.removeAttribute('src');
            playback.mediaElement.load();

            try {
                playback.sourceNode?.disconnect();
            } catch {
                // Ignore disconnect races.
            }
        });

        this.activeMediaPlaybacks = [];
        this.lastKnownTimelineSeconds = this.getCurrentPlaybackPosition();
        this.isPlaybackActive = false;
    }

    async startPlayback(playPosition = 0) {
        this.stopPlayback();
        this.lastKnownTimelineSeconds = playPosition;

        if (this.audioCtx.state === 'suspended') {
            try {
                await this.audioCtx.resume();
            } catch (error) {
                console.warn('Failed to resume AudioContext:', error);
            }
        }

        const sourceJobs = [];
        const timelineEnd = this.getTrackEndTime(this.tracks);
        let scheduledSourceCount = 0;

        this.tracks.forEach(track => {
            (track.sequence || []).forEach(clip => {
                const clipStart = Number(clip.position) || 0;
                const clipDuration = Number(clip.duration) || 0;
                const clipEnd = clipStart + clipDuration;

                if (!clip.clip || clipEnd <= playPosition) {
                    return;
                }

                sourceJobs.push(
                    this.scheduleClipAsStreamedMedia(clip, playPosition).then(didSchedule => {
                        if (didSchedule) {
                            scheduledSourceCount += 1;
                        }
                    }).catch(error => {
                        console.warn('Failed to schedule clip audio:', clip?.clip?.name || clip?.clip?.url, error);
                    })
                );
            });
        });

        await Promise.all(sourceJobs);

        if (scheduledSourceCount === 0) {
            this.isPlaybackActive = false;
            return false;
        }

        this.timelineStartSeconds = playPosition;
        this.playbackStartWallclockMs = performance.now();
        this.isPlaybackActive = true;

        const remainingDuration = Math.max(0, timelineEnd - playPosition);
        if (remainingDuration > 0) {
            this.playbackEndTimerId = setTimeout(() => {
                if (this.isPlaybackActive) {
                    this.stopPlayback();
                    this.emitEnded();
                }
            }, Math.ceil(remainingDuration * 1000));
        }

        return true;
    }

    async scheduleClipAsStreamedMedia(clip, playPosition) {
        if (!clip?.clip?.url) {
            return false;
        }

        const clipStart = Number(clip.position) || 0;
        const clipDuration = Number(clip.duration) || 0;
        const clipOffset = Number(clip.start) || 0;

        const playedOnTimeline = Math.max(0, playPosition - clipStart);
        const remainingClipDuration = Math.max(0, clipDuration - playedOnTimeline);
        if (remainingClipDuration <= 0) {
            return false;
        }

        const sourceOffset = clipOffset + playedOnTimeline;
        const delaySeconds = Math.max(0, clipStart - playPosition);
        const durationToPlay = remainingClipDuration;
        const { mediaElement, readyPromise, sourceNode } = this.createScheduledMediaElement(clip.clip);
        const playbackItem = {
            mediaElement,
            sourceNode,
            startTimerId: null,
            stopTimerId: null
        };

        const startNow = async () => {
            try {
                await readyPromise;
            } catch {
                return;
            }

            const maxSeekTime = Math.max(0, (mediaElement.duration || 0) - 0.001);
            const safeOffset = Math.max(0, Math.min(sourceOffset, maxSeekTime));
            mediaElement.currentTime = safeOffset;

            try {
                await mediaElement.play();
            } catch {
                // Autoplay policy can reject in edge cases.
            }

            playbackItem.stopTimerId = setTimeout(() => {
                try {
                    mediaElement.pause();
                } catch {
                    // Ignore pause races.
                }
            }, Math.max(0, Math.ceil(durationToPlay * 1000)));
        };

        if (delaySeconds <= 0.001) {
            void startNow();
        } else {
            playbackItem.startTimerId = setTimeout(() => {
                void startNow();
            }, Math.ceil(delaySeconds * 1000));
        }

        this.activeMediaPlaybacks.push(playbackItem);
        return true;
    }
}

export default AudioEngine;