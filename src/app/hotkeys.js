export default function bindHotkeyToCallback(keycombo, callback) {
    const tokens = keycombo.toLowerCase().split('+').map(s => s.trim()).filter(Boolean);
    const modifierAliases = {
        ctrl: 'ctrlKey',
        control: 'ctrlKey',
        shift: 'shiftKey',
        alt: 'altKey',
        option: 'altKey',
        meta: 'metaKey',
        cmd: 'metaKey',
        command: 'metaKey'
    };

    const requiredModifierKeys = new Set();
    const nonModifierTokens = [];

    tokens.forEach(token => {
        const modifierProp = modifierAliases[token];
        if (modifierProp) {
            requiredModifierKeys.add(modifierProp);
        } else {
            nonModifierTokens.push(token);
        }
    });

    const comboKey = nonModifierTokens[0] || '';

    window.addEventListener('keydown', event => {
        const modifiersMatch = Array.from(requiredModifierKeys).every(mod => event[mod]);
        if (!modifiersMatch) {
            return;
        }

        let keyMatches = false;

        if (comboKey === 'space') {
            keyMatches = event.code === 'Space' || event.key === ' ';
        } else if (comboKey.length === 1) {
            keyMatches = event.key.toLowerCase() === comboKey;
        } else {
            keyMatches = event.key.toLowerCase() === comboKey || event.code.toLowerCase() === comboKey;
        }

        if (keyMatches) {
            event.preventDefault();
            callback(event);
        }
    }, true);

}