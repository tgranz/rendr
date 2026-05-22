// This file contains the functions to transcode files using ffmpeg.wasm.

import ffmpeg, { loadFFmpeg } from './ffmpeg.js';

export default class Transcoder {
    constructor() {
        this.ffmpeg = ffmpeg;
        this.isLoaded = false;
        this.loadPromise = null;
        this.activeProgressLabel = 'Transcoding';

        this.bindProgressEvents();

        this.loadPromise = loadFFmpeg().then(() => {
            this.isLoaded = true;
            return this.ffmpeg;
        }).catch(err => {
            console.error('Failed to load FFmpeg:', err);
            this.reportProgressError('Failed to load FFmpeg');
            window.setMessage('Failed to load FFmpeg', 'alert-triangle', '#ff2121');
            throw err;
        });
    }

    bindProgressEvents() {
        if (this.ffmpeg.__rendrProgressHookAttached) {
            return;
        }

        this.ffmpeg.on('progress', ({ progress }) => {
            const boundedProgress = Math.max(0, Math.min(1, Number(progress) || 0));
            const progressPercent = Number((boundedProgress * 100).toFixed(2));

            if (typeof window.setProgress === 'function') {
                window.setProgress(`Transcoding... (${progressPercent.toFixed(1)}%)`, progressPercent);
            }

            if (progressPercent >= 100 && typeof window.stopProgress === 'function') {
                window.stopProgress();
            }
        });

        this.ffmpeg.__rendrProgressHookAttached = true;
    }

    reportProgressError(message) {
        if (typeof window.setError === 'function') {
            window.setError(message);
            return;
        }

        if (typeof window.progressError === 'function') {
            window.progressError(message);
        }
    }

    async transcodeClip(clipName) {
        await this.loadPromise;

        const projectBin = window.projectBin;
        if (!projectBin || typeof projectBin.getClips !== 'function') {
            throw new Error('Project bin is not ready.');
        }

        const clips = projectBin.getClips();
        const clip = clips.find(c => c.name === clipName);
        if (!clip) {
            console.warn(`Clip not found for transcoding: ${clipName}`);
            return;
        }

        try {
            if (typeof window.setProgress === 'function') {
                window.setProgress('Preparing transcode', 0);
            }

            const transcodedFile = await this.transcodeToAacFile(clip.file, clip.name);

            const oldUrl = clip.url;
            const newUrl = URL.createObjectURL(transcodedFile);

            clip.file = transcodedFile;
            clip.url = newUrl;
            clip.name = transcodedFile.name;

            if (oldUrl && oldUrl.startsWith('blob:')) {
                URL.revokeObjectURL(oldUrl);
            }

            const clipMediaInfo = projectBin.clipMediaInfo;
            if (clipMediaInfo && typeof clipMediaInfo.getClipProperties === 'function') {
                clip.properties = await clipMediaInfo.getClipProperties(clip.file);
            }

            if (typeof projectBin.getThumbnail === 'function') {
                try {
                    clip.thumbnail = await projectBin.getThumbnail(clip.name, 5);
                } catch (thumbnailError) {
                    console.warn(`Failed to refresh thumbnail for ${clip.name}:`, thumbnailError);
                }
            }

            if (typeof window.setProgress === 'function') {
                window.setProgress('Transcode complete', 100);
            }
            if (typeof window.stopProgress === 'function') {
                window.stopProgress();
            }

            if (typeof window.panels?.reRender === 'function') {
                window.panels.reRender('Project Bin');
                window.panels.reRender('Clip Preview');
                window.panels.reRender('Clip Properties');
            }

            window.setMessage(
                `Successfully transcoded ${clip.name}.`,
                'check',
                '#00c26e',
                6000
            );

            return clip;
        } catch (error) {
            console.error(`Transcode failed for ${clipName}:`, error);
            this.reportProgressError(`Transcode failed: ${clipName}`);
            throw error;
        }
    }


    async transcodeClipToProjectSettings(clipName) {
        await this.loadPromise;

        const projectBin = window.projectBin;
        if (!projectBin || typeof projectBin.getClips !== 'function') {
            throw new Error('Project bin is not ready.');
        }

        const clips = projectBin.getClips();
        const clip = clips.find(c => c.name === clipName);
        if (!clip) {
            console.warn(`Clip not found for transcoding: ${clipName}`);
            return;
        }

        const { width: targetWidth, height: targetHeight, frameRate: targetFps } = window.project.getProjectSettings();

        let clipProps = clip.properties;
        if (!clipProps && projectBin.clipMediaInfo) {
            clipProps = await projectBin.clipMediaInfo.getClipProperties(clip.file);
        }

        const needsAudioTranscode = !clipProps || clipProps.problem !== 'none';

        try {
            if (typeof window.setProgress === 'function') {
                window.setProgress('Preparing transcode', 0);
            }

            const transcodedFile = await this.transcodeFileToSettings(
                clip.file,
                clip.name,
                targetWidth,
                targetHeight,
                targetFps,
                needsAudioTranscode
            );

            const oldUrl = clip.url;
            const newUrl = URL.createObjectURL(transcodedFile);

            clip.file = transcodedFile;
            clip.url = newUrl;
            clip.name = transcodedFile.name;

            if (oldUrl && oldUrl.startsWith('blob:')) {
                URL.revokeObjectURL(oldUrl);
            }

            const clipMediaInfo = projectBin.clipMediaInfo;
            if (clipMediaInfo && typeof clipMediaInfo.getClipProperties === 'function') {
                clip.properties = await clipMediaInfo.getClipProperties(clip.file);
            }

            if (typeof projectBin.getThumbnail === 'function') {
                try {
                    clip.thumbnail = await projectBin.getThumbnail(clip.name, 5);
                } catch (thumbnailError) {
                    console.warn(`Failed to refresh thumbnail for ${clip.name}:`, thumbnailError);
                }
            }

            if (typeof window.setProgress === 'function') {
                window.setProgress('Transcode complete', 100);
            }
            if (typeof window.stopProgress === 'function') {
                window.stopProgress();
            }

            clip.status = 'done';

            if (typeof window.panels?.reRender === 'function') {
                window.panels.reRender('Project Bin');
                window.panels.reRender('Clip Preview');
                window.panels.reRender('Clip Properties');
            }

            window.setMessage(
                `Successfully transcoded ${clip.name} to project settings.`,
                'check',
                '#00c26e',
                6000
            );

            return clip;
        } catch (error) {
            console.error(`Transcode to project settings failed for ${clipName}:`, error);
            this.reportProgressError(`Transcode failed: ${clipName}`);
            throw error;
        }
    }

    async transcodeFileToSettings(inputFile, originalName = 'input.mp4', width, height, frameRate, transcodeAudio) {
        const inputFileName = originalName || 'input.mp4';
        const outputFileName = `reencoded_${inputFileName}`;
        const inputBytes = new Uint8Array(await inputFile.arrayBuffer());

        await this.ffmpeg.writeFile(inputFileName, inputBytes);

        const args = [
            '-i', inputFileName,
            '-vf', `scale=${width}:${height}`,
            '-r', String(frameRate),
            '-c:v', 'libx264',
            '-crf', '18',
            '-preset', 'medium',
        ];

        if (transcodeAudio) {
            args.push('-c:a', 'aac', '-b:a', '192k');
        } else {
            args.push('-c:a', 'copy');
        }

        args.push('-movflags', '+faststart', outputFileName);

        await this.ffmpeg.exec(args);

        const outputBytes = await this.ffmpeg.readFile(outputFileName);

        await this.ffmpeg.deleteFile(inputFileName).catch(() => {});
        await this.ffmpeg.deleteFile(outputFileName).catch(() => {});

        return new File([outputBytes], outputFileName, {
            type: 'video/mp4'
        });
    }


    async transcodeToAacFile(inputFile, originalName = 'input.mp4') {
        const inputFileName = originalName || 'input.mp4';
        const outputFileName = `reencoded_${inputFileName}`;
        const inputBytes = new Uint8Array(await inputFile.arrayBuffer());

        await this.ffmpeg.writeFile(inputFileName, inputBytes);
        await this.ffmpeg.exec([
            '-i', inputFileName,
            '-c:v', 'copy',
            '-c:a', 'aac',
            '-b:a', '192k',
            '-movflags', '+faststart',
            outputFileName
        ]);

        const outputBytes = await this.ffmpeg.readFile(outputFileName);

        await this.ffmpeg.deleteFile(inputFileName).catch(() => {});
        await this.ffmpeg.deleteFile(outputFileName).catch(() => {});

        return new File([outputBytes], outputFileName, {
            type: 'video/mp4'
        });

    }

}