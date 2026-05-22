import ffmpeg, { loadFFmpeg } from './ffmpeg.js';

export default class Renderer {
    constructor() {
        this.ffmpeg = ffmpeg;
        this.loadPromise = loadFFmpeg().then(() => this.ffmpeg);
        this.maxPendingFrameWrites = 2;
        this.maxFramesPerChunk = 96;
    }

    async render(inPoint = null, outPoint = null) {
        await this.loadPromise;

        if (!window.timelineUI || window.timelineUI.getTimelineEndPosition() === 0) {
            window.setMessage('Timeline is empty. Nothing to render.', 'error', '#ff0000');
            return;
        }

        if (!window.project || typeof window.project.getProjectSettings !== 'function') {
            throw new Error('Project settings are not available.');
        }

        const projectSettings = window.project.getProjectSettings();
        const targetWidth = Math.max(1, Math.floor(Number(projectSettings.width) || 1920));
        const targetHeight = Math.max(1, Math.floor(Number(projectSettings.height) || 1080));
        const targetFps = Math.max(1, Number(projectSettings.frameRate) || 24);

        const timelineEnd = Number(window.timelineUI.getTimelineEndPosition()) || 0;
        const startSeconds = Number.isFinite(inPoint) ? Math.max(0, Number(inPoint)) : 0;
        const endSeconds = Number.isFinite(outPoint) ? Math.min(Math.max(startSeconds, Number(outPoint)), timelineEnd) : timelineEnd;

        if (endSeconds <= startSeconds) {
            window.setMessage('Render range is empty.', 'alert-triangle', '#ffb020', 4000);
            return;
        }

        await this.prepareTimelineAudioClips();

        const renderCanvases = this.createRenderCanvases(targetWidth, targetHeight, 2);

        const totalFrames = Math.max(1, Math.ceil((endSeconds - startSeconds) * targetFps));
        const framePad = Math.max(4, String(this.maxFramesPerChunk).length);
        const canvasLocks = renderCanvases.map(() => Promise.resolve());
        const segmentFileNames = [];
        const tempFiles = [];
        const sourceAudioFiles = [];

        window.setProgress("Rendering...", 0);

        try {
            const totalChunks = Math.ceil(totalFrames / this.maxFramesPerChunk);

            for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
                const chunkStartFrame = chunkIndex * this.maxFramesPerChunk;
                const chunkFrameCount = Math.min(this.maxFramesPerChunk, totalFrames - chunkStartFrame);
                const chunkFrameFileNames = [];
                const pendingFrameWrites = new Set();

                for (let chunkFrameOffset = 0; chunkFrameOffset < chunkFrameCount; chunkFrameOffset += 1) {
                    const absoluteFrameIndex = chunkStartFrame + chunkFrameOffset;
                    const canvasIndex = absoluteFrameIndex % renderCanvases.length;
                    const activeCanvas = renderCanvases[canvasIndex];
                    await canvasLocks[canvasIndex];

                    const seconds = startSeconds + (absoluteFrameIndex / targetFps);
                    await window.composer.renderTimelineFrameToCanvas(seconds, activeCanvas, 9);

                    const chunkFrameFileName = `frame_${String(chunkFrameOffset).padStart(framePad, '0')}.png`;
                    chunkFrameFileNames.push(chunkFrameFileName);

                    const frameWriteTask = this.writeCanvasFrame(activeCanvas, chunkFrameFileName);
                    canvasLocks[canvasIndex] = frameWriteTask.catch(() => {});
                    pendingFrameWrites.add(frameWriteTask);
                    frameWriteTask.finally(() => {
                        pendingFrameWrites.delete(frameWriteTask);
                    });

                    if (pendingFrameWrites.size >= this.maxPendingFrameWrites) {
                        await Promise.race(pendingFrameWrites);
                    }

                    const progress = Math.min(92, Math.floor(((absoluteFrameIndex + 1) / totalFrames) * 92));
                    window.setProgress(`Rendering... (${progress.toFixed(0)}%)`, progress);
                }

                if (pendingFrameWrites.size > 0) {
                    await Promise.all(pendingFrameWrites);
                }

                const chunkOutputFileName = `segment_${String(chunkIndex).padStart(4, '0')}.mp4`;
                await this.ffmpeg.exec([
                    '-framerate', String(targetFps),
                    '-i', `frame_%0${framePad}d.png`,
                    '-c:v', 'libx264',
                    '-preset', 'veryfast',
                    '-crf', '18',
                    '-pix_fmt', 'yuv420p',
                    '-movflags', '+faststart',
                    '-an',
                    chunkOutputFileName
                ]);

                segmentFileNames.push(chunkOutputFileName);

                await this.cleanupRenderFiles(chunkFrameFileNames);

                const chunkProgress = 92 + Math.floor(((chunkIndex + 1) / totalChunks) * 4);
                window.setProgress(`Encoding chunks... (${chunkProgress.toFixed(0)}%)`, chunkProgress);
            }

            const concatListFileName = 'render_segments.txt';
            const concatList = segmentFileNames
                .map(fileName => `file '${fileName}'`)
                .join('\n');
            await this.ffmpeg.writeFile(concatListFileName, new TextEncoder().encode(`${concatList}\n`));
            tempFiles.push(concatListFileName);

            const stitchedVideoFileName = `render_video_${new Date().toISOString().replace(/[:.]/g, '-')}.mp4`;
            await this.ffmpeg.exec([
                '-f', 'concat',
                '-safe', '0',
                '-i', concatListFileName,
                '-c', 'copy',
                stitchedVideoFileName
            ]);
            tempFiles.push(stitchedVideoFileName);

            window.setProgress('Rendering audio...', 97);

            const audioMixResult = await this.buildTimelineAudioMix(startSeconds, endSeconds);
            if (audioMixResult?.sourceFiles?.length) {
                sourceAudioFiles.push(...audioMixResult.sourceFiles);
            }

            const outputFileName = `render_${new Date().toISOString().replace(/[:.]/g, '-')}.mp4`;

            if (audioMixResult?.audioFileName) {
                tempFiles.push(audioMixResult.audioFileName);
                await this.ffmpeg.exec([
                    '-i', stitchedVideoFileName,
                    '-i', audioMixResult.audioFileName,
                    '-c:v', 'copy',
                    '-c:a', 'aac',
                    '-b:a', '192k',
                    '-shortest',
                    '-movflags', '+faststart',
                    outputFileName
                ]);
            } else {
                await this.ffmpeg.exec([
                    '-i', stitchedVideoFileName,
                    '-c:v', 'copy',
                    '-movflags', '+faststart',
                    outputFileName
                ]);
            }

            const outputBytes = await this.ffmpeg.readFile(outputFileName);
            const outputFile = new File([outputBytes], outputFileName, { type: 'video/mp4' });
            const outputUrl = URL.createObjectURL(outputFile);

            const downloadLink = document.createElement('a');
            downloadLink.href = outputUrl;
            downloadLink.download = outputFileName;
            document.body.appendChild(downloadLink);
            downloadLink.click();
            downloadLink.remove();

            if (typeof window.setProgress === 'function') {
                window.setProgress('Render complete', 100);
            }
            if (typeof window.stopProgress === 'function') {
                window.stopProgress();
            }

            window.setMessage(`Render complete: ${outputFileName}`, 'check', '#00c26e', 6000);

            URL.revokeObjectURL(outputUrl);
            await this.cleanupRenderFiles(segmentFileNames);
            await this.cleanupRenderFiles(tempFiles, outputFileName);
            await this.cleanupRenderFiles(sourceAudioFiles);

            return outputFile;
        } catch (error) {
            await this.cleanupRenderFiles(segmentFileNames);
            await this.cleanupRenderFiles(tempFiles);
            await this.cleanupRenderFiles(sourceAudioFiles);

            console.error('Render failed:', error);
            if (typeof window.progressError === 'function') {
                window.progressError('Render failed');
            }
            throw error;
        } finally {
            if (typeof window.stopProgress === 'function') {
                window.stopProgress();
            }
        }
    }

    async prepareTimelineAudioClips() {
        if (!window.transcoder || typeof window.transcoder.transcodeClipToProjectSettings !== 'function') {
            return;
        }

        const clipsToTranscode = new Map();

        for (const track of window.timelineUI?.tracks || []) {
            for (const timelineClip of track.sequence || []) {
                const clip = timelineClip?.clip;
                const clipName = clip?.name;
                const clipProperties = clip?.properties;

                if (!clipName || !clipProperties) {
                    continue;
                }

                const needsAudioTranscode = Number(clipProperties.audio_tracks || 0) > 0
                    && clipProperties.problem !== 'none';

                if (needsAudioTranscode) {
                    clipsToTranscode.set(clipName, clip);
                }
            }
        }

        for (const clipName of clipsToTranscode.keys()) {
            await window.transcoder.transcodeClipToProjectSettings(clipName);
        }
    }

    async canvasToBlob(canvas) {
        if (typeof canvas.convertToBlob === 'function') {
            return canvas.convertToBlob({ type: 'image/png' });
        }

        return new Promise((resolve, reject) => {
            canvas.toBlob(blob => {
                if (blob) {
                    resolve(blob);
                } else {
                    reject(new Error('Failed to serialize render frame.'));
                }
            }, 'image/png');
        });
    }

    createRenderCanvases(width, height, count = 2) {
        const safeCount = Math.max(1, Math.floor(Number(count) || 1));
        const canvases = [];

        for (let index = 0; index < safeCount; index += 1) {
            const renderCanvas = document.createElement('canvas');
            renderCanvas.width = width;
            renderCanvas.height = height;

            window.composer.createSurfaceRenderer(renderCanvas, {
                fixedSize: {
                    width,
                    height
                }
            });

            canvases.push(renderCanvas);
        }

        return canvases;
    }

    async writeCanvasFrame(canvas, frameFileName) {
        const blob = await this.canvasToBlob(canvas);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        await this.ffmpeg.writeFile(frameFileName, bytes);
    }

    async buildTimelineAudioMix(startSeconds, endSeconds) {
        const audioTracks = typeof window.timelineUI?.getAudioTracks === 'function'
            ? window.timelineUI.getAudioTracks()
            : [];

        const renderRangeDuration = Math.max(0, endSeconds - startSeconds);
        if (audioTracks.length === 0 || renderRangeDuration <= 0) {
            return { audioFileName: null, sourceFiles: [] };
        }

        const mixItems = this.collectAudioMixItems(audioTracks, startSeconds, endSeconds);
        if (mixItems.length === 0) {
            return { audioFileName: null, sourceFiles: [] };
        }

        const sourceFileMap = new Map();
        const sourceFiles = [];

        for (const item of mixItems) {
            const sourceFileName = await this.ensureClipSourceFile(item.clipSource, sourceFileMap);
            if (!sourceFiles.includes(sourceFileName)) {
                sourceFiles.push(sourceFileName);
            }
            item.sourceFileName = sourceFileName;
        }

        const inputArgs = [];
        const sourceInputs = [...sourceFileMap.values()];
        sourceInputs.forEach(sourceInput => {
            inputArgs.push('-i', sourceInput.fileName);
        });

        const sourceIndexByName = new Map(sourceInputs.map((sourceInput, index) => [sourceInput.fileName, index]));
        const mixFilters = [];
        const mixLabels = [];

        mixItems.forEach((item, itemIndex) => {
            const inputIndex = sourceIndexByName.get(item.sourceFileName);
            const trimStart = this.normalizeFilterSeconds(item.sourceTrimStart);
            const trimDuration = this.normalizeFilterSeconds(item.sourceTrimDuration);
            const delayMs = Math.max(0, Math.round(item.timelineDelaySeconds * 1000));
            const label = `a${itemIndex}`;

            mixFilters.push(
                `[${inputIndex}:a]atrim=start=${trimStart}:duration=${trimDuration},asetpts=PTS-STARTPTS,adelay=${delayMs}|${delayMs}[${label}]`
            );
            mixLabels.push(`[${label}]`);
        });

        if (mixLabels.length === 0) {
            return { audioFileName: null, sourceFiles };
        }

        if (mixLabels.length === 1) {
            mixFilters.push(`${mixLabels[0]}anull[aout]`);
        } else {
            mixFilters.push(`${mixLabels.join('')}amix=inputs=${mixLabels.length}:normalize=0:dropout_transition=0[aout]`);
        }

        const filterComplex = mixFilters.join(';');
        const audioOutputFileName = `render_audio_${Date.now()}.m4a`;

        await this.ffmpeg.exec([
            ...inputArgs,
            '-filter_complex', filterComplex,
            '-map', '[aout]',
            '-c:a', 'aac',
            '-b:a', '192k',
            '-movflags', '+faststart',
            audioOutputFileName
        ]);

        return { audioFileName: audioOutputFileName, sourceFiles };
    }

    collectAudioMixItems(audioTracks, startSeconds, endSeconds) {
        const items = [];

        for (const track of audioTracks || []) {
            for (const timelineClip of track.sequence || []) {
                const clipSource = timelineClip?.clip;
                if (!clipSource) {
                    continue;
                }

                const clipTimelineStart = Number(timelineClip.position) || 0;
                const clipDuration = Math.max(0, Number(timelineClip.duration) || 0);
                const clipTimelineEnd = clipTimelineStart + clipDuration;
                const overlapStart = Math.max(startSeconds, clipTimelineStart);
                const overlapEnd = Math.min(endSeconds, clipTimelineEnd);

                if (overlapEnd <= overlapStart) {
                    continue;
                }

                const clipSourceOffset = Number(timelineClip.start) || 0;
                const sourceTrimStart = clipSourceOffset + Math.max(0, overlapStart - clipTimelineStart);
                const sourceTrimDuration = Math.max(0, overlapEnd - overlapStart);
                const timelineDelaySeconds = Math.max(0, overlapStart - startSeconds);

                items.push({
                    clipSource,
                    sourceTrimStart,
                    sourceTrimDuration,
                    timelineDelaySeconds
                });
            }
        }

        return items;
    }

    normalizeFilterSeconds(value) {
        const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
        return safeValue.toFixed(6);
    }

    async ensureClipSourceFile(clipSource, sourceFileMap) {
        const sourceKey = clipSource?.id || clipSource?.name || clipSource?.url;
        if (!sourceKey) {
            throw new Error('Audio clip source is missing identifier.');
        }

        const existing = sourceFileMap.get(sourceKey);
        if (existing) {
            return existing.fileName;
        }

        const sourceIndex = sourceFileMap.size;
        const extension = this.getClipSourceExtension(clipSource);
        const fileName = `audio_source_${String(sourceIndex).padStart(4, '0')}${extension}`;
        const bytes = await this.readClipSourceBytes(clipSource);
        await this.ffmpeg.writeFile(fileName, bytes);

        sourceFileMap.set(sourceKey, { fileName });
        return fileName;
    }

    getClipSourceExtension(clipSource) {
        const name = String(clipSource?.name || '').toLowerCase();
        const matchedExtension = name.match(/\.[a-z0-9]{2,5}$/i)?.[0];
        if (matchedExtension) {
            return matchedExtension;
        }

        const mimeType = String(clipSource?.file?.type || '');
        if (mimeType.includes('webm')) return '.webm';
        if (mimeType.includes('ogg')) return '.ogg';
        if (mimeType.includes('mp3')) return '.mp3';
        if (mimeType.includes('wav')) return '.wav';
        if (mimeType.includes('aac')) return '.aac';
        return '.mp4';
    }

    async readClipSourceBytes(clipSource) {
        if (clipSource?.file instanceof Blob) {
            return new Uint8Array(await clipSource.file.arrayBuffer());
        }

        if (typeof clipSource?.url === 'string' && clipSource.url.length > 0) {
            const response = await fetch(clipSource.url);
            if (!response.ok) {
                throw new Error(`Failed to fetch clip source for audio render: ${clipSource.url}`);
            }

            return new Uint8Array(await response.arrayBuffer());
        }

        throw new Error('Audio clip source is not readable.');
    }

    async cleanupRenderFiles(frameFileNames = [], outputFileName = null) {
        const deletes = frameFileNames.map(frameFileName => this.ffmpeg.deleteFile(frameFileName).catch(() => {}));

        if (outputFileName) {
            deletes.push(this.ffmpeg.deleteFile(outputFileName).catch(() => {}));
        }

        await Promise.all(deletes);
    }
}