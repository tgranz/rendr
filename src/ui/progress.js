const progressElement = document.getElementById('progress');
const progressLabel = progressElement.querySelector('#progress-label');
const menubarElement = document.getElementById('secondary-menubar');

window.setProgress = function(taskName, progressPercent) {
    if (progressPercent < 0 || progressPercent > 100) {
        throw new Error('Progress percent out of bounds. Expected 0-100, got ' + progressPercent);
    }

    progressElement.style.removeProperty('background');
    progressElement.style.display = 'flex';
    menubarElement.style.display = 'none';

    if (taskName === null) {
        // Update to progress percent only, no task name change
        progressElement.style.setProperty('--progress', progressPercent + '%');
    } else if (progressPercent === null) {
        // Update to task name only, no progress percent change
        progressLabel.textContent = taskName;
    } else {
        // Update both task name and progress percent
        progressLabel.textContent = taskName;
        progressElement.style.setProperty('--progress', progressPercent + '%');
    }
}

window.progressError = function(errorString) {
    progressLabel.textContent = errorString ? errorString : 'Error';
    progressElement.style.setProperty('--progress', '0%');
    progressElement.style.setProperty('background', 'var(--bad-color-translucent)', 'important');
}

window.stopProgress = function() {
    progressElement.style.display = 'none';
    menubarElement.style.display = 'flex';
}