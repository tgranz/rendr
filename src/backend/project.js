export default class Project {
    constructor() {
        this.projectFrameRate = 23.976;
        this.projectWidth = 1920;
        this.projectHeight = 1080;
    }

    setProjectSettings(settings) {
        if (settings.frameRate) {
            this.projectFrameRate = settings.frameRate;
            window.composer.setTargetFps(settings.frameRate);
        }
        if (settings.width) {
            this.projectWidth = settings.width;
        }
        if (settings.height) {
            this.projectHeight = settings.height;
        }

        window.setMessage(`Project updated to ${this.projectWidth}x${this.projectHeight} @ ${this.projectFrameRate}fps`, 'check', '#007700');

        window.panels.reRender('Project Settings');
    }

    getProjectSettings() {
        return {
            frameRate: this.projectFrameRate,
            width: this.projectWidth,
            height: this.projectHeight
        };
    }

    exportProject() {

    }

    importProject() {

    }
}