// This file converts the timeline play position into WebGL frames for realtime playback.

class Compose {
    constructor() {
        this.previews = [];
        this.isDrawing = false;
        this.videoCache = new Map();
        this.targetFps = 24;
        this.seekToleranceSeconds = 1 / this.targetFps;
        this.playbackSeekDriftToleranceSeconds = 0.12;
        this.maxPreviewDpr = 1;
        this.lastRenderedClipId = null;
        this.lastRenderedFrameIndex = -1;
        this.lastDrawAtMs = 0;
        this.lastRenderedAtMs = 0;
        this.activeVideoUrl = null;
        this.fpsHooks = [];
        this.smoothedFps = 0;
        this.drawQuality = 6;
        this.enableDebugTimingLogs = false;
        this.rvfcActiveVideo = null;
        this.rvfcCallbackId = null;
    }

    normalizeDrawQuality(quality) {
        const parsed = Number.parseInt(quality, 10);
        if (!Number.isFinite(parsed)) {
            return this.drawQuality;
        }
        return Math.max(1, Math.min(9, parsed));
    }

    setDrawQuality(quality) {
        this.drawQuality = this.normalizeDrawQuality(quality);
    }

    addFpsHook(hookItem) {
        if (!hookItem) {
            return;
        }

        if (this.fpsHooks.includes(hookItem)) {
            return;
        }

        this.fpsHooks.push(hookItem);
    }

    removeFpsHook(hookItem) {
        this.fpsHooks = this.fpsHooks.filter(item => item !== hookItem);
    }

    // Backward compatible API for older callers.
    setFpsHook(callback) {
        this.fpsHooks = [];
        if (callback) {
            this.addFpsHook(callback);
        }
    }

    emitFps(fpsValue) {
        if (this.fpsHooks.length === 0) {
            return;
        }

        this.fpsHooks = this.fpsHooks.filter(hookItem => {
            if (!hookItem) {
                return false;
            }

            const isAlive = typeof hookItem.isAlive === 'function'
                ? hookItem.isAlive()
                : !(hookItem.element && !hookItem.element.isConnected);

            if (!isAlive) {
                return false;
            }

            try {
                if (typeof hookItem === 'function') {
                    hookItem(fpsValue);
                } else if (typeof hookItem.updateFps === 'function') {
                    hookItem.updateFps(fpsValue);
                } else if (typeof hookItem.onFps === 'function') {
                    hookItem.onFps(fpsValue);
                }
            } catch (error) {
                console.warn('Compose FPS hook failed:', error);
                return false;
            }

            return true;
        });
    }

    pruneDisconnectedPreviews() {
        this.previews = this.previews.filter(preview => preview.canvas && preview.canvas.isConnected);
    }

    attachPreview(canvasObject){
        this.pruneDisconnectedPreviews();

        if (this.previews.some(preview => preview.canvas === canvasObject)) {
            return;
        }

        canvasObject.style.display = 'block';
        canvasObject.style.width = '100%';
        canvasObject.style.height = '100%';

        const gl = canvasObject.getContext('webgl', {
            alpha: true,
            antialias: false,
            desynchronized: true,
            preserveDrawingBuffer: false,
            powerPreference: 'low-power'
        });

        if (!gl) {
            throw new Error('Failed to get WebGL context from canvas for preview.');
        }

        const program = this.createProgram(gl);
        const positionLocation = gl.getAttribLocation(program, 'a_position');
        const texCoordLocation = gl.getAttribLocation(program, 'a_texCoord');
        const textureLocation = gl.getUniformLocation(program, 'u_texture');

        const quadBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
        gl.bufferData(
            gl.ARRAY_BUFFER,
            new Float32Array([
                // x, y, u, v
                -1, -1, 0, 1,
                 1, -1, 1, 1,
                -1,  1, 0, 0,
                -1,  1, 0, 0,
                 1, -1, 1, 1,
                 1,  1, 1, 0
            ]),
            gl.STATIC_DRAW
        );

        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        this.previews.push({
            canvas: canvasObject,
            gl,
            program,
            positionLocation,
            texCoordLocation,
            textureLocation,
            quadBuffer,
            texture
        });
    }

    createProgram(gl) {
        const vertexShaderSource = `
            attribute vec2 a_position;
            attribute vec2 a_texCoord;
            varying vec2 v_texCoord;

            void main() {
                gl_Position = vec4(a_position, 0.0, 1.0);
                v_texCoord = a_texCoord;
            }
        `;

        const fragmentShaderSource = `
            precision mediump float;
            varying vec2 v_texCoord;
            uniform sampler2D u_texture;

            void main() {
                gl_FragColor = texture2D(u_texture, v_texCoord);
            }
        `;

        const vertexShader = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vertexShader, vertexShaderSource);
        gl.compileShader(vertexShader);

        if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
            const error = gl.getShaderInfoLog(vertexShader);
            gl.deleteShader(vertexShader);
            throw new Error(`Vertex shader compile failed: ${error}`);
        }

        const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fragmentShader, fragmentShaderSource);
        gl.compileShader(fragmentShader);

        if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
            const error = gl.getShaderInfoLog(fragmentShader);
            gl.deleteShader(vertexShader);
            gl.deleteShader(fragmentShader);
            throw new Error(`Fragment shader compile failed: ${error}`);
        }

        const program = gl.createProgram();
        gl.attachShader(program, vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);

        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            const error = gl.getProgramInfoLog(program);
            gl.deleteProgram(program);
            throw new Error(`Program link failed: ${error}`);
        }

        return program;
    }

    async getVideoElementForClip(clipSource) {
        const sourceUrl = clipSource?.url;

        if (!sourceUrl) {
            throw new Error('Timeline clip has no URL source.');
        }

        if (this.videoCache.has(sourceUrl)) {
            return this.videoCache.get(sourceUrl);
        }

        const video = document.createElement('video');
        video.preload = 'auto';
        video.muted = true;
        video.playsInline = true;
        video.crossOrigin = 'anonymous';
        video.src = sourceUrl;

        await new Promise((resolve, reject) => {
            const onLoadedMetadata = () => {
                cleanup();
                resolve();
            };

            const onError = () => {
                cleanup();
                reject(new Error(`Failed to load clip for preview: ${sourceUrl}`));
            };

            const cleanup = () => {
                video.removeEventListener('loadedmetadata', onLoadedMetadata);
                video.removeEventListener('error', onError);
            };

            video.addEventListener('loadedmetadata', onLoadedMetadata);
            video.addEventListener('error', onError);
        });

        this.videoCache.set(sourceUrl, video);
        return video;
    }

    async seekVideo(video, seconds) {
        const safeTarget = Math.max(0, Math.min(seconds, Math.max(0, video.duration - 0.001)));

        if (Number.isFinite(video.currentTime) && Math.abs(video.currentTime - safeTarget) <= this.seekToleranceSeconds) {
            return;
        }

        await new Promise((resolve, reject) => {
            const onSeeked = () => {
                cleanup();
                resolve();
            };

            const onError = () => {
                cleanup();
                reject(new Error('Failed to seek video for frame extraction.'));
            };

            const cleanup = () => {
                video.removeEventListener('seeked', onSeeked);
                video.removeEventListener('error', onError);
            };

            video.addEventListener('seeked', onSeeked, { once: true });
            video.addEventListener('error', onError, { once: true });
            video.currentTime = safeTarget;
        });
    }

    resizeCanvasToDisplaySize(canvas, quality = this.drawQuality) {
        const normalizedQuality = this.normalizeDrawQuality(quality);
        const qualityScale = 0.3 + ((normalizedQuality - 1) / 8) * 0.7;
        const dpr = Math.min(window.devicePixelRatio || 1, this.maxPreviewDpr) * qualityScale;
        const rect = canvas.getBoundingClientRect();
        const targetWidth = Math.max(1, Math.floor(rect.width * dpr));
        const targetHeight = Math.max(1, Math.floor(rect.height * dpr));

        if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
            canvas.width = targetWidth;
            canvas.height = targetHeight;
        }
    }

    drawVideoFrameToPreview(preview, video, quality = this.drawQuality) {
        const {
            canvas,
            gl,
            program,
            positionLocation,
            texCoordLocation,
            textureLocation,
            quadBuffer,
            texture
        } = preview;

        this.resizeCanvasToDisplaySize(canvas, quality);

        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);

        const sourceWidth = video.videoWidth || 1;
        const sourceHeight = video.videoHeight || 1;
        const sourceAspect = sourceWidth / sourceHeight;
        const canvasAspect = canvas.width / canvas.height;

        let drawWidth = canvas.width;
        let drawHeight = canvas.height;

        if (sourceAspect > canvasAspect) {
            // Wider than destination: letterbox top/bottom.
            drawHeight = Math.floor(drawWidth / sourceAspect);
        } else {
            // Taller than destination: pillarbox left/right.
            drawWidth = Math.floor(drawHeight * sourceAspect);
        }

        const viewportX = Math.floor((canvas.width - drawWidth) / 2);
        const viewportY = Math.floor((canvas.height - drawHeight) / 2);
        gl.viewport(viewportX, viewportY, drawWidth, drawHeight);

        gl.useProgram(program);
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);

        gl.enableVertexAttribArray(positionLocation);
        gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 16, 0);

        gl.enableVertexAttribArray(texCoordLocation);
        gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 16, 8);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);

        // Only re-upload when the video has advanced to a new frame.
        const lastUploadedTime = preview._lastUploadedVideoTime ?? -1;
        if (Math.abs(video.currentTime - lastUploadedTime) >= 0.001) {
            preview._lastUploadedVideoTime = video.currentTime;

            const normalizedQuality = this.normalizeDrawQuality(quality);
            const qualityScale = 0.3 + ((normalizedQuality - 1) / 8) * 0.7;

            // For quality < 9, downsample via OffscreenCanvas so the texture
            // upload cost shrinks proportionally — this is what makes the
            // quality setting actually affect GPU throughput.
            if (qualityScale < 0.95 && video.videoWidth > 0) {
                const tw = Math.max(2, Math.floor(video.videoWidth * qualityScale));
                const th = Math.max(2, Math.floor(video.videoHeight * qualityScale));

                if (!preview.offscreenCanvas || preview.offscreenCanvas.width !== tw || preview.offscreenCanvas.height !== th) {
                    preview.offscreenCanvas = new OffscreenCanvas(tw, th);
                    preview.offscreenCtx = preview.offscreenCanvas.getContext('2d');
                }

                preview.offscreenCtx.drawImage(video, 0, 0, tw, th);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, preview.offscreenCanvas);
            } else {
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
            }
        }

        gl.uniform1i(textureLocation, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    clearPreview(preview, quality = this.drawQuality) {
        const { canvas, gl } = preview;
        this.resizeCanvasToDisplaySize(canvas, quality);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
    }

    async syncVideoForTimeline(video, targetSeconds, isPlaybackActive) {
        const drift = Math.abs((video.currentTime || 0) - targetSeconds);

        if (isPlaybackActive) {
            if (drift > this.playbackSeekDriftToleranceSeconds) {
                await this.seekVideo(video, targetSeconds);
            }

            if (video.paused) {
                try {
                    await video.play();
                } catch {
                    // Autoplay can be blocked by policy; seek fallback still works.
                }
            }
        } else {
            if (!video.paused) {
                video.pause();
            }
            await this.seekVideo(video, targetSeconds);
        }
    }

    async drawCurrentFrame(quality = this.drawQuality){
        const normalizedQuality = this.normalizeDrawQuality(quality);
        this.pruneDisconnectedPreviews();

        const nowMs = performance.now();
        const minFrameIntervalMs = 1000 / this.targetFps;
        if (nowMs - this.lastDrawAtMs < minFrameIntervalMs) {
            return;
        }

        if (this.isDrawing) {
            if (this.enableDebugTimingLogs) {
                console.debug('[Compose] drawCurrentFrame skipped: previous draw still in progress');
            }
            return;
        }

        this.isDrawing = true;
        const frameStartMs = performance.now();
        let didRenderFrame = false;

        try {
            if (this.previews.length === 0 || !window.timelineUI) {
                return;
            }

            const currentSeconds = window.timelineUI.getPlayPosition();
            const firstTrack = window.timelineUI.tracks?.[0];

            if (!firstTrack || !Array.isArray(firstTrack.sequence)) {
                this.previews.forEach(preview => this.clearPreview(preview, normalizedQuality));
                return;
            }

            const currentClip = firstTrack.sequence.find(clip => (
                currentSeconds >= clip.position &&
                currentSeconds <= (clip.position + clip.duration)
            ));

            if (!currentClip || !currentClip.clip) {
                this._stopRvfc();
                if (this.activeVideoUrl && this.videoCache.has(this.activeVideoUrl)) {
                    const activeVideo = this.videoCache.get(this.activeVideoUrl);
                    if (activeVideo && !activeVideo.paused) {
                        activeVideo.pause();
                    }
                    this.activeVideoUrl = null;
                }
                this.previews.forEach(preview => this.clearPreview(preview, normalizedQuality));
                return;
            }

            const clipLocalSeconds =
                Math.max(0, currentSeconds - (Number(currentClip.position) || 0)) + (Number(currentClip.start) || 0);

            const clipFrameIndex = Math.floor(clipLocalSeconds * this.targetFps);
            if (this.lastRenderedClipId === currentClip.id && this.lastRenderedFrameIndex === clipFrameIndex) {
                return;
            }

            const sourceVideo = await this.getVideoElementForClip(currentClip.clip);
            this.activeVideoUrl = currentClip.clip.url || null;
            const isPlaybackActive = Boolean(window.timelineUI?.playBackInterval);
            await this.syncVideoForTimeline(sourceVideo, clipLocalSeconds, isPlaybackActive);

            if (isPlaybackActive && sourceVideo.requestVideoFrameCallback) {
                // Hand off to requestVideoFrameCallback so texture uploads only
                // happen when the browser has a genuinely new decoded frame ready.
                this._startRvfc(sourceVideo);
            } else {
                this._stopRvfc();
                this.previews.forEach(preview => this.drawVideoFrameToPreview(preview, sourceVideo, normalizedQuality));
                didRenderFrame = true;
            }

            this.lastRenderedClipId = currentClip.id;
            this.lastRenderedFrameIndex = clipFrameIndex;

            if (didRenderFrame) {
                const renderNowMs = performance.now();
                if (this.lastRenderedAtMs > 0) {
                    const deltaMs = renderNowMs - this.lastRenderedAtMs;
                    if (deltaMs > 0) {
                        const instantaneousFps = 1000 / deltaMs;
                        const smoothing = 0.2;
                        this.smoothedFps = this.smoothedFps === 0
                            ? instantaneousFps
                            : (this.smoothedFps * (1 - smoothing)) + (instantaneousFps * smoothing);
                        this.emitFps(this.smoothedFps);
                    }
                } else {
                    this.emitFps(0);
                }
                this.lastRenderedAtMs = renderNowMs;
            }
        } catch (error) {
            console.error('Failed to draw current frame:', error);
        } finally {
            const elapsedMs = performance.now() - frameStartMs;
            if (this.enableDebugTimingLogs) {
                console.debug(
                    `[Compose] drawCurrentFrame completed in ${elapsedMs.toFixed(2)}ms (rendered=${didRenderFrame})`
                );
            }
            this.lastDrawAtMs = performance.now();
            this.isDrawing = false;
        }
    }

    async drawFrame(quality = this.drawQuality) {
        return this.drawCurrentFrame(quality);
    }

    // Start a requestVideoFrameCallback loop for the given video element.
    // The loop runs only while playback is active and self-terminates otherwise.
    _startRvfc(video) {
        if (!video.requestVideoFrameCallback) return;
        if (this.rvfcActiveVideo === video) return; // already looping for this video
        this._stopRvfc();
        this.rvfcActiveVideo = video;

        const schedule = () => {
            this.rvfcCallbackId = video.requestVideoFrameCallback(() => {
                if (!window.timelineUI?.playBackInterval || this.rvfcActiveVideo !== video) {
                    this.rvfcActiveVideo = null;
                    this.rvfcCallbackId = null;
                    return;
                }
                this.pruneDisconnectedPreviews();
                this.previews.forEach(p => this.drawVideoFrameToPreview(p, video, this.drawQuality));

                const renderNowMs = performance.now();
                if (this.lastRenderedAtMs > 0) {
                    const deltaMs = renderNowMs - this.lastRenderedAtMs;
                    if (deltaMs > 0) {
                        const instantFps = 1000 / deltaMs;
                        this.smoothedFps = this.smoothedFps === 0
                            ? instantFps
                            : (this.smoothedFps * 0.8) + (instantFps * 0.2);
                        this.emitFps(this.smoothedFps);
                    }
                }
                this.lastRenderedAtMs = renderNowMs;
                schedule();
            });
        };

        schedule();
    }

    _stopRvfc() {
        if (this.rvfcActiveVideo && this.rvfcCallbackId != null) {
            try {
                this.rvfcActiveVideo.cancelVideoFrameCallback(this.rvfcCallbackId);
            } catch {
                // Ignore if already fired or API unavailable.
            }
        }
        this.rvfcActiveVideo = null;
        this.rvfcCallbackId = null;
    }
}

export default Compose;