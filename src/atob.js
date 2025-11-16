import { loadGTFSFiles } from './gtfsLoader.js';
import { setupAutocomplete } from './autocomplete.js';
import { initializeMap } from './map.js';
import { findTopRoutes, displayRoutes } from './atobSearch.js';

window.addEventListener('DOMContentLoaded', () => {
    // Setup autocomplete for both inputs
    const pointA = document.getElementById('pointA');
    const pointB = document.getElementById('pointB');

    if (pointA) setupAutocomplete(pointA);
    if (pointB) setupAutocomplete(pointB);

    initializeMap();
    loadGTFSFiles();
});

window.findRoutes = findTopRoutes;
