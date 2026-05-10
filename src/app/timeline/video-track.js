let _clipIdCounter = 0;

export default class VideoTrack {
    constructor(name) {
        /*

        this.sequence will look like this:

        {
            position: 0, // seconds offset from the clip's start to the timeline start
            start: 0, // timestamp when the clip should start playing, in seconds from clip start
            duration: 5 // duration of the clip in seconds
            clip: <clipObject> // reference to the clip object in the project bin
        }
        */

        this.sequence = [];
        this.type = 'video';
        this.name = name;
    }

    parseDurationToSeconds(value) {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }

        if (typeof value === 'string') {
            // Supports "HH:MM:SS" as produced by MediaInfo formatting.
            if (value.includes(':')) {
                const parts = value.split(':').map(Number);
                if (parts.length === 3 && parts.every(Number.isFinite)) {
                    const [hours, minutes, seconds] = parts;
                    return (hours * 3600) + (minutes * 60) + seconds;
                }
            }

            const numeric = Number.parseFloat(value);
            if (Number.isFinite(numeric)) {
                return numeric;
            }
        }

        return null;
    }

    getType() {
        return this.type;
    }

    async addClipToTrack(clip, position=0, start=0, duration=null) {
        const resolvedDuration =
            this.parseDurationToSeconds(duration) ??
            this.parseDurationToSeconds(clip?.properties?.duration_seconds) ??
            this.parseDurationToSeconds(clip?.properties?.duration) ??
            5;

        let thumbnail = null;
        try {
            thumbnail = await window.projectBin.getThumbnail(clip.name, start);
        } catch (error) {
            console.warn('Failed to load thumbnail for clip:', clip.name, error);
        }

        const thisClip = {
            id: `${clip.name}-${Date.now()}-${++_clipIdCounter}`, // unique ID for this clip instance on the timeline
            name: clip.name,
            clip,
            position,
            start,
            duration: resolvedDuration,
            thumbnail,
            linked: []
        };

        this.sequence.push(thisClip);

        return thisClip;
    }

    async removeClipFromTrack(clipId) {
        const clipIndex = this.sequence.findIndex(c => c.id === clipId);
        if (clipIndex === -1) {
            return false; // Clip not found
        }

        this.sequence.splice(clipIndex, 1);
        return true;
    }

    async split(splitTime) {
        // Only one or no clip should exist at any point
        // Splitting a clip creates two clip objects

        const clipIndex = this.sequence.findIndex(c => c.position <= splitTime && (c.position + c.duration) > splitTime);
        if (clipIndex === -1) {
            window.setMessage("No clip to split", "warning", "yellow");
            return null; // No clip to split at this time
        }

        const clip = this.sequence[clipIndex];
        const splitPosition = splitTime - clip.position;

        if (splitPosition <= 0 || splitPosition >= clip.duration) {
            return null;
        }

        const firstHalf = { ...clip, duration: splitPosition };
        const secondHalf = { ...clip, position: clip.position + splitPosition, start: clip.start + splitPosition, duration: clip.duration - splitPosition };

        // secondHalf gets a new thumbnail based on its source offset
        try {
            secondHalf.thumbnail = await window.projectBin.getThumbnail(clip.name, secondHalf.start);
        } catch (error) {
            console.warn('Failed to load thumbnail for split clip:', clip.name, error);
            secondHalf.thumbnail = null;
        }

        // secondHalf gets a new unique ID
        secondHalf.id = `${clip.name}-${Date.now()}-split`;

        // Clips can no longer be linked
        firstHalf.linked = [];
        secondHalf.linked = [];

        this.sequence.splice(clipIndex, 1, firstHalf, secondHalf);
        return [firstHalf, secondHalf];
    }

    linkClip(clip, toLink) {
        clip.linked.push(toLink);
    }

    getLinks(clip) {
        return clip.linked;
    }

    unlinkClip(clip, toUnlink) {
        clip.linked = clip.linked.filter(link => link !== toUnlink);
    }
}