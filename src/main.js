import { loadGTFSFiles } from './gtfsLoader.js';
import { findMeetingPoint } from './search.js';
import { setupParticipantControls } from './participants.js';
import { initializeMap } from './map.js';

window.addEventListener('DOMContentLoaded', () => {
    setupParticipantControls();
    initializeMap();
    loadGTFSFiles();
});

window.findMeetingPoint = findMeetingPoint;
