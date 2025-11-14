import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runHeatmapSearch, runMeetingSearch } from '../src/search.js';
import { gtfsData, appState, resetParsedDataCollections } from '../src/state.js';
import { parseCSV } from '../src/parsing.js';
import { processGTFSData } from '../src/gtfsProcessing.js';

function resetTestState() {
    gtfsData.stops = [];
    gtfsData.stopTimes = [];
    gtfsData.trips = [];
    gtfsData.routes = [];
    gtfsData.pathways = [];
    gtfsData.transfers = [];
    resetParsedDataCollections();
    appState.isDataProcessed = false;
    appState.stationLookupList = [];
    appState.stationSearchInitialized = false;
}

function loadRealGTFSSubset() {
    resetTestState();
    const base = path.resolve('gtfs_subset');
    const read = name => readFileSync(path.join(base, name), 'utf8');
    gtfsData.stops = parseCSV(read('stops.txt'));
    gtfsData.stopTimes = parseCSV(read('stop_times.txt'));
    gtfsData.trips = parseCSV(read('trips.txt'));
    gtfsData.routes = parseCSV(read('routes.txt'));
    gtfsData.pathways = parseCSV(read('pathways.txt'));
    gtfsData.transfers = parseCSV(read('transfers.txt'));
    processGTFSData();
}

test('runHeatmapSearch provides progress updates during search', async () => {
    loadRealGTFSSubset();

    const startTimeSec = 10 * 3600; // 10:00
    const participants = [
        { label: 'A', query: 'U Uhlandstr. (Berlin)' },
        { label: 'B', query: 'U Vinetastr. (Berlin)' }
    ];

    const progressUpdates = [];
    const stopUpdates = [];

    const result = await runHeatmapSearch({
        participants,
        startTimeSec,
        onProgress: (percent, minutes, iterations, stopsFound) => {
            progressUpdates.push({
                percent,
                minutes,
                iterations,
                stopsFound,
                timestamp: Date.now()
            });
        },
        onStopUpdate: (stopId, lat, lon, totalTime, maxTime) => {
            stopUpdates.push({
                stopId,
                lat,
                lon,
                totalTime,
                maxTime,
                timestamp: Date.now()
            });
        }
    });

    console.log(`\n=== Progress Update Test Results ===`);
    console.log(`Total progress updates: ${progressUpdates.length}`);
    console.log(`Total stop updates: ${stopUpdates.length}`);
    console.log(`Final result: ${result.results.length} meeting points, ${result.iterations} iterations\n`);

    // Verify we got multiple progress updates (not just at the end)
    assert.ok(progressUpdates.length > 5, `Expected multiple progress updates, got ${progressUpdates.length}`);

    // Verify progress percentage increases over time
    for (let i = 1; i < progressUpdates.length; i++) {
        assert.ok(
            progressUpdates[i].percent >= progressUpdates[i - 1].percent,
            `Progress should increase: ${progressUpdates[i - 1].percent}% -> ${progressUpdates[i].percent}%`
        );
    }

    // Verify final progress is 100%
    const finalProgress = progressUpdates[progressUpdates.length - 1];
    assert.equal(finalProgress.percent, 100, 'Final progress should be 100%');

    // Print sample of progress updates
    console.log('Sample progress updates:');
    const sampleIndices = [0, Math.floor(progressUpdates.length / 4), Math.floor(progressUpdates.length / 2),
                           Math.floor(3 * progressUpdates.length / 4), progressUpdates.length - 1];
    for (const idx of sampleIndices) {
        const update = progressUpdates[idx];
        console.log(`  [${idx}] ${update.percent.toFixed(1)}% - ${update.minutes.toFixed(1)} min explored - ${update.iterations} iterations - ${update.stopsFound} stops`);
    }

    console.log('\n=== Test Passed ===\n');
});

test('runMeetingSearch completes and finds meeting point', async () => {
    loadRealGTFSSubset();

    const startTimeSec = 10 * 3600; // 10:00
    const participants = [
        { label: 'A', query: 'U Uhlandstr. (Berlin)' },
        { label: 'B', query: 'U Vinetastr. (Berlin)' }
    ];

    console.log('\n=== Meeting Search Test (point-to-point) ===');
    const startTime = Date.now();

    const result = await runMeetingSearch({
        participants,
        startTimeSec
    });

    const elapsed = Date.now() - startTime;
    console.log(`Search completed in ${elapsed}ms`);
    console.log(`Result: ${result.meeting ? 'Found meeting point' : 'No meeting found'}`);
    console.log(`Iterations: ${result.stats.iterations}`);

    assert.ok(result.meeting, 'Should find a meeting point');
    assert.ok(result.stats.iterations > 0, 'Should perform iterations');

    console.log('=== Test Passed ===\n');
});
