import ClipMediaInfo from '../backend/clip-media-info.js';
import Modal from '../ui/modal.js';

class ProjectBin {
    constructor() {
        this.project = [];
        this.clipMediaInfo = new ClipMediaInfo();
    }

    // Function to automatically build a file picker and import a video into the project
    addVideo() {
        const uploadElement = document.createElement('input');
        uploadElement.type = 'file';
        uploadElement.accept = 'video/*';
        uploadElement.style.display = 'none';
        document.body.appendChild(uploadElement);

        uploadElement.addEventListener('change', () => {
            const file = uploadElement.files && uploadElement.files[0];
            if (file) {
                this.addVideoFile(file);
            }
            uploadElement.remove();
        });
        uploadElement.click();
    }

    // Function to add a video file directly (e.g. from drag-and-drop)
    addVideoFile(file) {
        if (this.project.some(clip => clip.name === file.name)) {
            alert(`A clip named "${file.name}" already exists in the project. Please rename the file and try again.`);
            return;
        }

        const fileURL = URL.createObjectURL(file);

        this.project.push({
            type: 'video',
            name: file.name,
            url: fileURL,
            file
        });

        this.getThumbnail(file.name, 5).then(thumbnailSrc => {
            let clip = this.project.find(c => c.name === file.name);
            if (clip) {
                clip.thumbnail = thumbnailSrc;
            }

            this.clipMediaInfo.getClipProperties(clip.file || clip).then(properties => {
                clip.properties = properties;
                window.panels.reRender('Project Bin');
            }).catch(error => {
                console.error(`Failed to get media info for ${file.name}:`, error);
            });
        }).catch(error => {
            console.error(`Failed to generate thumbnail for ${file.name}:`, error);
            window.panels.reRender('Project Bin');
        });
    }

    // Function to retrieve the list of clips in the project
    getClips() {
        return this.project;
    }

    // Function to remove a clip from the project by name
    removeClip(clipName) {
        // Confirm action
        if (!confirm(`Are you sure you want to remove the clip "${clipName}" from the project? This action cannot be undone.`)) {
            return;
        }

        const clipIndex = this.project.findIndex(c => c.name === clipName);
        if (clipIndex !== -1) {
            const clip = this.project[clipIndex];
            if (clip.url) {
                URL.revokeObjectURL(clip.url);
            }
            this.project.splice(clipIndex, 1);
            window.panels.reRender('Project Bin');
            window.panels.reRender('Clip Preview');
            window.panels.reRender('Clip Properties');
        } else {
            console.warn(`Clip not found for removal: ${clipName}`);
        }
    }

    // Function to call a render of the clip's properties on a clip properties panel
    async renderProperties(clipName) {
        const clip = this.project.find(c => c.name === clipName);
        if (!clip) {
            console.warn(`Clip not found for properties: ${clipName}`);
            return;
        }

        try {
            window.panels.reRender('Clip Properties', clip || {});
        } catch (error) {
            console.error(`Failed to load clip properties for ${clipName}:`, error);
            if (typeof window.setMessage === 'function') {
                window.setMessage(`Failed to load properties for ${clipName}`, 'alert-triangle', '#c00000', 5000);
            }
        }
    }

    renderPreview(clipName) {
        const clip = this.project.find(c => c.name === clipName);

        window.panels.reRender('Clip Preview', clip || {});
    }

    viewProblem(clipName) {
        const clip = this.project.find(c => c.name === clipName);

        if (!clip) {
            console.warn(`Clip not found for problem view: ${clipName}`);
            return;
        }

        // Show modal with problem details
        const modal = new Modal(`Problem with ${clipName}`,
            `<p>This clip's audio codec is not supported by most browsers.<br>
                Though the clip contains audio, Rendr may not be able to play it.<br>
                If you can't hear it in the clip preview or timeline, you won't hear it in the final render.<br>
                You can reencode it with FFmpeg using the following command:<br>
                <i class="mono">ffmpeg -i '${clip.name}' -c:v copy -c:a aac -b:a 192k -movflags +faststart 'reencoded_${clip.name}'</i>
            </p>`);
        modal.open();
    }

    // Function to build a thumbnail for a video clip given name and offset seconds from start
    async getThumbnail(clipName, offsetSeconds = 0) {
        const clip = this.project.find(c => c.name === clipName);
        if (!clip) {
            throw new Error(`Clip not found: ${clipName}`);
        }

        return new Promise((resolve, reject) => {
            const video = document.createElement('video');
            video.preload = 'metadata';
            video.muted = true;
            video.src = clip.url;

            const cleanup = () => {
                video.removeAttribute('src');
                video.load();
            };

            const onError = () => {
                cleanup();
                reject(new Error(`Failed to build thumbnail for clip: ${clipName}`));
            };

            video.addEventListener('error', onError, { once: true });

            video.addEventListener('loadedmetadata', () => {
                const safeOffset = Number.isFinite(offsetSeconds) ? Math.max(0, offsetSeconds) : 0;
                const maxSeekTime = Math.max(0, video.duration - 0.05);
                const targetTime = Math.min(safeOffset, maxSeekTime);

                video.addEventListener('seeked', () => {
                    try {
                        const canvas = document.createElement('canvas');
                        canvas.width = video.videoWidth;
                        canvas.height = video.videoHeight;

                        const context = canvas.getContext('2d');
                        if (!context) {
                            cleanup();
                            reject(new Error('Failed to create canvas context for thumbnail.'));
                            return;
                        }

                        context.drawImage(video, 0, 0, canvas.width, canvas.height);
                        const thumbnailSrc = canvas.toDataURL('image/jpeg', 0.9);
                        cleanup();
                        resolve(thumbnailSrc);
                    } catch (error) {
                        cleanup();
                        reject(error);
                    }
                }, { once: true });

                video.currentTime = targetTime;
            }, { once: true });
        });

    }
}


window.ProjectBin = ProjectBin;
export default ProjectBin;
