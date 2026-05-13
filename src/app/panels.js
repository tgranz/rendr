import CtxMenu from '../ui/ctx-menu.js';

class Panels {
    constructor() {
        this.panel1 = document.getElementById('panel-1');
        this.panel2 = document.getElementById('panel-2');
        this.panel3 = document.getElementById('panel-3');

        this.panel1Selector = this.panel1.querySelector('.panel-selection');
        this.panel2Selector = this.panel2.querySelector('.panel-selection');
        this.panel3Selector = this.panel3.querySelector('.panel-selection');

        this.panel1Selector.addEventListener('click', () => this.selectPanel(this.panel1, this.panel1Selector));
        this.panel2Selector.addEventListener('click', () => this.selectPanel(this.panel2, this.panel2Selector));
        this.panel3Selector.addEventListener('click', () => this.selectPanel(this.panel3, this.panel3Selector));

        // Initial render
        this.renderPanel(this.panel1, this.panel1Selector, "Project Bin");
        this.renderPanel(this.panel2, this.panel2Selector, "Clip Preview");
        this.renderPanel(this.panel3, this.panel3Selector, "Preview");
    }

    selectPanel(panel, panelSelector) {
        const callBackFunct = (panel, selector, panelName) => this.renderPanel(panel, selector, panelName);

        new CtxMenu(panelSelector, [
            { label: 'Project Bin', iconClass: 'ti ti-layout-grid', onClick: () => callBackFunct(panel, panelSelector, "Project Bin") },
            { label: 'Clip Preview', iconClass: 'ti ti-video', onClick: () => callBackFunct(panel, panelSelector, "Clip Preview") },
            { label: 'Clip Properties', iconClass: 'ti ti-zoom-scan', onClick: () => callBackFunct(panel, panelSelector, "Clip Properties") },
            { label: 'Effects', iconClass: 'ti ti-star', onClick: () => callBackFunct(panel, panelSelector, "Effects") },
            { label: 'Preview', iconClass: 'ti ti-player-play', onClick: () => callBackFunct(panel, panelSelector, "Preview") }
        ]);
    }

    setPanelActions(panel, actions) {
        const actionContainer = panel.querySelector('.panel-actions');

        actionContainer.innerHTML = '';

        actions.forEach(action => {
            const button = document.createElement('button');
            button.innerHTML = `<i class="${action.iconClass}"></i>`;
            button.addEventListener('click', action.onClick);
            button.title = action.label;
            actionContainer.appendChild(button);
        });
    }

    renderPanel(panel, panelSelector, toRender, object = {}){
        const panelContentElement = panel.querySelector('.panel-content');
        const panelTitleElement = panelSelector.querySelector('.panel-title');

        if (panelTitleElement) {
            panelTitleElement.textContent = toRender;
        }

        switch(toRender) {
            case "Project Bin":
                this.setPanelActions(panel, [
                    {
                        iconClass: 'ti ti-plus',
                        label: 'Import Media',
                        onClick: () => window.projectBin.addVideo()
                    }
                ]);

                const projectClips = window.projectBin.getClips();

                if (projectClips.length === 0) {
                    panelContentElement.innerHTML = `
                        <div class="project-bin-drop-zone panel-empty">
                            <i class="ti ti-file-import panel-icon"></i>
                            <p>Drop media here or click + to import</p>
                        </div>
                    `;

                    const dropZone = panelContentElement.querySelector('.project-bin-drop-zone');

                    dropZone.addEventListener('dragover', (e) => {
                        e.preventDefault();
                        dropZone.classList.add('drag-over');
                    });

                    dropZone.addEventListener('dragleave', () => {
                        dropZone.classList.remove('drag-over');
                    });

                    dropZone.addEventListener('drop', (e) => {
                        e.preventDefault();
                        dropZone.classList.remove('drag-over');
                        const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('video/'));
                        files.forEach(file => window.projectBin.addVideoFile(file));
                    });

                    return;
                }

                const clipsList = document.createElement('ul');
                clipsList.className = 'project-bin-list';
                panelContentElement.innerHTML = '';
                panelContentElement.appendChild(clipsList);

                projectClips.forEach(clip => {
                    const clipItem = document.createElement('li');
                    clipItem.className = `${clip.type}-clip`;
                    clipItem.draggable = true;
                    clipItem.addEventListener('dragstart', (e) => {
                        e.dataTransfer.setData('application/x-rendr-clip', clip.name);
                        e.dataTransfer.effectAllowed = 'copy';
                    });
                    if (clip.properties && clip.properties.is_supported === false) {
                        clipItem.classList.add('problem');
                    }
                    clipItem.innerHTML = `
                        <img src="${clip.thumbnail}" alt="${clip.name} thumbnail" />
                        <div class="clip-details">
                            <p class="clip-name">${clip.name}</p>
                            <div class="clip-actions">
                                ${clip.properties && clip.properties.is_supported === false ?
                                    `<button
                                        title="View Problem"
                                        onClick="window.projectBin.viewProblem('${clip.name}')"
                                    >
                                        <i class="ti ti-alert-triangle" style="color: var(--bad-color);"></i>
                                    </button>` : ''}
                                <button
                                    title="View Properties"
                                    onClick="window.projectBin.renderProperties('${clip.name}')"
                                >
                                    <i class="ti ti-zoom-scan"></i>
                                </button>
                                <button
                                    title="Preview clip"
                                    onClick="window.projectBin.renderPreview('${clip.name}')"
                                >
                                    <i class="ti ti-video"></i>
                                </button>
                                <button
                                    title="Remove from project"
                                    onClick="window.projectBin.removeClip('${clip.name}')"
                                >
                                    <i class="ti ti-trash"></i>
                                </button>
                                <button
                                    title="Add to timeline"
                                    onClick="window.timelineUI.addCombinedClipToTimeline('${clip.name}')"
                                >
                                    <i class="ti ti-plus"></i>
                                </button>
                            </div>
                        </div>
                    `;
                    clipsList.appendChild(clipItem);
                });
                break;
            case "Clip Properties":
                if (object && Object.keys(object).length > 0) {
                    let outHTML = `<div class="clip-properties"> <table class="clip-properties-table"> <tbody>`;
                    const valuesToRender = (object.properties && typeof object.properties === 'object')
                        ? object.properties
                        : object;

                    Object.keys(valuesToRender).forEach(key => {
                        const value = typeof valuesToRender[key] === 'object'
                            ? JSON.stringify(valuesToRender[key])
                            : valuesToRender[key];

                        if (key != 'thumbnail' && key != 'file' && key != 'url') {
                            outHTML += `
                                <tr>
                                    <td class="property-key">${key}</td>
                                    <td class="property-value">${value || '-'}</td>
                                </tr>
                            `;
                        }
                    });
                    
                    panelContentElement.innerHTML = outHTML + `</tbody></table></div>`;
                } else {
                    panelContentElement.innerHTML = `
                        <div class="panel-empty">
                            <i class="ti ti-zoom-scan panel-icon"></i>
                            <p>Click the <i class="ti ti-zoom-scan"></i> button on a clip to view its properties.</p>
                        </div>`;
                }
                break;
            case "Clip Preview":
                if (object && Object.keys(object).length > 0) {
                    panelContentElement.innerHTML = `
                        <div class="clip-preview">
                            <video controls>
                                <source src="${object.url}" type="video/mp4">
                            </video>
                        </div>
                    `;
                } else {
                    panelContentElement.innerHTML = `
                        <div class="project-bin-drop-zone panel-empty">
                            <i class="ti ti-video panel-icon"></i>
                            <p>Click the <i class="ti ti-video"></i> button on a clip in the project bin to preview it here.</p>
                        </div>
                    `;
                }
                break;
            case "Effects":
                panelContentElement.innerHTML = `
                    <div class="project-bin-drop-zone panel-empty">
                        <i class="ti ti-star panel-icon"></i>
                        <p>Effects coming soon.</p>
                    </div>
                `;
                break;
            case "Preview":
                panelContentElement.innerHTML = '';

                const canvasWrapper = document.createElement('div');
                canvasWrapper.className = 'preview-canvas-wrapper';
                panelContentElement.appendChild(canvasWrapper);

                const previewCanvas = document.createElement('canvas');
                previewCanvas.className = 'preview-canvas';
                canvasWrapper.appendChild(previewCanvas);

                const fpsOverlay = document.createElement('p');
                fpsOverlay.className = 'fps';
                canvasWrapper.appendChild(fpsOverlay);

                const playbackControls = document.createElement('div');
                playbackControls.className = 'playback-controls';
                playbackControls.innerHTML = `
                    <div class="playback-buttons">
                        <button 
                            class="play-button"
                            title="Play/Pause"
                            onclick="window.timelineUI.togglePlayback()"
                        ><i class="ti ti-player-play"></i></button>
                        <button 
                            title="Preview Resolution"
                            class="resolution-button"
                        ><i class="ti ti-square-asterisk"></i></button>
                    </div>
                    <p class="timecode mono">00:00:00</p>
                `;
                panelContentElement.appendChild(playbackControls);

                const resolutionButton = playbackControls.querySelectorAll('.resolution-button');
                resolutionButton.forEach(button => {
                    button.addEventListener('click', (event) => {
                        const menu = new CtxMenu(button, [
                                { label: 'Original Quality', iconClass: 'ti ti-star', onClick: () => window.composer.setDrawQuality(9) },
                                { label: 'Lowest Quality', iconClass: 'ti ti-number-1', onClick: () => window.composer.setDrawQuality(1) },
                                { label: 'Low Quality', iconClass: 'ti ti-number-2', onClick: () => window.composer.setDrawQuality(3) },
                                { label: 'Medium Quality', iconClass: 'ti ti-number-3', onClick: () => window.composer.setDrawQuality(5) },
                                { label: 'High Quality', iconClass: 'ti ti-number-4', onClick: () => window.composer.setDrawQuality(7) },
                            ],
                        );
                    });
                });

                const fpsElement = fpsOverlay;
                const fpsHookItem = {
                    element: fpsElement,
                    isAlive() {
                        return Boolean(this.element && this.element.isConnected);
                    },
                    updateFps(fps) {
                        this.element.textContent = `FPS: ${Math.round(fps)}`;
                    }
                };
                window.composer.addFpsHook(fpsHookItem);

                const timecodeElement = playbackControls.querySelector('.timecode');
                const timecodeHookItem = {
                    element: timecodeElement,
                    isAlive() {
                        return Boolean(this.element && this.element.isConnected);
                    },
                    updateTimecode(timecode) {
                        this.element.textContent = timecode;
                    }
                };
                window.timelineUI.addTimecodeHook(timecodeHookItem);

                window.composer.attachPreview(previewCanvas);
                break;
            default:
                panelContentElement.innerHTML = `<h2>${toRender}</h2><p>Content for ${toRender} goes here.</p>`;
        }
    }

    reRender(targetPanels, object = {}) {
        const panels = [this.panel1, this.panel2, this.panel3];
        const panelSelectors = [this.panel1Selector, this.panel2Selector, this.panel3Selector];
        let didRunARender = false;

        panelSelectors.forEach((selector, index) => {
            const titleElement = selector.querySelector('.panel-title');
            const currentPanelName = titleElement ? titleElement.textContent.trim() : '';

            if (currentPanelName === targetPanels) {
                this.renderPanel(panels[index], selector, targetPanels, object);
                didRunARender = true;
            }
        });

        if (!didRunARender) {
            window.setMessage(
                `No ${targetPanels} panel open.`,
                'exclamation-circle',
                '#ffaa00',
                5000
            );
        }
    }
}

export default Panels;