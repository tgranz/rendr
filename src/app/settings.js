export default function openSettings() {
    const settingsWrapper = document.getElementById('settings-wrapper');
    const closeButton = document.getElementById('settings-close');

    if (!settingsWrapper || !closeButton) {
        return;
    }

    const categories = settingsWrapper.querySelectorAll('.settings-category');
    const lists = settingsWrapper.querySelectorAll('.settings-list');

    categories.forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.id.replace('category-', '');
            categories.forEach(b => b.classList.remove('active'));
            lists.forEach(l => l.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(`settings-${target}`)?.classList.add('active');
        });
    });

    // Show first category that's already active, or default to general
    const firstActive = settingsWrapper.querySelector('.settings-category.active');
    if (firstActive) {
        const target = firstActive.id.replace('category-', '');
        document.getElementById(`settings-${target}`)?.classList.add('active');
    } else {
        document.getElementById('category-general')?.classList.add('active');
        document.getElementById('settings-general')?.classList.add('active');
    }

    const themeSelect = document.getElementById('setting-theme');
    if (themeSelect) {
        themeSelect.value = document.documentElement.dataset.theme || 'dark';
        themeSelect.addEventListener('change', () => {
            document.documentElement.dataset.theme = themeSelect.value;
        });
    }

    const samplingRateInput = document.getElementById('setting-audio-sampling-rate');
    const samplingRateValue = document.getElementById('setting-audio-sampling-rate-value');
    const peakHoldInput = document.getElementById('setting-audio-peak-hold');
    const peakHoldValue = document.getElementById('setting-audio-peak-hold-value');
    const peakDecayInput = document.getElementById('setting-audio-peak-decay');
    const peakDecayValue = document.getElementById('setting-audio-peak-decay-value');

    const syncFromTimeline = () => {
        const cfg = window.timelineUI?.audioMeterConfig;
        if (!cfg) return;
        if (samplingRateInput) samplingRateInput.value = cfg.samplingRate;
        if (peakHoldInput) peakHoldInput.value = cfg.peakHoldMs;
        if (peakDecayInput) peakDecayInput.value = cfg.peakDecayDbPerSec;
        updateReadouts();
    };

    const updateReadouts = () => {
        if (samplingRateValue && samplingRateInput) {
            samplingRateValue.textContent = `${samplingRateInput.value} Hz`;
        }
        if (peakHoldValue && peakHoldInput) {
            peakHoldValue.textContent = `${peakHoldInput.value} ms`;
        }
        if (peakDecayValue && peakDecayInput) {
            peakDecayValue.textContent = `${peakDecayInput.value} dB/s`;
        }
    };

    const applyAudioMeterConfig = () => {
        window.timelineUI?.bindAudioMeter(
            Number(samplingRateInput?.value ?? 50),
            Number(peakHoldInput?.value ?? 120),
            Number(peakDecayInput?.value ?? 12),
        );
    };

    syncFromTimeline();

    samplingRateInput?.addEventListener('input', () => { updateReadouts(); applyAudioMeterConfig(); });
    peakHoldInput?.addEventListener('input', () => { updateReadouts(); applyAudioMeterConfig(); });
    peakDecayInput?.addEventListener('input', () => { updateReadouts(); applyAudioMeterConfig(); });

    settingsWrapper.style.display = 'flex';

    const onClose = () => {
        settingsWrapper.style.display = 'none';
        closeButton.removeEventListener('click', onClose);
    };

    closeButton.addEventListener('click', onClose);
}
