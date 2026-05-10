export default class SettingsManager {
    constructor() {
        this.settings = {};
        this.defaults = {
            
        };

        const savedSettings = localStorage.getItem('rendrSettings');
        if (savedSettings) {
            try {
                this.settings = JSON.parse(savedSettings);
            } catch (error) {
                this.settings = this.defaults;
            }
        }
    }

    setSetting(key, value) {
        this.settings[key] = value;
        localStorage.setItem('rendrSettings', JSON.stringify(this.settings));
    }

    getSetting(key) {
        const setting = this.settings[key];
        return setting !== undefined ? setting : this.defaults[key];
    }
}