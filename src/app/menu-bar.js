import CtxMenu from '../ui/ctx-menu.js';
import openSettings from './settings.js';

export default function bindCtxMenusToMenuOptions() {
    document.getElementById('shortcut-import').addEventListener('click', (event) => {
        window.projectBin.addVideo();
    });

    const app = document.getElementById('menu-app')
    app.addEventListener('click', (event) => {
        const menu = new CtxMenu(app, [
                { label: 'Settings', iconClass: 'ti ti-settings', onClick: () => openSettings() },
            ],
        );
    });

    
    const file = document.getElementById('menu-file')
    file.addEventListener('click', (event) => {
        const menu = new CtxMenu(file, [
                { label: 'Import Media', iconClass: 'ti ti-plus', onClick: () => window.projectBin.addVideo() },
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
                { label: 'Zoom In', iconClass: 'ti ti-zoom-in', onClick: () => window.timelineUI.zoomIn() },
                { label: 'Zoom Out', iconClass: 'ti ti-zoom-out', onClick: () => window.timelineUI.zoomOut() },
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