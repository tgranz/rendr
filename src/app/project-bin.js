import ClipMediaInfo from '../backend/clip-media-info.js';
import Modal from '../ui/modal.js';

class ProjectBin {
    constructor(deps = {}) {
        this.project = [];
        this.clipMediaInfo = new ClipMediaInfo();

        // optional dependency injection (fallback to globals)
        this.panels = deps.panels || window.panels;
        this.projectSettings = deps.projectSettings || window.project;
        this.transcoder = deps.transcoder || window.transcoder;
        this.message = deps.message || window.setMessage;
    }

    createId() {
        return crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    }

    addVideo() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'video/*';
        input.style.display = 'none';
        document.body.appendChild(input);

        input.addEventListener('change', () => {
            const file = input.files?.[0];
            if (file) this.addVideoFile(file);
            input.remove();
        });

        input.click();
    }

    addVideoFile(file) {
        const duplicate = this.project.some(
            c => c.name === file.name && c.size === file.size
        );

        if (duplicate) {
            alert(`"${file.name}" already exists in the project.`);
            return;
        }

        const clip = {
            id: this.createId(),
            type: 'video',
            name: file.name,
            file,
            url: URL.createObjectURL(file),
            status: 'notready',
            thumbnail: null,
            properties: null
        };

        this.project.push(clip);
        this.buildThumbnail(clip.id, 5);
    }

    async buildThumbnail(id, offsetSeconds = 0) {
        const clip = this.project.find(c => c.id === id);
        if (!clip) return;

        try {
            clip.thumbnail = await this.getThumbnail(clip.url, offsetSeconds);

            const props = await this.clipMediaInfo.getClipProperties(clip.file);
            const latest = this.project.find(c => c.id === id);
            if (!latest) return;

            latest.properties = props;

            this.panels.reRender('Project Bin');

            if (this.project.length === 1) {
                this.promptInitialProjectSettings(latest);
            } else {
                this.handleCompatibility(latest);
            }

        } catch (err) {
            console.error(err);
        }
    }

    promptInitialProjectSettings(clip) {
        const modal = new Modal(
            'Action Required',
            `<p>Set project settings to match this clip?</p>`,
            [
                {
                    text: 'Yes',
                    variant: 'primary',
                    action: () => {
                        const settings = this.projectSettings.getProjectSettings();

                        this.projectSettings.setProjectSettings({
                            frameRate: clip.properties?.fps || settings.frameRate,
                            width: clip.properties?.width || settings.width,
                            height: clip.properties?.height || settings.height,
                        });

                        clip.status = 'done';
                        this.panels.reRender('Project Bin');
                        modal.close();
                    }
                },
                {
                    text: 'Transcode to current settings',
                    action: () => {
                        this.transcoder.transcodeClipToProjectSettings(clip.name);
                        clip.status = 'transcoding';
                        modal.close();
                    }
                }
            ],
            { closeOnDarkenerClick: false, showCloseButton: false, closeOnEscape: false }
        );

        modal.open();
    }

    handleCompatibility(clip) {
        const settings = this.projectSettings.getProjectSettings();

        if (settings.frameRate && clip.properties?.fps &&
            settings.frameRate !== clip.properties.fps) {

            this.transcoder.transcodeClipToProjectSettings(clip.name);
            clip.status = 'transcoding';
        } else {
            clip.status = 'done';
        }

        this.panels.reRender('Project Bin');
    }

    getClips() {
        return this.project;
    }

    removeClip(id) {
        const idx = this.project.findIndex(c => c.id === id);
        if (idx === -1) return;

        const clip = this.project[idx];

        if (!confirm(`Remove "${clip.name}"?`)) return;

        URL.revokeObjectURL(clip.url);
        this.project.splice(idx, 1);

        this.panels.reRender('Project Bin');
        this.panels.reRender('Clip Preview');
        this.panels.reRender('Clip Properties');
    }

    downloadClip(id) {
        const clip = this.project.find(c => c.id === id);
        if (!clip) return;

        const a = document.createElement('a');
        a.href = clip.url;
        a.download = clip.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
    }

    renderProperties(id) {
        const clip = this.project.find(c => c.id === id);
        if (!clip) return;

        try {
            this.panels.reRender('Clip Properties', clip);
        } catch (err) {
            console.error(err);
            this.message?.('Failed to load properties', 'alert-triangle', '#c00000', 5000);
        }
    }

    renderPreview(id) {
        const clip = this.project.find(c => c.id === id);
        this.panels.reRender('Clip Preview', clip || {});
    }

    getThumbnail(url, offsetSeconds = 0) {
        return new Promise((resolve, reject) => {
            const video = document.createElement('video');
            video.preload = 'metadata';
            video.muted = true;
            video.src = url;

            const timeout = setTimeout(() => {
                cleanup();
                reject(new Error('Thumbnail timeout'));
            }, 10000);

            const cleanup = () => {
                clearTimeout(timeout);
                video.removeAttribute('src');
                video.load();
                video.onseeked = null;
                video.onerror = null;
            };

            video.onerror = () => {
                cleanup();
                reject(new Error('Thumbnail load error'));
            };

            video.onloadedmetadata = () => {
                const duration = video.duration || 0;
                const target = Math.min(Math.max(offsetSeconds, 0), duration - 0.05);

                video.onseeked = () => {
                    try {
                        const canvas = document.createElement('canvas');
                        canvas.width = video.videoWidth;
                        canvas.height = video.videoHeight;

                        const ctx = canvas.getContext('2d');
                        if (!ctx) throw new Error('No canvas context');

                        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

                        const img = canvas.toDataURL('image/jpeg', 0.9);
                        cleanup();
                        resolve(img);
                    } catch (e) {
                        cleanup();
                        reject(e);
                    }
                };

                video.currentTime = target;
            };
        });
    }
}

window.ProjectBin = ProjectBin;
export default ProjectBin;
