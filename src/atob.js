import { loadGTFSFiles } from './gtfsLoader.js';
import { setupAutocomplete } from './autocomplete.js';
import { initializeMap } from './map.js';
import { findTopRoutes, displayRoutes } from './atobSearch.js';
import { algorithmRegistry } from './algorithms/algorithmRegistry.js';

window.addEventListener('DOMContentLoaded', () => {
    // Setup autocomplete for both inputs
    const pointA = document.getElementById('pointA');
    const pointB = document.getElementById('pointB');

    if (pointA) setupAutocomplete(pointA);
    if (pointB) setupAutocomplete(pointB);

    // Populate algorithm dropdown
    const algorithmSelect = document.getElementById('algorithmSelect');
    if (algorithmSelect) {
        const algorithms = algorithmRegistry.getAllAlgorithms();
        const defaultAlgo = algorithmRegistry.getDefaultAlgorithmName();

        algorithms.forEach(algo => {
            const option = document.createElement('option');
            option.value = algo.name;
            option.textContent = `${algo.name} - ${algo.description}`;
            if (algo.name === defaultAlgo) {
                option.selected = true;
            }
            algorithmSelect.appendChild(option);
        });
    }

    initializeMap();
    loadGTFSFiles();
});

window.findRoutes = findTopRoutes;
