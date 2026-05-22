export const effects = {
    "Saturation": {
        "help": "Adjust color saturation.",
        "icon": "color-filter",
        "type": "color-adjustment",
        "parameters": {
            "saturation": {
                "title": "Saturation",
                "type": "range",
                "min": 0,
                "max": 300,
                "default": 100
            }
        }
    },
    "Blur": {
        "help": "Apply a Gaussian blur effect. (BETA)",
        "icon": "blur",
        "type": "color-adjustment",
        "parameters": {
            "blur": {
                "title": "Blur",
                "type": "range",
                "min": 0,
                "max": 100,
                "default": 0
            }
        }
    },
    "Greenscreen": {
        "help": "Remove a specific color. (a.k.a. Chroma Key)",
        "icon": "color-picker",
        "type": "advanced",
        "parameters": {
            "greenscreen-color": {
                "title": "Color",
                "type": "color",
                "default": "#00FF00"
            },
            "greenscreen-variance": {
                "title": "Variance",
                "type": "range",
                "min": 0,
                "max": 100,
                "default": 10
            }
        }
    },
};

function clampChannel(value) {
    return Math.max(0, Math.min(255, value));
}

function parseHexColor(hexValue) {
    if (typeof hexValue !== 'string') {
        return { red: 0, green: 255, blue: 0 };
    }

    const normalized = hexValue.trim().replace(/^#/, '');
    const expanded = normalized.length === 3
        ? normalized.split('').map(channel => channel + channel).join('')
        : normalized;

    if (!/^[0-9a-fA-F]{6}$/.test(expanded)) {
        return { red: 0, green: 255, blue: 0 };
    }

    return {
        red: Number.parseInt(expanded.slice(0, 2), 16),
        green: Number.parseInt(expanded.slice(2, 4), 16),
        blue: Number.parseInt(expanded.slice(4, 6), 16),
    };
}

export function getEffectDefinition(effectName) {
    return effects[effectName] || null;
}

export function normalizeEffectParameters(effectName, parameters = {}) {
    const definition = getEffectDefinition(effectName);
    if (!definition) {
        return { ...parameters };
    }

    const normalized = {};
    for (const [parameterName, parameterConfig] of Object.entries(definition.parameters || {})) {
        normalized[parameterName] = parameters[parameterName] ?? parameterConfig.default;
    }

    return { ...normalized, ...parameters };
}

function getImageDataFrame(frame) {
    if (!frame) {
        return null;
    }

    if (typeof ImageData !== 'undefined' && frame instanceof ImageData) {
        return { imageData: frame, context: null, canvas: null };
    }

    if (typeof frame.getContext === 'function') {
        const context = frame.getContext('2d');
        if (!context) {
            return null;
        }

        return {
            imageData: context.getImageData(0, 0, frame.width, frame.height),
            context,
            canvas: frame,
        };
    }

    if (typeof frame.getImageData === 'function' && typeof frame.putImageData === 'function') {
        const canvas = frame.canvas || null;
        const width = canvas?.width || frame.width || 0;
        const height = canvas?.height || frame.height || 0;
        return {
            imageData: frame.getImageData(0, 0, width, height),
            context: frame,
            canvas,
        };
    }

    return null;
}

function applySaturation(imageData, saturationValue) {
    const data = imageData.data;
    const factor = Math.max(0, Number(saturationValue) || 0) / 100;

    for (let index = 0; index < data.length; index += 4) {
        const red = data[index];
        const green = data[index + 1];
        const blue = data[index + 2];
        const luminance = (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);

        data[index] = clampChannel(luminance + ((red - luminance) * factor));
        data[index + 1] = clampChannel(luminance + ((green - luminance) * factor));
        data[index + 2] = clampChannel(luminance + ((blue - luminance) * factor));
    }

    return imageData;
}

function applyGreenscreen(imageData, parameters) {
    const { red: targetRed, green: targetGreen, blue: targetBlue } = parseHexColor(parameters['greenscreen-color']);
    const variance = Math.max(0, Math.min(100, Number(parameters['greenscreen-variance']) || 0));
    const maxDistance = variance * 3.2;
    const softEdge = Math.max(1, maxDistance * 0.5);
    const data = imageData.data;

    for (let index = 0; index < data.length; index += 4) {
        const red = data[index];
        const green = data[index + 1];
        const blue = data[index + 2];
        const distance = Math.sqrt(
            ((red - targetRed) ** 2) +
            ((green - targetGreen) ** 2) +
            ((blue - targetBlue) ** 2)
        );

        if (distance <= maxDistance) {
            data[index] = 0;
            data[index + 1] = 0;
            data[index + 2] = 0;
            data[index + 3] = 0;
        } else if (distance <= maxDistance + softEdge) {
            const fade = (distance - maxDistance) / softEdge;
            data[index] = clampChannel(data[index] * fade);
            data[index + 1] = clampChannel(data[index + 1] * fade);
            data[index + 2] = clampChannel(data[index + 2] * fade);
            data[index + 3] = clampChannel(data[index + 3] * fade);
        }
    }

    return imageData;
}

function applyBoxBlur(imageData, blurValue) {
    const radius = Math.max(0, Math.min(32, Math.round((Number(blurValue) || 0) / 10)));
    if (radius <= 0) {
        return imageData;
    }

    const { width, height, data } = imageData;
    const source = new Uint8ClampedArray(data);
    const temp = new Uint8ClampedArray(data.length);
    const windowSize = (radius * 2) + 1;

    for (let y = 0; y < height; y += 1) {
        let redSum = 0;
        let greenSum = 0;
        let blueSum = 0;
        let alphaSum = 0;

        for (let x = -radius; x <= radius; x += 1) {
            const clampedX = Math.max(0, Math.min(width - 1, x));
            const offset = (y * width + clampedX) * 4;
            redSum += source[offset];
            greenSum += source[offset + 1];
            blueSum += source[offset + 2];
            alphaSum += source[offset + 3];
        }

        for (let x = 0; x < width; x += 1) {
            const tempOffset = (y * width + x) * 4;
            temp[tempOffset] = redSum / windowSize;
            temp[tempOffset + 1] = greenSum / windowSize;
            temp[tempOffset + 2] = blueSum / windowSize;
            temp[tempOffset + 3] = alphaSum / windowSize;

            const leftX = Math.max(0, x - radius);
            const rightX = Math.min(width - 1, x + radius + 1);
            const leftOffset = (y * width + leftX) * 4;
            const rightOffset = (y * width + rightX) * 4;

            redSum += source[rightOffset] - source[leftOffset];
            greenSum += source[rightOffset + 1] - source[leftOffset + 1];
            blueSum += source[rightOffset + 2] - source[leftOffset + 2];
            alphaSum += source[rightOffset + 3] - source[leftOffset + 3];
        }
    }

    for (let x = 0; x < width; x += 1) {
        let redSum = 0;
        let greenSum = 0;
        let blueSum = 0;
        let alphaSum = 0;

        for (let y = -radius; y <= radius; y += 1) {
            const clampedY = Math.max(0, Math.min(height - 1, y));
            const offset = (clampedY * width + x) * 4;
            redSum += temp[offset];
            greenSum += temp[offset + 1];
            blueSum += temp[offset + 2];
            alphaSum += temp[offset + 3];
        }

        for (let y = 0; y < height; y += 1) {
            const offset = (y * width + x) * 4;
            data[offset] = redSum / windowSize;
            data[offset + 1] = greenSum / windowSize;
            data[offset + 2] = blueSum / windowSize;
            data[offset + 3] = alphaSum / windowSize;

            const topY = Math.max(0, y - radius);
            const bottomY = Math.min(height - 1, y + radius + 1);
            const topOffset = (topY * width + x) * 4;
            const bottomOffset = (bottomY * width + x) * 4;

            redSum += temp[bottomOffset] - temp[topOffset];
            greenSum += temp[bottomOffset + 1] - temp[topOffset + 1];
            blueSum += temp[bottomOffset + 2] - temp[topOffset + 2];
            alphaSum += temp[bottomOffset + 3] - temp[topOffset + 3];
        }
    }

    return imageData;
}

export function applyEffectToFrame(effectName, parameters, frame) {
    const frameData = getImageDataFrame(frame);
    if (!frameData) {
        return frame;
    }

    const normalizedParameters = normalizeEffectParameters(effectName, parameters);

    switch (effectName) {
        case 'Saturation':
            applySaturation(frameData.imageData, normalizedParameters.saturation);
            break;
        case 'Blur':
            applyBoxBlur(frameData.imageData, normalizedParameters.blur);
            break;
        case 'Greenscreen':
            applyGreenscreen(frameData.imageData, normalizedParameters);
            break;
        default:
            return frameData.imageData;
    }

    if (frameData.context && frameData.canvas) {
        frameData.context.putImageData(frameData.imageData, 0, 0);
    }

    return frameData.imageData;
}
