import { gtfsData } from './state.js';
import { parseCSV } from './parsing.js';
import { processGTFSData } from './gtfsProcessing.js';
import { setStatus } from './ui.js';

export async function loadGTFSFiles() {
    setStatus('Loading GTFS files...', 'loading');

    const files = [
        'stops.txt',
        'stop_times.txt',
        'trips.txt',
        'routes.txt',
        'pathways.txt',
        'transfers.txt'
    ];

    try {
        for (const fileName of files) {
            const response = await fetch(`gtfs_subset/${fileName}`);
            if (!response.ok) {
                throw new Error(`Failed to load ${fileName}`);
            }
            const text = await response.text();

            if (fileName === 'stops.txt') {
                gtfsData.stops = parseCSV(text);
            } else if (fileName === 'stop_times.txt') {
                gtfsData.stopTimes = parseCSV(text);
            } else if (fileName === 'trips.txt') {
                gtfsData.trips = parseCSV(text);
            } else if (fileName === 'routes.txt') {
                gtfsData.routes = parseCSV(text);
            } else if (fileName === 'pathways.txt') {
                gtfsData.pathways = parseCSV(text);
            } else if (fileName === 'transfers.txt') {
                gtfsData.transfers = parseCSV(text);
            }
        }

        setStatus('GTFS files loaded. Processing data...', 'loading');
        processGTFSData();
        document.getElementById('findMeeting').disabled = false;
    } catch (error) {
        setStatus('Error loading GTFS files: ' + error.message, 'error');
        console.error(error);
    }
}
