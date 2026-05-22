// This file converts the timeline play position into WebGL frames for realtime playback.

import { applyEffectToFrame } from './effects.js';

class Compose {
    constructor() {
        this.previews = [];
        this.isDrawing = false;
        this.videoCache = new Map();
        this.targetFps = 23.976;
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

    setTargetFps(fps) {
        if (Number.isFinite(fps) && fps > 0) {
            this.targetFps = fps;
        }
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

        this.previews.push(this.createSurfaceRenderer(canvasObject));
    }

    createSurfaceRenderer(canvasObject, options = {}) {
        const fixedSize = options.fixedSize || null;

        if (!fixedSize) {
            canvasObject.style.display = 'block';
            canvasObject.style.width = '100%';
            canvasObject.style.height = '100%';
        }

        const gl = canvasObject.getContext('webgl', {
            alpha: true,
            antialias: false,
            desynchronized: true,
            preserveDrawingBuffer: true,
            powerPreference: 'low-power'
        });

        if (!gl) {
            throw new Error('Failed to get WebGL context from canvas for preview.');
        }

        const program = this.createProgram(gl);
        const effectProgram = this.createEffectProgram(gl);
        const positionLocation = gl.getAttribLocation(program, 'a_position');
        const texCoordLocation = gl.getAttribLocation(program, 'a_texCoord');
        const textureLocation = gl.getUniformLocation(program, 'u_texture');
        const effectPositionLocation = gl.getAttribLocation(effectProgram, 'a_position');
        const effectTexCoordLocation = gl.getAttribLocation(effectProgram, 'a_texCoord');
        const effectTextureLocation = gl.getUniformLocation(effectProgram, 'u_texture');
        const effectSaturationLocation = gl.getUniformLocation(effectProgram, 'u_saturation');
        const effectKeyEnabledLocation = gl.getUniformLocation(effectProgram, 'u_keyEnabled');
        const effectKeyColorLocation = gl.getUniformLocation(effectProgram, 'u_keyColor');
        const effectKeyThresholdLocation = gl.getUniformLocation(effectProgram, 'u_keyThreshold');
        const effectKeySoftnessLocation = gl.getUniformLocation(effectProgram, 'u_keySoftness');

        const quadBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
        gl.bufferData(
            gl.ARRAY_BUFFER,
            new Float32Array([
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

        return {
            canvas: canvasObject,
            gl,
            program,
            effectProgram,
            positionLocation,
            texCoordLocation,
            textureLocation,
            effectPositionLocation,
            effectTexCoordLocation,
            effectTextureLocation,
            effectSaturationLocation,
            effectKeyEnabledLocation,
            effectKeyColorLocation,
            effectKeyThresholdLocation,
            effectKeySoftnessLocation,
            quadBuffer,
            texture,
            fixedSize
        };
    }

    parseHexColorToRgb01(hexValue) {
        const fallback = [0, 1, 0];
        if (typeof hexValue !== 'string') {
            return fallback;
        }

        const normalized = hexValue.trim().replace(/^#/, '');
        const expanded = normalized.length === 3
            ? normalized.split('').map(channel => channel + channel).join('')
            : normalized;

        if (!/^[0-9a-fA-F]{6}$/.test(expanded)) {
            return fallback;
        }

        const red = Number.parseInt(expanded.slice(0, 2), 16) / 255;
        const green = Number.parseInt(expanded.slice(2, 4), 16) / 255;
        const blue = Number.parseInt(expanded.slice(4, 6), 16) / 255;
        return [red, green, blue];
    }

    buildEffectPipeline(effectChain) {
        const gpuConfig = {
            saturation: 1,
            keyEnabled: false,
            keyColor: [0, 1, 0],
            keyThreshold: 0.12,
            keySoftness: 0.08,
            hasGpuEffects: false,
        };

        const cpuEffects = [];

        for (const effect of effectChain) {
            const effectName = effect?.name;
            const parameters = effect?.parameters || {};

            if (effectName === 'Saturation') {
                const factor = Math.max(0, Number(parameters.saturation) || 0) / 100;
                gpuConfig.saturation *= factor;
                gpuConfig.hasGpuEffects = true;
                continue;
            }

            if (effectName === 'Greenscreen') {
                const variance = Math.max(0, Math.min(100, Number(parameters['greenscreen-variance']) || 0));
                gpuConfig.keyEnabled = true;
                gpuConfig.keyColor = this.parseHexColorToRgb01(parameters['greenscreen-color']);
                gpuConfig.keyThreshold = Math.max(0.001, (variance * 3.2) / 255);
                gpuConfig.keySoftness = Math.max(0.005, gpuConfig.keyThreshold * 0.5);
                gpuConfig.hasGpuEffects = true;
                continue;
            }

            cpuEffects.push(effect);
        }

        return { gpuConfig, cpuEffects };
    }

    getTimelineClipEffects(timelineClip) {
        const rawEffects = timelineClip?.effects ?? timelineClip?.appliedEffects ?? timelineClip?.clip?.effects ?? [];

        if (!Array.isArray(rawEffects)) {
            return [];
        }

        return rawEffects.map(effectEntry => {
            if (typeof effectEntry === 'string') {
                return { name: effectEntry, parameters: {} };
            }

            if (!effectEntry || typeof effectEntry !== 'object') {
                return null;
            }

            const effectName = effectEntry.name || effectEntry.effectName || effectEntry.id;
            if (!effectName) {
                return null;
            }

            return {
                name: effectName,
                parameters: effectEntry.parameters || effectEntry.values || {}
            };
        }).filter(Boolean);
    }

    getEffectCanvasState(preview, width, height) {
        if (!preview.effectSourceCanvas) {
            preview.effectSourceCanvas = document.createElement('canvas');
            preview.effectSourceCtx = preview.effectSourceCanvas.getContext('2d', { willReadFrequently: true });
        }

        if (!preview.effectWorkCanvas) {
            preview.effectWorkCanvas = document.createElement('canvas');
            preview.effectWorkCtx = preview.effectWorkCanvas.getContext('2d', { willReadFrequently: true });
        }

        if (preview.effectSourceCanvas.width !== width || preview.effectSourceCanvas.height !== height) {
            preview.effectSourceCanvas.width = width;
            preview.effectSourceCanvas.height = height;
        }

        if (preview.effectWorkCanvas.width !== width || preview.effectWorkCanvas.height !== height) {
            preview.effectWorkCanvas.width = width;
            preview.effectWorkCanvas.height = height;
        }

        return preview;
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

    createEffectProgram(gl) {
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
            uniform float u_saturation;
            uniform float u_keyEnabled;
            uniform vec3 u_keyColor;
            uniform float u_keyThreshold;
            uniform float u_keySoftness;

            void main() {
                vec4 color = texture2D(u_texture, v_texCoord);
                float luma = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
                color.rgb = vec3(luma) + ((color.rgb - vec3(luma)) * u_saturation);

                if (u_keyEnabled > 0.5) {
                    float dist = distance(color.rgb, u_keyColor);
                    float alpha = smoothstep(u_keyThreshold, u_keyThreshold + u_keySoftness, dist);
                    color.a *= alpha;
                    color.rgb *= alpha;
                }

                gl_FragColor = color;
            }
        `;

        const vertexShader = gl.createShader(gl.VERTEX_SHADER);
        gl.shaderSource(vertexShader, vertexShaderSource);
        gl.compileShader(vertexShader);

        if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
            const error = gl.getShaderInfoLog(vertexShader);
            gl.deleteShader(vertexShader);
            throw new Error(`Effect vertex shader compile failed: ${error}`);
        }

        const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(fragmentShader, fragmentShaderSource);
        gl.compileShader(fragmentShader);

        if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
            const error = gl.getShaderInfoLog(fragmentShader);
            gl.deleteShader(vertexShader);
            gl.deleteShader(fragmentShader);
            throw new Error(`Effect fragment shader compile failed: ${error}`);
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
            throw new Error(`Effect program link failed: ${error}`);
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
        const deviceDpr = window.devicePixelRatio || 1;
        // At max quality use full device DPR; otherwise cap at maxPreviewDpr and scale down.
        const dpr = normalizedQuality === 9
            ? deviceDpr
            : Math.min(deviceDpr, this.maxPreviewDpr) * qualityScale;
        const rect = canvas.getBoundingClientRect();
        const targetWidth = Math.max(1, Math.floor(rect.width * dpr));
        const targetHeight = Math.max(1, Math.floor(rect.height * dpr));

        if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
            canvas.width = targetWidth;
            canvas.height = targetHeight;
        }
    }

    _drawVideoFrame(preview, video, quality = this.drawQuality, effectChain = []) {
        const {
            canvas,
            gl,
            program,
            effectProgram,
            positionLocation,
            texCoordLocation,
            textureLocation,
            effectPositionLocation,
            effectTexCoordLocation,
            effectTextureLocation,
            effectSaturationLocation,
            effectKeyEnabledLocation,
            effectKeyColorLocation,
            effectKeyThresholdLocation,
            effectKeySoftnessLocation,
            quadBuffer,
            texture,
            fixedSize
        } = preview;

        if (fixedSize) {
            const targetWidth = Math.max(1, Math.floor(fixedSize.width));
            const targetHeight = Math.max(1, Math.floor(fixedSize.height));
            if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
                canvas.width = targetWidth;
                canvas.height = targetHeight;
            }
        } else {
            this.resizeCanvasToDisplaySize(canvas, quality);
        }

        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);

        const sourceWidth = video.videoWidth || 1;
        const sourceHeight = video.videoHeight || 1;
        const sourceAspect = sourceWidth / sourceHeight;
        const canvasAspect = canvas.width / canvas.height;

        let drawWidth = canvas.width;
        let drawHeight = canvas.height;

        if (!fixedSize) {
            if (sourceAspect > canvasAspect) {
                // Wider than destination: letterbox top/bottom.
                drawHeight = Math.floor(drawWidth / sourceAspect);
            } else {
                // Taller than destination: pillarbox left/right.
                drawWidth = Math.floor(drawHeight * sourceAspect);
            }
        }

        const viewportX = Math.floor((canvas.width - drawWidth) / 2);
        const viewportY = Math.floor((canvas.height - drawHeight) / 2);
        gl.viewport(viewportX, viewportY, drawWidth, drawHeight);

        const activeEffects = Array.isArray(effectChain)
            ? effectChain.filter(effect => effect && effect.name)
            : [];

        if (activeEffects.length > 0) {
            const normalizedQuality = this.normalizeDrawQuality(quality);
            const qualityScale = 0.3 + ((normalizedQuality - 1) / 8) * 0.7;
            const { gpuConfig, cpuEffects } = this.buildEffectPipeline(activeEffects);

            const sourceFrameWidth = qualityScale < 0.95 && sourceWidth > 0
                ? Math.max(2, Math.floor(sourceWidth * qualityScale))
                : sourceWidth;
            const sourceFrameHeight = qualityScale < 0.95 && sourceHeight > 0
                ? Math.max(2, Math.floor(sourceHeight * qualityScale))
                : sourceHeight;

            const effectSurface = this.getEffectCanvasState(preview, sourceFrameWidth, sourceFrameHeight);
            const { effectSourceCanvas, effectSourceCtx } = effectSurface;

            effectSourceCtx.save();
            effectSourceCtx.setTransform(1, 0, 0, 1, 0, 0);
            effectSourceCtx.clearRect(0, 0, effectSourceCanvas.width, effectSourceCanvas.height);
            effectSourceCtx.drawImage(video, 0, 0, effectSourceCanvas.width, effectSourceCanvas.height);
            effectSourceCtx.restore();

            for (const effect of cpuEffects) {
                applyEffectToFrame(effect.name, effect.parameters, effectSourceCanvas);
            }

            const useGpuProgram = gpuConfig.hasGpuEffects;
            gl.useProgram(useGpuProgram ? effectProgram : program);
            gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);

            if (useGpuProgram) {
                gl.enableVertexAttribArray(effectPositionLocation);
                gl.vertexAttribPointer(effectPositionLocation, 2, gl.FLOAT, false, 16, 0);
                gl.enableVertexAttribArray(effectTexCoordLocation);
                gl.vertexAttribPointer(effectTexCoordLocation, 2, gl.FLOAT, false, 16, 8);
            } else {
                gl.enableVertexAttribArray(positionLocation);
                gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 16, 0);
                gl.enableVertexAttribArray(texCoordLocation);
                gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 16, 8);
            }

            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, effectSourceCanvas);

            if (useGpuProgram) {
                gl.uniform1i(effectTextureLocation, 0);
                gl.uniform1f(effectSaturationLocation, gpuConfig.saturation);
                gl.uniform1f(effectKeyEnabledLocation, gpuConfig.keyEnabled ? 1 : 0);
                gl.uniform3f(effectKeyColorLocation, gpuConfig.keyColor[0], gpuConfig.keyColor[1], gpuConfig.keyColor[2]);
                gl.uniform1f(effectKeyThresholdLocation, gpuConfig.keyThreshold);
                gl.uniform1f(effectKeySoftnessLocation, gpuConfig.keySoftness);
            } else {
                gl.uniform1i(textureLocation, 0);
            }

            gl.drawArrays(gl.TRIANGLES, 0, 6);
            return;
        }

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

    drawVideoFrameToPreview(preview, video, quality = this.drawQuality, effectChain = []) {
        this._drawVideoFrame(preview, video, quality, effectChain);
    }

    async renderTimelineFrameToCanvas(seconds, canvasObject, quality = this.drawQuality) {
        const preview = canvasObject._rendrPreviewSurface || this.createSurfaceRenderer(canvasObject, {
            fixedSize: {
                width: canvasObject.width || 1,
                height: canvasObject.height || 1
            }
        });

        canvasObject._rendrPreviewSurface = preview;

        const currentSeconds = Number(seconds) || 0;
        const firstTrack = window.timelineUI?.tracks?.[0];

        if (!firstTrack || !Array.isArray(firstTrack.sequence)) {
            this.clearPreview(preview, quality);
            return false;
        }

        const currentClip = firstTrack.sequence.find(clip => (
            currentSeconds >= clip.position &&
            currentSeconds <= (clip.position + clip.duration)
        ));

        if (!currentClip || !currentClip.clip) {
            this.clearPreview(preview, quality);
            return false;
        }

        const clipLocalSeconds =
            Math.max(0, currentSeconds - (Number(currentClip.position) || 0)) + (Number(currentClip.start) || 0);

        const sourceVideo = await this.getVideoElementForClip(currentClip.clip);
        await this.syncVideoForTimeline(sourceVideo, clipLocalSeconds, false);
        const effectChain = this.getTimelineClipEffects(currentClip);
        this._drawVideoFrame(preview, sourceVideo, quality, effectChain);
        return true;
    }

    clearPreview(preview, quality = this.drawQuality) {
        const { canvas, gl, fixedSize } = preview;

        if (fixedSize) {
            const targetWidth = Math.max(1, Math.floor(fixedSize.width));
            const targetHeight = Math.max(1, Math.floor(fixedSize.height));
            if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
                canvas.width = targetWidth;
                canvas.height = targetHeight;
            }
        } else {
            this.resizeCanvasToDisplaySize(canvas, quality);
        }

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
                const effectChain = this.getTimelineClipEffects(currentClip);
                this.previews.forEach(preview => this.drawVideoFrameToPreview(preview, sourceVideo, normalizedQuality, effectChain));
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
                const currentSeconds = window.timelineUI?.getPlayPosition?.() || 0;
                const firstTrack = window.timelineUI?.tracks?.[0];
                const currentClip = firstTrack?.sequence?.find(clip => (
                    currentSeconds >= clip.position &&
                    currentSeconds <= (clip.position + clip.duration)
                ));
                const effectChain = this.getTimelineClipEffects(currentClip);
                this.previews.forEach(p => this.drawVideoFrameToPreview(p, video, this.drawQuality, effectChain));

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