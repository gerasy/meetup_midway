import { loadGTFSFiles } from './gtfsLoader.js';
import { findMeetingPoint } from './search.js';
import { setupParticipantControls } from './participants.js';

window.addEventListener('DOMContentLoaded', () => {
    setupParticipantControls();
    loadGTFSFiles();
});

window.findMeetingPoint = findMeetingPoint;
