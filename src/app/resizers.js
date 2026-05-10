export default function initResizers() {
    const shellResizer = document.getElementById("resizer-shells");
    const panelResizer1 = document.getElementById("resizer-panel-1");
    const panelResizer2 = document.getElementById("resizer-panel-2");

    const MIN_SHELL_HEIGHT = 120;
    const MIN_PANEL_WIDTH = 180;

    const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

    const panel1 = document.getElementById("panel-1");
    const panel2 = document.getElementById("panel-2");
    const panel3 = document.getElementById("panel-3");
    const allPanels = [panel1, panel2, panel3].filter(Boolean);

    function lockPanelWidths() {
        allPanels.forEach((panel) => {
            const width = panel.getBoundingClientRect().width;
            panel.style.flex = `0 0 ${width}px`;
            panel.style.width = `${width}px`;
        });
    }

    function attachHorizontalResizer(resizer, leftPanel, rightPanel) {
        if (!resizer || !leftPanel || !rightPanel) return;

        resizer.addEventListener("mousedown", (e) => {
            e.preventDefault();

            lockPanelWidths();

            const startX = e.clientX;
            const startLeftWidth = leftPanel.getBoundingClientRect().width;
            const startRightWidth = rightPanel.getBoundingClientRect().width;
            const totalPairWidth = startLeftWidth + startRightWidth;

            function onMouseMove(event) {
                const deltaX = event.clientX - startX;
                const nextLeftWidth = clamp(
                    startLeftWidth + deltaX,
                    MIN_PANEL_WIDTH,
                    totalPairWidth - MIN_PANEL_WIDTH
                );
                const nextRightWidth = totalPairWidth - nextLeftWidth;

                leftPanel.style.flex = `0 0 ${nextLeftWidth}px`;
                leftPanel.style.width = `${nextLeftWidth}px`;
                rightPanel.style.flex = `0 0 ${nextRightWidth}px`;
                rightPanel.style.width = `${nextRightWidth}px`;
            }

            function onMouseUp() {
                document.removeEventListener("mousemove", onMouseMove);
                document.removeEventListener("mouseup", onMouseUp);
            }

            document.addEventListener("mousemove", onMouseMove);
            document.addEventListener("mouseup", onMouseUp);
        });
    }

    if (!shellResizer) return;

    shellResizer.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const startY = e.clientY;
        const topShell = document.getElementById("top-shell");
        const bottomShell = document.getElementById("bottom-shell");
        if (!topShell || !bottomShell) return;

        const startTopHeight = topShell.getBoundingClientRect().height;
        const startBottomHeight = bottomShell.getBoundingClientRect().height;
        const totalShellHeight = startTopHeight + startBottomHeight;

        function onMouseMove(event) {
            const deltaY = event.clientY - startY;
            const nextTopHeight = clamp(
                startTopHeight + deltaY,
                MIN_SHELL_HEIGHT,
                totalShellHeight - MIN_SHELL_HEIGHT
            );
            const nextBottomHeight = totalShellHeight - nextTopHeight;

            topShell.style.height = `${nextTopHeight}px`;
            bottomShell.style.height = `${nextBottomHeight}px`;
        }

        function onMouseUp() {
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
        }

        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
    });

    attachHorizontalResizer(panelResizer1, panel1, panel2);
    attachHorizontalResizer(panelResizer2, panel2, panel3);
}