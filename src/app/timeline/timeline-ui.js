import VideoTrack from './video-track.js';
import AudioTrack from './audio-track.js';
import CtxMenu from '../../ui/ctx-menu.js';

class TimelineUI {
    constructor() {
        this.timelineElement = document.getElementById('timeline');
        this.tracksListElement = document.getElementById('tracks-list');
        this.timelineCursor = document.getElementById('timeline-cursor');
        this.timelinePlayhead = document.getElementById('timeline-playhead');
        this.timelinePlaybar = document.getElementById('timeline-playbar');
        this.pixelsPerSecond = 10;
        this.timelineInteractionMode = 'select';
        this.playBackInterval = null;
        this.audioMeterInterval = null;
        this.audioMeterConfig = {
            samplingRate: 100,
            peakHoldMs: 120,
            peakDecayDbPerSec: 12,
        };
        this.rafLoopActive = false;
        this.playbackStartWallclockMs = 0;
        this.playbackStartSeconds = 0;

        this.handleTimelinePointerMove = event => {
            const rect = this.timelineElement.getBoundingClientRect();
            const x = Math.max(0, Math.min(event.clientX - rect.left, rect.width));
            this.timelineCursor.style.left = `${this.timelineElement.scrollLeft + x}px`;
        };

        this.handleTimelinePointerLeave = () => {
            this.timelineCursor.style.left = '-100px';
        };

        // Setup the track list toolbar
        const tracksListToolbar = document.getElementById('tracks-list-toolbar');
        tracksListToolbar.innerHTML = `
            <button
                title="New Track"
                id="add-track-button"
            ><i class="ti ti-plus"></i></button>
            <div style="width: 100%;"></div>
        `;

        const button = document.getElementById('add-track-button');
        button.addEventListener('click', () => {
            const menu = new CtxMenu(button, [
                { label: 'New Video Track', iconClass: 'ti ti-video', onClick: () => this.addVideoTrack() },
                { label: 'New Audio Track', iconClass: 'ti ti-music', onClick: () => this.addAudioTrack() },
            ],);
        });

        // Setup the timeline toolbar
        const timelineToolbar = document.getElementById('timeline-toolbar');
        timelineToolbar.innerHTML = `
            <button
                class="selected"
                title="Select Mode"
                id="select-mode-button"
                onClick="window.timelineUI.setTimelineInteractionMode('select')"
            ><i class="ti ti-pointer"></i></button>
            <button
                title="Cut Mode"
                id="cut-mode-button"
                onClick="window.timelineUI.setTimelineInteractionMode('cut')"
            ><i class="ti ti-cut"></i></button>
            <div class="spacer"></div>
            <button
                title="Snapping"
                id="snapping-button"
            ><i class="ti ti-magnet"></i></button>
            <div class="spacer"></div>
            <button
                title="More options"
                id="timeline-more-options"
            ><i class="ti ti-dots"></i></button>
            <button><i class="ti ti-help"></i></button>
            <div class="spacer-fill"></div>
            <div id="audio-meter"></div>
        `;

        const timelineMoreOptionsButton = document.getElementById('timeline-more-options');
        timelineMoreOptionsButton.addEventListener('click', () => {
            const menu = new CtxMenu(timelineMoreOptionsButton, [
                { label: 'Re-render Timeline', iconClass: 'ti ti-refresh', onClick: () => 
                    {
                        this.renderTimeline();
                        window.setMessage('Timeline re-rendered', 'check', '#00ff00');
                    }
                },
            ]);
        });

        // Bind the audio meter
        this.bindAudioMeter();

        // Initialize play indicators to zero and keep both in sync.
        this.setPlayPosition(0);

        // Move playbar to clicked position when ruler clicked, or when dragged
        const timelineRuler = document.getElementById('timeline-ruler');
        timelineRuler.addEventListener('mousemove', event => {
            if (event.buttons === 1) {
                const rect = timelineRuler.getBoundingClientRect();
                const x = Math.max(0, (event.clientX - rect.left) + this.timelineElement.scrollLeft);
                this.setPlayPosition(x / this.pixelsPerSecond);
            }
        });
        timelineRuler.addEventListener('click', event => {
            const rect = timelineRuler.getBoundingClientRect();
            const x = Math.max(0, (event.clientX - rect.left) + this.timelineElement.scrollLeft);
            this.setPlayPosition(x / this.pixelsPerSecond);
        });

        // Init on select mode
        this.setTimelineInteractionMode('select');

        // Start with a video track
        this.tracks = [];
        this.addVideoTrack();
        this.addAudioTrack();

        if (window.audioEngine) {
            window.audioEngine.addEndedHook(() => {
                if (this.playBackInterval) {
                    this.stopPlayback();
                }
            });
        }

        // Click handler
        this.timelineElement.addEventListener('click', event => {
            void this._handleTimelineClick(event);
        });

    }

    async _handleTimelineClick(event) {
        if (this.timelineInteractionMode === 'cut') {
            // Ignore clicks on buttons
            if (event.target instanceof Element && event.target.closest('button')) {
                return;
            }

            const rect = this.timelineElement.getBoundingClientRect();
            const clickX = event.clientX - rect.left + this.timelineElement.scrollLeft;
            const clickTime = clickX / this.pixelsPerSecond;

            const trackRow = event.target instanceof Element
                ? event.target.closest('.track-row')
                : null;
            const trackIndex = Number.parseInt(trackRow?.dataset.trackIndex || '', 10);
            const targetTrack = Number.isInteger(trackIndex) ? this.tracks[trackIndex] : null;

            // Clicked on no track, so nothing to split
            if (!targetTrack) {
                window.setMessage('Nothing to split', 'alert-triangle', 'yellow');
                return;
            }

            // If user presses shift while clicking, split one track
            // Otherwise split all tracks.
            const clipsToSplit = event.shiftKey
                ? (() => {
                    const clip = this.getIntersectingClipAtTime(clickTime, targetTrack);
                    return clip ? [{ track: targetTrack, clip }] : [];
                })()
                : this.getAllIntersectingClipsAtTimeline(clickTime);

            if (clipsToSplit.length === 0) {
                window.setMessage(`No clip at ${clickTime.toFixed(2)}s to split`, 'warning', 'yellow');
                return;
            }

            let splitCount = 0;
            for (const { track, clip } of clipsToSplit) {
                try {
                    const splitClips = await track.split(clickTime);
                    if (splitClips) {
                        splitCount += 1;
                    }
                } catch (error) {
                    console.error('Error splitting clip:', error);
                    window.setMessage(`Error splitting clip at ${clickTime.toFixed(2)}s`, 'error', 'red');
                }
            }

            if (splitCount > 0) {
                this.renderTimeline();
                if (splitCount === 1) {
                    window.setMessage(`Clip split at ${clickTime.toFixed(2)}s`, 'success', 'green');
                } else {
                    window.setMessage(`${splitCount} clips split at ${clickTime.toFixed(2)}s`, 'success', 'green');
                }
            } else {
                window.setMessage(`Failed to split clip at ${clickTime.toFixed(2)}s`, 'error', 'red');
            }
        }
    }

    bindAudioMeter(
        samplingRate = this.audioMeterConfig.samplingRate,
        peakHoldMs = this.audioMeterConfig.peakHoldMs,
        peakDecayDbPerSec = this.audioMeterConfig.peakDecayDbPerSec
    ) {
        const meter = document.getElementById('audio-meter');
        if (!meter) {
            return;
        }

        this.audioMeterConfig = {
            samplingRate,
            peakHoldMs,
            peakDecayDbPerSec,
        };

        if (this.audioMeterInterval) {
            clearInterval(this.audioMeterInterval);
            this.audioMeterInterval = null;
        }

        meter.innerHTML = `
            <div class="meter-bar">
                <div class="meter-level" id="meter-level-left"></div>
                <div class="meter-peak" id="meter-peak-left"></div>
            </div>
            <div class="meter-bar">
                <div class="meter-level" id="meter-level-right"></div>
                <div class="meter-peak" id="meter-peak-right"></div>
            </div>
        `;

        if (!window.audioEngine) {
            return;
        }

        const leftMeter = document.getElementById('meter-level-left');
        const rightMeter = document.getElementById('meter-level-right');
        const leftPeak = document.getElementById('meter-peak-left');
        const rightPeak = document.getElementById('meter-peak-right');

        const peakState = {
            leftDb: -100,
            rightDb: -100,
            leftHoldUntilMs: 0,
            rightHoldUntilMs: 0,
        };

        const getMeterColor = (db) => {
            if (db > -3) return 'var(--bad-color)';
            if (db > -20) return 'var(--yellow-color)';
            return 'var(--good-color)';
        };

        const clampDb = (db) => Math.max(-100, Math.min(0, Number.isFinite(db) ? db : -100));

        const updateBarWithPeak = (channelName, liveDb, meterEl, peakEl) => {
            const keyDb = `${channelName}Db`;
            const keyHold = `${channelName}HoldUntilMs`;
            const nowMs = performance.now();
            const boundedLiveDb = clampDb(liveDb);

            meterEl.style.width = `${boundedLiveDb + 100}%`;
            meterEl.style.backgroundColor = getMeterColor(boundedLiveDb);

            const currentPeak = peakState[keyDb];
            if (boundedLiveDb >= currentPeak) {
                peakState[keyDb] = boundedLiveDb;
                peakState[keyHold] = nowMs + peakHoldMs;
            } else if (nowMs >= peakState[keyHold]) {
                const decayPerTick = peakDecayDbPerSec / samplingRate;
                peakState[keyDb] = Math.max(boundedLiveDb, currentPeak - decayPerTick, -100);
            }

            const renderedPeakDb = clampDb(peakState[keyDb]);
            peakEl.style.left = `${renderedPeakDb + 100}%`;
            peakEl.style.backgroundColor = getMeterColor(renderedPeakDb);
        };

        this.audioMeterInterval = setInterval(() => {
            const leftDb = window.audioEngine.getDecibel('left');
            const rightDb = window.audioEngine.getDecibel('right');

            updateBarWithPeak('left', leftDb, leftMeter, leftPeak);
            updateBarWithPeak('right', rightDb, rightMeter, rightPeak);
        }, 1000 / samplingRate);
    }

    setTimelineInteractionMode(mode) {
        if (mode !== 'select' && mode !== 'cut') {
            return;
        }

        this.timelineInteractionMode = mode;

        // Reset button states
        document.getElementById('select-mode-button').classList.toggle('selected', mode === 'select');
        document.getElementById('cut-mode-button').classList.toggle('selected', mode === 'cut');

        // Always remove first to prevent duplicate listeners while switching modes.
        this.timelineElement.removeEventListener('pointermove', this.handleTimelinePointerMove);
        this.timelineElement.removeEventListener('pointerleave', this.handleTimelinePointerLeave);
        
        if (mode === 'select') {
            this.timelineCursor.style.left = `-100px`; // Move it out of view when not hovering
        } else if (mode === 'cut') {
            this.timelineElement.addEventListener('pointermove', this.handleTimelinePointerMove);
            this.timelineElement.addEventListener('pointerleave', this.handleTimelinePointerLeave);
        }
    }

    getSortedTrackClips(track) {
        return [...(track?.sequence || [])]
            .sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0));
    }

    getClipNeighbors(track, clipData) {
        const sortedTrackClips = this.getSortedTrackClips(track);
        const clipIndex = sortedTrackClips.findIndex(c => c === clipData);
        const prevClip = clipIndex > 0 ? sortedTrackClips[clipIndex - 1] : null;
        const nextClip = clipIndex >= 0 && clipIndex < sortedTrackClips.length - 1
            ? sortedTrackClips[clipIndex + 1]
            : null;

        return { sortedTrackClips, clipIndex, prevClip, nextClip };
    }

    syncLinkedClipPositions(clipData) {
        for (const linkedClip of (clipData.linked || [])) {
            linkedClip.position = clipData.position;
            const linkedEl = this.timelineElement.querySelector(`[data-clip-id="${linkedClip.id}"]`);
            if (linkedEl) {
                linkedEl.style.left = `${linkedClip.position * this.pixelsPerSecond}px`;
            }
        }
    }

    makeClipDraggable(clipElement, clipData, track) {
        clipElement.addEventListener('pointerdown', event => {
            if (event.target instanceof Element && event.target.closest('button')) {
                return;
            }

            if (event.target instanceof Element && event.target.closest('.clip-handle')) {
                return;
            }

            const dragStartX = event.clientX;
            const clipStartAtDragBegin = Number(clipData.position) || 0;
            const clipDuration = Number(clipData.duration) || 0;
            const DRAG_THRESHOLD_PX = 4;
            let didDrag = false;

            const { prevClip, nextClip } = this.getClipNeighbors(track, clipData);

            const minPosition = Math.max(0, prevClip ? ((Number(prevClip.position) || 0) + (Number(prevClip.duration) || 0)) : 0);
            const maxPosition = nextClip
                ? Math.max(minPosition, (Number(nextClip.position) || 0) - clipDuration)
                : Number.POSITIVE_INFINITY;

            const handlePointerMove = moveEvent => {
                const deltaX = moveEvent.clientX - dragStartX;
                if (!didDrag && Math.abs(deltaX) < DRAG_THRESHOLD_PX) {
                    return;
                }

                if (!didDrag) {
                    didDrag = true;
                    clipElement.classList.add('is-dragging');
                }

                moveEvent.preventDefault();
                const unclampedStart = clipStartAtDragBegin + (deltaX / this.pixelsPerSecond);
                const nextStart = Math.min(maxPosition, Math.max(minPosition, unclampedStart));

                clipData.position = Number(nextStart.toFixed(2));
                clipElement.style.left = `${clipData.position * this.pixelsPerSecond}px`;

                this.syncLinkedClipPositions(clipData);
            };

            const stopDragging = () => {
                if (didDrag) {
                    clipElement.classList.remove('is-dragging');
                    this.renderTimeline();
                }
                window.removeEventListener('pointermove', handlePointerMove);
                window.removeEventListener('pointerup', stopDragging);
                window.removeEventListener('pointercancel', stopDragging);
            };

            window.addEventListener('pointermove', handlePointerMove);
            window.addEventListener('pointerup', stopDragging);
            window.addEventListener('pointercancel', stopDragging);
        });
    }

    makeClipResizable(clipElement, clip, handleElement, clipData, track, edge) {
        handleElement.addEventListener('pointerdown', event => {
            event.preventDefault();
            event.stopPropagation();

            const dragStartX = event.clientX;
            const clipPositionAtDragBegin = Number(clipData.position) || 0;
            const clipStartAtDragBegin = Number(clipData.start) || 0;
            const clipDurationAtDragBegin = Number(clipData.duration) || 0;
            const DRAG_THRESHOLD_PX = 4;
            const MIN_CLIP_DURATION = 0.1;
            let didDrag = false;

            const { prevClip, nextClip } = this.getClipNeighbors(track, clipData);
            const prevClipEnd = prevClip
                ? ((Number(prevClip.position) || 0) + (Number(prevClip.duration) || 0))
                : 0;
            const nextClipStart = nextClip
                ? (Number(nextClip.position) || 0)
                : Number.POSITIVE_INFINITY;

            const handlePointerMove = moveEvent => {
                const deltaX = moveEvent.clientX - dragStartX;
                if (!didDrag && Math.abs(deltaX) < DRAG_THRESHOLD_PX) {
                    return;
                }

                if (!didDrag) {
                    didDrag = true;
                    clipElement.classList.add('is-dragging');
                }

                moveEvent.preventDefault();
                const deltaSeconds = deltaX / this.pixelsPerSecond;

                if (edge === 'start') {
                    const minDelta = prevClipEnd - clipPositionAtDragBegin;
                    const maxDelta = clipDurationAtDragBegin - MIN_CLIP_DURATION;
                    const clampedDelta = Math.min(maxDelta, Math.max(minDelta, deltaSeconds));

                    clipData.position = Number((clipPositionAtDragBegin + clampedDelta).toFixed(2));
                    clipData.start = Number((clipStartAtDragBegin + clampedDelta).toFixed(2));
                    clipData.duration = Number((clipDurationAtDragBegin - clampedDelta).toFixed(2));
                    clipElement.style.left = `${clipData.position * this.pixelsPerSecond}px`;
                    clipElement.style.width = `${clipData.duration * this.pixelsPerSecond}px`;
                    return;
                }

                const minDuration = MIN_CLIP_DURATION;
                const maxDuration = Math.max(0, nextClipStart - clipPositionAtDragBegin);
                const nextDuration = Math.min(maxDuration, Math.max(minDuration, clipDurationAtDragBegin + deltaSeconds));

                clipData.duration = Number(nextDuration.toFixed(2));
                clipElement.style.width = `${clipData.duration * this.pixelsPerSecond}px`;

                // Clips no longer can be linked
                clip.getLinks()?.forEach(linkedClip => {
                    clip.unlinkClip(clip, linkedClip);
                    linkedClip.getLinks()?.forEach(otherLinked => {
                        if (otherLinked !== clip) {
                            linkedClip.unlinkClip(linkedClip, otherLinked);
                        }
                    });
                });
            };

            const stopDragging = async () => {
                if (didDrag) {
                    if (edge === 'start' && track?.getType() === 'video') {
                        try {
                            clipData.thumbnail = await window.projectBin.getThumbnail(clipData.name, clipData.start);
                        } catch (error) {
                            console.warn('Failed to load thumbnail for resized clip:', clipData.name, error);
                        }
                    }

                    clipElement.classList.remove('is-dragging');
                    this.renderTimeline();
                }
                window.removeEventListener('pointermove', handlePointerMove);
                window.removeEventListener('pointerup', stopDragging);
                window.removeEventListener('pointercancel', stopDragging);
            };

            window.addEventListener('pointermove', handlePointerMove);
            window.addEventListener('pointerup', stopDragging);
            window.addEventListener('pointercancel', stopDragging);
        });
    }

    async renderAudioClipWaveform(waveformElement, clip) {
        if (!waveformElement || !clip || !window.audioEngine) {
            return;
        }

        const width = Math.max(24, Math.floor((Number(clip.duration) || 0) * this.pixelsPerSecond));
        const requestToken = `${clip.id || clip.clip?.name || 'clip'}-${width}-${Date.now()}`;
        waveformElement.dataset.waveformRequestToken = requestToken;

        try {
            const waveformDataUrl = await window.audioEngine.getWaveformPreview(clip, width, 52);
            if (!waveformDataUrl) {
                return;
            }

            if (!waveformElement.isConnected || waveformElement.dataset.waveformRequestToken !== requestToken) {
                return;
            }

            waveformElement.style.backgroundImage = `url("${waveformDataUrl}")`;
        } catch (error) {
            console.warn('Failed to render clip waveform:', clip?.clip?.name || clip?.id, error);
        }
    }

    addVideoTrack() {
        const newTrack = new VideoTrack("Video " + (this.tracks.filter(t => t.getType() === 'video').length + 1));
        this.tracks.push(newTrack);
        this.renderTracks();
        this.renderTimeline();
    }

    addAudioTrack() {
        const newTrack = new AudioTrack("Audio " + (this.tracks.filter(t => t.getType() === 'audio').length + 1));
        this.tracks.push(newTrack);
        this.renderTracks();
        this.renderTimeline();
    }

    removeTrack(trackIndex) {
        this.tracks.splice(trackIndex, 1);
        this.renderTracks();
        this.renderTimeline();
    }

    refresh() {
        this.renderTracks();
        this.renderTimeline();
    }

    renderTracks() {
        // Remove existing tracks
        this.tracksListElement.querySelectorAll('.track-item').forEach(trackEl => trackEl.remove());

        // Sort tracks, video first then audio
        const sortedTracks = [...this.tracks].sort((a, b) => {
            if (a.getType() === b.getType()) {
                return 0;
            }
            return a.getType() === 'video' ? -1 : 1;
        });

        // Render each track in the track list
        sortedTracks.forEach((track, index) => {
            const trackElement = document.createElement('div');
            trackElement.className = `track-item ${track.getType()}-track`;
            
            const trackLabel = document.createElement('span');
            trackLabel.className = 'track-label';
            trackLabel.textContent = track.name;
            trackLabel.addEventListener('click', () => {
                this.renameTrack(index);
            });
            trackElement.appendChild(trackLabel);

            const trackActions = document.createElement('div');
            trackActions.className = 'track-actions';

                const deleteButton = document.createElement('button');
                deleteButton.innerHTML = '<i class="ti ti-trash"></i>';
                deleteButton.addEventListener('click', () => {
                    this.removeTrack(index);
                });
                trackActions.appendChild(deleteButton);

            trackElement.appendChild(trackActions);

            this.tracksListElement.appendChild(trackElement);
        });
    }

    renameTrack(index) {
        const track = this.tracks[index];
        const newName = prompt('Enter new track name:', track.name);
        if (newName !== null && newName.trim() !== '') {
            track.name = newName.trim();
            this.renderTracks();
        }
    }

    renderTimeline() {
        // Clear existing timeline content
        this.timelineElement.querySelectorAll('.track-row').forEach(row => row.remove());

        const timelineWidthPx = Math.max(
            this.timelineElement.clientWidth,
            Math.ceil(this.getTimelineEndPosition() * this.pixelsPerSecond)
        );

        // Sort tracks, video first then audio
        const sortedTracks = [...this.tracks].sort((a, b) => {
            if (a.getType() === b.getType()) {
                return 0;
            }
            return a.getType() === 'video' ? -1 : 1;
        });

        // Render each track's sequence
        sortedTracks.forEach(track => {
            const trackRow = document.createElement('div');
            trackRow.className = `track-row`;
            trackRow.dataset.trackIndex = String(this.tracks.indexOf(track));
            this.timelineElement.appendChild(trackRow);

            // Track row height must equal the height of the track item in the track list for proper alignment
            trackRow.style.height = `${this.tracksListElement.querySelector('.track-item').offsetHeight}px`;
            trackRow.style.width = `${timelineWidthPx}px`;

            // Now render the track's clips
            const sortedSequence = [...track.sequence].sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0));

            sortedSequence.forEach(clip => {
                const clipElement = document.createElement('div');
                clipElement.className = 'clip-item';
                clipElement.dataset.clipId = clip.id;

                if (track.getType() === 'audio') {
                    clipElement.classList.add('audio-clip-item');
                }

                clipElement.style.left = `${clip.position * this.pixelsPerSecond}px`;
                clipElement.style.width = `${clip.duration * this.pixelsPerSecond}px`;
                clipElement.style.backgroundColor = `var(--${track.getType()}-track-color)`;

                const startHandle = document.createElement('div');
                startHandle.className = 'clip-handle start-handle';
                clipElement.appendChild(startHandle);

                if (track.getType() === 'video') {
                    // Need to generate new thumbnail
                    const clipThumbnail = document.createElement('img');
                    clipThumbnail.className = 'clip-thumbnail';
                    clipThumbnail.src = clip.thumbnail || '';
                    clipElement.appendChild(clipThumbnail);
                } else if (track.getType() === 'audio') {
                    const waveformElement = document.createElement('div');
                    waveformElement.className = 'clip-waveform';
                    clipElement.appendChild(waveformElement);
                    void this.renderAudioClipWaveform(waveformElement, clip);
                }

                const clipDetails = document.createElement('div');
                clipDetails.className = 'clip-details';
                    const clipNameWrapper = document.createElement('div');
                    clipNameWrapper.className = 'clip-name-wrapper';
                        const clipName = document.createElement('span');
                        clipName.className = 'clip-name';
                        clipName.textContent = clip.clip.name;
                        clipNameWrapper.appendChild(clipName);

                        if (clip.linked && clip.linked.length > 0) {
                            const linkIcon = document.createElement('i');
                            linkIcon.className = 'ti ti-link';
                            linkIcon.style.color = 'var(--yellow-color)';
                            linkIcon.title = 'This clip is linked to another clip.';
                            clipNameWrapper.appendChild(linkIcon);
                        }

                    clipDetails.appendChild(clipNameWrapper);
                    const clipActions = document.createElement('div');
                    clipActions.className = 'clip-actions';
                        const deleteButton = document.createElement('button');
                        deleteButton.innerHTML = '<i class="ti ti-trash"></i>';
                        deleteButton.addEventListener('click', () => {
                            this.removeClipFromTrack(track, clip.id);
                        });
                        clipActions.appendChild(deleteButton);
                    clipDetails.appendChild(clipActions);
                clipElement.appendChild(clipDetails);

                const endHandle = document.createElement('div');
                endHandle.className = 'clip-handle end-handle';
                clipElement.appendChild(endHandle);

                this.makeClipResizable(clipElement, clip, startHandle, clip, track, 'start');
                this.makeClipResizable(clipElement, clip, endHandle, clip, track, 'end');
                this.makeClipDraggable(clipElement, clip, track);

                trackRow.appendChild(clipElement);
            });
        });
    }

    getVideoTracks() {
        return this.tracks.filter(track => track.getType() === 'video');
    }

    getAudioTracks() {
        return this.tracks.filter(track => track.getType() === 'audio');
    }

    async addClipToTimeline(clipName, trackIndex = 0) {
        const clip = window.projectBin.getClips().find(c => c.name === clipName);
        if (!clip) {
            alert(`Clip "${clipName}" not found in project bin.`);
            return;
        }
        const videoTracks = this.getVideoTracks();
        if (videoTracks.length === 0) {
            window.setMessage('No video track to add to.');
            return;
        }
        const track = videoTracks[trackIndex];
        await track.addClipToTrack(clip);
        this.renderTimeline();
        
    }

    async removeClipFromTrack(track, clipId) {
        if (!track || typeof track.removeClipFromTrack !== 'function') {
            window.setMessage('Track does not support clip removal.', 'alert-triangle', '#ff8800', 4000);
            return;
        }

        const didRemove = await track.removeClipFromTrack(clipId);
        if (didRemove) {
            this.renderTimeline();
            window.setMessage('Clip removed from track.', 'check', '#00cc66', 2500);
        } else {
            window.setMessage('Clip could not be removed.', 'alert-triangle', '#ff8800', 4000);
        }
    }

    async addCombinedClipToTimeline(clipName, trackIndex = 0) {
        const clip = window.projectBin.getClips().find(c => c.name === clipName);
        if (!clip) {
            alert(`Clip "${clipName}" not found in project bin.`);
            return;
        }

        const videoTracks = this.getVideoTracks();
        if (videoTracks.length === 0) {
            window.setMessage('No video track to add to.');
            return;
        }

        const audioTracks = this.getAudioTracks();
        if (audioTracks.length === 0) {
            window.setMessage('No audio track to add to.');
            return;
        }

        const videoTrack = videoTracks[trackIndex];
        const audioTrack = audioTracks[trackIndex];
        const videoTimelineClip = await videoTrack.addClipToTrack(clip);
        const audioTimelineClip = await audioTrack.addClipToTrack(clip);

        this.linkClips(videoTimelineClip, audioTimelineClip);

        // Keep both tracks aligned if either clip definition changes in the future.
        if (videoTimelineClip && audioTimelineClip) {
            audioTimelineClip.start = videoTimelineClip.start;
            audioTimelineClip.position = videoTimelineClip.position;
            audioTimelineClip.duration = videoTimelineClip.duration;
        }

        this.renderTimeline();

        if (window.audioEngine) {
            window.audioEngine.warmClipCache(clip);
        }
    }

    linkClips(clipA, clipB) {
        const videoTrack = this.getVideoTracks()[0];
        const audioTrack = this.getAudioTracks()[0];
        videoTrack.linkClip(clipA, clipB);
        audioTrack.linkClip(clipB, clipA);
    }

    getTimelineEndPosition() {
        let maxEnd = 0;

        this.tracks.forEach(track => {
            (track.sequence || []).forEach(clip => {
                const start = Number(clip.position) || 0;
                const duration = Number(clip.duration) || 0;
                maxEnd = Math.max(maxEnd, start + duration);
            });
        });

        return maxEnd;
    }

    getPlayPosition() {
        // Look at playbar position, convert px to seconds, and thats it
        const playbarX = parseFloat(getComputedStyle(this.timelinePlaybar).left);
        return playbarX / this.pixelsPerSecond;
    }

    setPlayPosition(seconds) {
        const x = Math.max(0, seconds * this.pixelsPerSecond);
        this.timelinePlaybar.style.left = `${x}px`;
        this.timelinePlayhead.style.left = `${x + 1}px`;

        // Play position changed. Re-render the preview.
        window.composer.drawCurrentFrame();
    }

    getIntersectingClipAtTime(time, track = null) {
        if (track) {
            for (const clip of (track.sequence || [])) {
                if (time >= clip.position && time <= (clip.position + clip.duration)) {
                    return clip;
                }
            }

            return null;
        }

        for (const track of this.tracks) {
            for (const clip of track.sequence) {
                if (time >= clip.position && time <= (clip.position + clip.duration)) {
                    return clip;
                }
            }
        }
    }

    getAllIntersectingClipsAtTimeline(time) {
        const intersections = [];

        for (const track of this.tracks) {
            const clip = this.getIntersectingClipAtTime(time, track);
            if (clip) {
                intersections.push({ track, clip });
            }
        }

        return intersections;
    }

    async startPlayback() {
        if (this.rafLoopActive) return;

        const startPosition = this.getPlayPosition();
        const timelineEnd = this.getTimelineEndPosition();
        if (timelineEnd <= startPosition) {
            return;
        }

        const audioTracks = this.getAudioTracks();

        if (window.audioEngine) {
            await window.audioEngine.syncTracks(audioTracks, startPosition);
        }

        this.rafLoopActive = true;
        this.playbackStartWallclockMs = performance.now();
        this.playbackStartSeconds = startPosition;

        if (window.audioEngine) {
            await window.audioEngine.startPlayback(startPosition);
        }

        const rafTick = (timestamp) => {
            if (!this.rafLoopActive) return;

            let nextPosition;
            if (window.audioEngine?.isPlaying()) {
                nextPosition = window.audioEngine.getCurrentPlaybackPosition();
            } else {
                const elapsedSeconds = Math.max(0, (timestamp - this.playbackStartWallclockMs) / 1000);
                nextPosition = this.playbackStartSeconds + elapsedSeconds;
            }

            const endPosition = this.getTimelineEndPosition();
            if (nextPosition >= endPosition) {
                this.setPlayPosition(endPosition);
                this.stopPlayback();
                return;
            }

            this.setPlayPosition(nextPosition);
            this.playBackInterval = requestAnimationFrame(rafTick);
        };

        this.playBackInterval = requestAnimationFrame(rafTick);

        const playPauseButtons = document.querySelectorAll('.play-button');
        playPauseButtons.forEach(button => {
            button.innerHTML = `<i class="ti ti-player-pause"></i>`;
        });
    }

    stopPlayback() {
        this.rafLoopActive = false;
        if (this.playBackInterval) {
            cancelAnimationFrame(this.playBackInterval);
            this.playBackInterval = null;
        }

        if (window.audioEngine) {
            window.audioEngine.stopPlayback();
        }

        const playPauseButtons = document.querySelectorAll('.play-button');
        playPauseButtons.forEach(button => {
            button.innerHTML = `<i class="ti ti-player-play"></i>`;
        });
    }

    togglePlayback() {
        if (this.playBackInterval) {
            this.stopPlayback();
        } else {
            void this.startPlayback();
        }
    }
}

export default TimelineUI;