import CtxMenu from '../ui/ctx-menu.js';
import { effects } from '../backend/effects.js';

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
        this.renderPanel(this.panel2, this.panel2Selector, "Project Settings");
        this.renderPanel(this.panel3, this.panel3Selector, "Preview");
    }

    selectPanel(panel, panelSelector) {
        const callBackFunct = (panel, selector, panelName) => this.renderPanel(panel, selector, panelName);

        new CtxMenu(panelSelector, [
            { label: 'Project Bin', iconClass: 'ti ti-layout-grid', onClick: () => callBackFunct(panel, panelSelector, "Project Bin") },
            { label: 'Clip Preview', iconClass: 'ti ti-video', onClick: () => callBackFunct(panel, panelSelector, "Clip Preview") },
            { label: 'Clip Properties', iconClass: 'ti ti-zoom-scan', onClick: () => callBackFunct(panel, panelSelector, "Clip Properties") },
            { label: 'Project Settings', iconClass: 'ti ti-settings-2', onClick: () => callBackFunct(panel, panelSelector, "Project Settings") },
            { label: 'Effects', iconClass: 'ti ti-star', onClick: () => callBackFunct(panel, panelSelector, "Effects") },
            { label: 'Effects Stack', iconClass: 'ti ti-wand', onClick: () => callBackFunct(panel, panelSelector, "Effects Stack") },
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

    getActiveTimelineClip() {
        const selectedClip = window.timelineUI?.getSelectedTimelineClip?.();
        if (selectedClip) {
            return selectedClip;
        }

        if (!window.timelineUI || typeof window.timelineUI.getPlayPosition !== 'function') {
            return null;
        }

        const playPosition = window.timelineUI.getPlayPosition();
        return window.timelineUI.getIntersectingClipAtTime(playPosition) || null;
    }

    renderEffectsStack(panel, panelSelector, clip) {
        const panelContentElement = panel.querySelector('.panel-content');
        const currentClip = clip || this.getActiveTimelineClip();

        if (!currentClip) {
            panelContentElement.innerHTML = `
                <div class="panel-empty">
                    <i class="ti ti-wand panel-icon"></i>
                    <p>No clip is under the playhead. Move the playhead onto a clip to edit its effects.</p>
                </div>
            `;
            return;
        }

        currentClip.effects = Array.isArray(currentClip.effects) ? currentClip.effects : [];

        if (currentClip.effects.length === 0) {
            panelContentElement.innerHTML = `
                <div class="panel-empty">
                    <i class="ti ti-wand panel-icon"></i>
                    <p>This clip has no effects yet. Open the Effects panel and add one.</p>
                </div>
            `;
            return;
        }

        panelContentElement.innerHTML = '';

        const stack = document.createElement('div');
        stack.className = 'effects-stack';

        const clipHeader = document.createElement('div');
        clipHeader.className = 'effects-stack-header';
        clipHeader.innerHTML = `
            <div>
                <p class="effects-stack-label">Editing</p>
                <p class="effects-stack-name">${currentClip.clip?.name || currentClip.name || 'Untitled clip'}</p>
            </div>
        `;
        stack.appendChild(clipHeader);

        currentClip.effects.forEach((effectInstance, effectIndex) => {
            const definition = effects[effectInstance.name];
            const item = document.createElement('div');
            item.className = 'effect-stack-item';

            const meta = document.createElement('div');
            meta.className = 'effect-stack-meta';
            meta.innerHTML = `
                <div class="effect-stack-title-row">
                    <div class="effect-stack-title">
                        <i class="effect-icon ti ti-${definition?.icon || 'wand'}"></i>
                        <p class="effect-name">${effectInstance.name}</p>
                    </div>
                    <div class="effect-stack-controls">
                        <button title="Move up" ${effectIndex === 0 ? 'disabled' : ''} data-effect-action="move-up"><i class="ti ti-arrow-up"></i></button>
                        <button title="Move down" ${effectIndex === currentClip.effects.length - 1 ? 'disabled' : ''} data-effect-action="move-down"><i class="ti ti-arrow-down"></i></button>
                        <button title="Remove effect" data-effect-action="remove"><i class="ti ti-trash"></i></button>
                    </div>
                </div>
            `;
            item.appendChild(meta);

            const parameterList = document.createElement('div');
            parameterList.className = 'effect-stack-parameters';
            const parameterDefinitions = definition?.parameters || {};

            Object.entries(parameterDefinitions).forEach(([parameterName, parameterConfig]) => {
                const parameterRow = document.createElement('label');
                parameterRow.className = 'effect-stack-parameter';

                const currentValue = effectInstance.parameters?.[parameterName] ?? parameterConfig.default ?? '';
                const valueId = `effect-${effectIndex}-${parameterName}`;

                let inputMarkup = '';
                if (parameterConfig.type === 'range') {
                    const step = parameterConfig.step ?? 1;
                    inputMarkup = `
                        <input
                            id="${valueId}"
                            type="range"
                            min="${parameterConfig.min ?? 0}"
                            max="${parameterConfig.max ?? 100}"
                            step="${step}"
                            value="${Number(currentValue) || 0}"
                        />
                        <span class="effect-stack-value" data-effect-value></span>
                    `;
                } else if (parameterConfig.type === 'color') {
                    inputMarkup = `
                        <input
                            id="${valueId}"
                            type="color"
                            value="${String(currentValue)}"
                        />
                    `;
                } else {
                    inputMarkup = `
                        <input
                            id="${valueId}"
                            type="text"
                            value="${String(currentValue)}"
                        />
                    `;
                }

                parameterRow.innerHTML = `
                    <span class="effect-stack-parameter-title">${parameterConfig.title || parameterName}</span>
                    <div class="effect-stack-control">${inputMarkup}</div>
                `;

                const input = parameterRow.querySelector('input');
                const valueDisplay = parameterRow.querySelector('[data-effect-value]');

                const syncValue = () => {
                    if (parameterConfig.type === 'range') {
                        effectInstance.parameters = effectInstance.parameters || {};
                        effectInstance.parameters[parameterName] = Number(input.value);
                        if (valueDisplay) {
                            valueDisplay.textContent = String(input.value);
                        }
                    } else {
                        effectInstance.parameters = effectInstance.parameters || {};
                        effectInstance.parameters[parameterName] = input.value;
                    }

                    window.composer?.drawCurrentFrame();
                };

                input.addEventListener('input', syncValue);
                input.addEventListener('change', syncValue);

                if (valueDisplay) {
                    valueDisplay.textContent = String(input.value);
                }

                parameterList.appendChild(parameterRow);
            });

            if (parameterList.childElementCount === 0) {
                const emptyParams = document.createElement('p');
                emptyParams.className = 'effect-stack-empty-parameters';
                emptyParams.textContent = 'This effect does not expose adjustable parameters.';
                parameterList.appendChild(emptyParams);
            }

            item.appendChild(parameterList);
            stack.appendChild(item);
        });

        stack.addEventListener('click', (event) => {
            const button = event.target instanceof Element ? event.target.closest('button[data-effect-action]') : null;
            if (!button) {
                return;
            }

            const effectItem = button.closest('.effect-stack-item');
            const effectIndex = Array.from(stack.querySelectorAll('.effect-stack-item')).indexOf(effectItem);
            if (effectIndex < 0) {
                return;
            }

            const action = button.dataset.effectAction;

            if (action === 'remove') {
                currentClip.effects.splice(effectIndex, 1);
            } else if (action === 'move-up' && effectIndex > 0) {
                const [effect] = currentClip.effects.splice(effectIndex, 1);
                currentClip.effects.splice(effectIndex - 1, 0, effect);
            } else if (action === 'move-down' && effectIndex < currentClip.effects.length - 1) {
                const [effect] = currentClip.effects.splice(effectIndex, 1);
                currentClip.effects.splice(effectIndex + 1, 0, effect);
            } else {
                return;
            }

            if (currentClip.effects.length === 0) {
                delete currentClip.effects;
            }

            window.timelineUI.renderTimeline();
            window.composer?.drawCurrentFrame();
            this.renderEffectsStack(panel, panelSelector, currentClip);
        });

        panelContentElement.appendChild(stack);
    }

    renderPanel(panel, panelSelector, toRender, object = {}){
        const panelContentElement = panel.querySelector('.panel-content');
        const panelTitleElement = panelSelector.querySelector('.panel-title');

        if (panelTitleElement) {
            panelTitleElement.textContent = toRender;
        }

        this.setPanelActions(panel, []);

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
                    if (clip.properties && clip.properties.problem != 'none') {
                        clipItem.classList.add('problem');
                    }
                    clipItem.innerHTML = `
                        <img src="${clip.thumbnail}" alt="${clip.name} thumbnail" />
                        <div class="clip-details">
                            <p class="clip-name">
                                ${clip.status === 'transcoding' ? '<i class="ti ti-progress" title="Transcoding..."></i>' : 
                                    clip.status === 'notready' ? '<i class="ti ti-clock" title="Not ready"></i>' : ''}
                                ${clip.name}
                            </p>
                            <div class="clip-actions">
                                <button
                                    title="Download Clip"
                                    onClick="window.projectBin.downloadClip('${clip.name}')"
                                >
                                    <i class="ti ti-download"></i>
                                </button>
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

                                ${(clip.properties && !clip.properties.problem.includes('needs transcoding') && clip.status === 'done') ?
                                    `<button
                                    title="Add to timeline"
                                    onClick="window.timelineUI.addCombinedClipToTimeline('${clip.name}')"
                                >
                                    <i class="ti ti-plus"></i>
                                </button>` : ''}
                                

                                ${clip.properties && clip.properties.problem.includes('needs transcoding') ?
                                    `<button
                                        title="Transcode"
                                        onClick="window.transcoder.transcodeClip('${clip.name}')"
                                    >
                                        <i class="ti ti-transform"></i>
                                    </button>` : ''}
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
                    <div class="effects-panel">
                        ${Object.keys(effects).map(effectName => `
                            <div class="effect-item">
                                <div class="effect-meta">
                                    <div class="effect-title">
                                        <i class="effect-icon ti ti-${effects[effectName].icon}"></i>
                                        <p class="effect-name">${effectName}</p>
                                    </div>
                                    <p class="effect-help">${effects[effectName].help}</p>
                                </div>
                                <div class="effect-actions">
                                    <button
                                        title="Apply Effect"
                                        onClick="window.timelineUI.applyEffectToActiveClip('${effectName}')"
                                    ><i class="ti ti-plus"></i></button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                `;
                break;
            case "Effects Stack":
                this.setPanelActions(panel, [
                    {
                        iconClass: 'ti ti-refresh',
                        label: 'Refresh Stack',
                        onClick: () => this.renderEffectsStack(panel, panelSelector)
                    }
                ]);

                this.renderEffectsStack(panel, panelSelector, object);
                break;
            case "Project Settings":
                this.setPanelActions(panel, [
                    {
                        iconClass: 'ti ti-device-floppy',
                        label: 'Save Settings',
                        onClick: () => window.project.setProjectSettings({
                            width: parseInt(document.getElementById('video-width').value) || window.project.getProjectSettings().width,
                            height: parseInt(document.getElementById('video-height').value) || window.project.getProjectSettings().height,
                            frameRate: parseInt(document.getElementById('frame-rate').value) || window.project.getProjectSettings().frameRate,
                        })
                    }
                ]);

                panelContentElement.innerHTML = `
                    <div class="project-settings">
                        <p class="settings-note">Clips added to the project will be transcoded to these settings, and changing these settings after adding clips will require re-transcoding those clips, which may take a long time.</p>
                        <div class="setting-item">
                            <p>Preset</p>
                            <select id="project-preset">
                                <option value="custom" selected>Custom</option>
                                <option value="2160p60">4K 60fps</option>
                                <option value="2160p30">4K 30fps</option>
                                <option value="1080p60">1080p 60fps</option>
                                <option value="1080p30">1080p 30fps</option>
                                <option value="720p30">720p 30fps</option>
                            </select>
                        </div>
                        <div class="setting-item">
                            <p>Video Width</p>
                            <input type="number" id="video-width" value="${window.project.getProjectSettings().width || 1920}" />
                        </div>
                        <div class="setting-item">
                            <p>Video Height</p>
                            <input type="number" id="video-height" value="${window.project.getProjectSettings().height || 1080}" />
                        </div>
                        <div class="setting-item">
                            <p>Frame Rate</p>
                            <input type="number" id="frame-rate" value="${window.project.getProjectSettings().frameRate || 30}" />
                        </div>

                        <div class="setting-item">
                            <p>Render Format</p>
                            <select>
                                <option value="mp4">MP4</option>
                            </select>
                        </div>
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
    }
}

export default Panels;