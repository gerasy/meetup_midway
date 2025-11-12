import { loadGTFSFiles } from './gtfsLoader.js';
import { findMeetingPoint } from './search.js';

window.addEventListener('DOMContentLoaded', loadGTFSFiles);
window.findMeetingPoint = findMeetingPoint;
