import CtxMenu from '../ui/ctx-menu.js';
import openSettings from './settings.js';
import Modal from '../ui/modal.js';

function about() {
    const modal = new Modal('About', `
        <p>Rendr is a free and open-source web-based video editor built to run entirely client-side.</p>
        <p>There is no backend/server so your files never leave your computer.</p>
        <p>Rendering and transcoding is powered through a WebAssembly FFmpeg build so it runs entirely in your browser.</p>
    `);
    modal.open();
}

export default function bindCtxMenusToMenuOptions() {
    document.getElementById('shortcut-import').addEventListener('click', (event) => {
        window.projectBin.addVideo();
    });

    const app = document.getElementById('menu-app')
    app.addEventListener('click', (event) => {
        const menu = new CtxMenu(app, [
                { label: 'Settings', iconClass: 'ti ti-settings', onClick: () => openSettings() },
                { label: 'About Rendr', iconClass: 'ti ti-info-circle', onClick: () => about() },
            ],
        );
    });

    
    const file = document.getElementById('menu-file')
    file.addEventListener('click', (event) => {
        const menu = new CtxMenu(file, [
                { label: 'Import Media', iconClass: 'ti ti-plus', onClick: () => window.projectBin.addVideo() },
                { label: 'Render', iconClass: 'ti ti-video', onClick: () => window.renderer.render() },
            ],
        );
    });

    const edit = document.getElementById('menu-edit')
    edit.addEventListener('click', (event) => {
        const menu = new CtxMenu(edit, [
                { label: 'Undo', iconClass: 'ti ti-arrow-back-up' },
                { label: 'Redo', iconClass: 'ti ti-arrow-forward-up' },
                { label: 'Cut', iconClass: 'ti ti-scissors' },
                { label: 'Copy', iconClass: 'ti ti-copy' },
                { label: 'Paste', iconClass: 'ti ti-clipboard' },
            ],
        );
    });

    const view = document.getElementById('menu-view')
    view.addEventListener('click', (event) => {
        const menu = new CtxMenu(view, [
                { label: 'Zoom In Timeline', iconClass: 'ti ti-zoom-in', onClick: () => window.timelineUI.zoomIn() },
                { label: 'Zoom Out Timeline', iconClass: 'ti ti-zoom-out', onClick: () => window.timelineUI.zoomOut() },
                { label: 'Re-render Timeline', iconClass: 'ti ti-refresh', onClick: () => {
                        window.timelineUI.renderTimeline();
                        window.setMessage('Timeline re-rendered', 'check', '#00ff00');
                    }
                },
            ],
        );
    });

    const help = document.getElementById('menu-help')
    help.addEventListener('click', (event) => {
        const menu = new CtxMenu(help, [
                { label: 'Source Code', iconClass: 'ti ti-code', onClick: () => window.open('https://github.com/tgranz/rendr', '_blank') },
                { label: 'Report an Issue', iconClass: 'ti ti-bug', onClick: () => window.open('https://github.com/tgranz/rendr/issues', '_blank') },
            ],
        );
    });
}