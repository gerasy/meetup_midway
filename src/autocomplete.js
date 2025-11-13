import { gtfsData, parsedData } from './state.js';
import { searchAddress, findNearestStation, formatStationWithDistance } from './geocoding.js';

// Debounce function to limit API calls
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

export function setupAutocomplete(inputElement) {
    if (!inputElement) return;

    const label = inputElement.dataset.personLabel || 'unknown';
    const listId = `autocomplete-list-${label}`;

    // Remove existing autocomplete list if any
    const existingList = document.getElementById(listId);
    if (existingList) {
        existingList.remove();
    }

    // Create autocomplete container
    const autocompleteContainer = document.createElement('div');
    autocompleteContainer.id = listId;
    autocompleteContainer.style.cssText = `
        position: absolute;
        z-index: 1000;
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 8px;
        max-height: 300px;
        overflow-y: auto;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
        display: none;
        margin-top: 4px;
    `;

    inputElement.parentNode.style.position = 'relative';
    inputElement.parentNode.appendChild(autocompleteContainer);

    let selectedIndex = -1;
    let currentResults = [];
    let selectedAddress = null;

    const hideAutocomplete = () => {
        autocompleteContainer.style.display = 'none';
        selectedIndex = -1;
    };

    const showAutocomplete = () => {
        if (currentResults.length > 0) {
            autocompleteContainer.style.display = 'block';
            autocompleteContainer.style.width = inputElement.offsetWidth + 'px';
        }
    };

    const highlightItem = (index) => {
        const items = autocompleteContainer.querySelectorAll('.autocomplete-item');
        items.forEach((item, i) => {
            if (i === index) {
                item.style.background = 'var(--accent)';
                item.style.color = 'var(--bg)';
                item.scrollIntoView({ block: 'nearest' });
            } else {
                item.style.background = '';
                item.style.color = '';
            }
        });
    };

    const selectItem = (index) => {
        if (index >= 0 && index < currentResults.length) {
            const result = currentResults[index];

            if (result.type === 'station') {
                inputElement.value = result.name;
                selectedAddress = null;
            } else if (result.type === 'address') {
                inputElement.value = result.displayName;
                selectedAddress = result;

                // Store the coordinates for later use
                inputElement.dataset.addressLat = result.lat;
                inputElement.dataset.addressLon = result.lon;
            }

            hideAutocomplete();
        }
    };

    const renderResults = (stations, addresses) => {
        autocompleteContainer.innerHTML = '';
        currentResults = [];

        // Add station results
        if (stations.length > 0) {
            const stationHeader = document.createElement('div');
            stationHeader.textContent = 'Transit Stations';
            stationHeader.style.cssText = `
                padding: 8px 12px;
                font-weight: bold;
                font-size: 11px;
                text-transform: uppercase;
                color: var(--subtle-text);
                background: var(--panel-soft);
                border-bottom: 1px solid var(--border);
            `;
            autocompleteContainer.appendChild(stationHeader);

            stations.forEach(station => {
                const item = document.createElement('div');
                item.className = 'autocomplete-item';
                item.textContent = station;
                item.style.cssText = `
                    padding: 10px 12px;
                    cursor: pointer;
                    border-bottom: 1px solid var(--border);
                    font-size: 14px;
                `;

                item.addEventListener('mouseenter', () => {
                    selectedIndex = currentResults.length;
                    highlightItem(selectedIndex);
                });

                item.addEventListener('click', () => {
                    selectItem(currentResults.length);
                });

                autocompleteContainer.appendChild(item);
                currentResults.push({ type: 'station', name: station });
            });
        }

        // Add address results
        if (addresses.length > 0) {
            const addressHeader = document.createElement('div');
            addressHeader.textContent = 'Addresses';
            addressHeader.style.cssText = `
                padding: 8px 12px;
                font-weight: bold;
                font-size: 11px;
                text-transform: uppercase;
                color: var(--subtle-text);
                background: var(--panel-soft);
                border-bottom: 1px solid var(--border);
            `;
            autocompleteContainer.appendChild(addressHeader);

            addresses.forEach(address => {
                const item = document.createElement('div');
                item.className = 'autocomplete-item';

                const mainText = document.createElement('div');
                mainText.textContent = address.displayName;
                mainText.style.cssText = 'font-size: 14px;';

                item.appendChild(mainText);
                item.style.cssText = `
                    padding: 10px 12px;
                    cursor: pointer;
                    border-bottom: 1px solid var(--border);
                `;

                item.addEventListener('mouseenter', () => {
                    selectedIndex = currentResults.length;
                    highlightItem(selectedIndex);
                });

                item.addEventListener('click', () => {
                    selectItem(currentResults.length);
                });

                autocompleteContainer.appendChild(item);
                currentResults.push({ type: 'address', ...address });
            });
        }

        if (currentResults.length > 0) {
            showAutocomplete();
        } else {
            hideAutocomplete();
        }
    };

    const searchStations = (query) => {
        const q = query.toLowerCase().trim();
        if (!q) return [];

        const matches = [];
        const seen = new Set();

        parsedData.stationToName.forEach((name, stationId) => {
            if (name.toLowerCase().includes(q) && !seen.has(name)) {
                seen.add(name);
                matches.push(name);
            }
        });

        return matches.sort().slice(0, 5);
    };

    const performSearch = debounce(async (query) => {
        if (!query || query.trim().length < 2) {
            hideAutocomplete();
            return;
        }

        // Search stations locally
        const stationResults = searchStations(query);

        // Search addresses via Nominatim
        const addressResults = await searchAddress(query);

        renderResults(stationResults, addressResults);
    }, 500);

    // Event listeners
    inputElement.addEventListener('input', (e) => {
        selectedAddress = null;
        delete inputElement.dataset.addressLat;
        delete inputElement.dataset.addressLon;
        performSearch(e.target.value);
    });

    inputElement.addEventListener('keydown', (e) => {
        if (!autocompleteContainer.style.display || autocompleteContainer.style.display === 'none') {
            return;
        }

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                selectedIndex = Math.min(selectedIndex + 1, currentResults.length - 1);
                highlightItem(selectedIndex);
                break;
            case 'ArrowUp':
                e.preventDefault();
                selectedIndex = Math.max(selectedIndex - 1, -1);
                highlightItem(selectedIndex);
                break;
            case 'Enter':
                e.preventDefault();
                if (selectedIndex >= 0) {
                    selectItem(selectedIndex);
                }
                break;
            case 'Escape':
                e.preventDefault();
                hideAutocomplete();
                break;
        }
    });

    inputElement.addEventListener('focus', () => {
        if (inputElement.value.trim().length >= 2) {
            performSearch(inputElement.value);
        }
    });

    // Click outside to close
    document.addEventListener('click', (e) => {
        if (!inputElement.contains(e.target) && !autocompleteContainer.contains(e.target)) {
            hideAutocomplete();
        }
    });

    return {
        getSelectedAddress: () => selectedAddress,
        destroy: () => {
            autocompleteContainer.remove();
        }
    };
}
