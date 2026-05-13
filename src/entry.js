// window.setProgress(label?, progress?)
// window.progressError(error?)
import './ui/progress.js';
// window.setMessage(message, icon?, color?, timeout?)
import './ui/message.js';


import Panels from './app/panels.js';
import ProjectBin from './app/project-bin.js';
import TimelineUI from './app/timeline/timeline-ui.js';
import Compose from './backend/compose.js';
import AudioEngine from './backend/audio-engine.js';
import SettingsManager from './backend/settings-manager.js';
import bindCtxMenusToMenuOptions from './app/menu-bar.js';
import bindHotkeyToCallback from './app/hotkeys.js';
import initResizers from './app/resizers.js';


document.addEventListener('DOMContentLoaded', () => {
    // Start the project bin manager
    window.projectBin = new ProjectBin();
    // Start the composer engine
    window.composer = new Compose();
    // Start the audio engine
    window.audioEngine = new AudioEngine();
    // Start the timeline UI
    window.timelineUI = new TimelineUI();
    // Start the panel manager
    window.panels = new Panels();
    // Start the settings manager
    window.settings = new SettingsManager();

    // Bind the file/edit/view menus to the menu buttons
    bindCtxMenusToMenuOptions();

    // Bind hotkeys
    bindHotkeyToCallback('Space', () => {
        window.timelineUI.togglePlayback();
    });
    bindHotkeyToCallback('=', () => {
        window.timelineUI.zoomIn();
    });
    bindHotkeyToCallback('-', () => {
        window.timelineUI.zoomOut();
    });

    // Initialize resizers
    initResizers();
});

/*document.addEventListener('beforeunload', function(event) {
    event.preventDefault();
    event.returnValue = false;
});*/