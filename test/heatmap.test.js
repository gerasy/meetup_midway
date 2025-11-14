import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runHeatmapSearch } from '../src/search.js';
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

function loadSimpleNetworkFixture() {
    resetTestState();

    // Create a simple network: A -> B -> C -> D
    gtfsData.stops = [
        { stop_id: 'stop_A', stop_name: 'Station A', stop_lat: '52.520', stop_lon: '13.400', location_type: 0 },
        { stop_id: 'stop_B', stop_name: 'Station B', stop_lat: '52.521', stop_lon: '13.405', location_type: 0 },
        { stop_id: 'stop_C', stop_name: 'Station C', stop_lat: '52.522', stop_lon: '13.410', location_type: 0 },
        { stop_id: 'stop_D', stop_name: 'Station D', stop_lat: '52.523', stop_lon: '13.415', location_type: 0 }
    ];

    gtfsData.routes = [
        { route_id: 'R1', route_short_name: 'R1', route_long_name: 'Route 1', route_type: 0 }
    ];

    gtfsData.trips = [
        { trip_id: 'trip1', route_id: 'R1', service_id: 'WK', trip_headsign: 'To D' }
    ];

    // A train goes A -> B -> C -> D, departing every station at specific times
    gtfsData.stopTimes = [
        { trip_id: 'trip1', arrival_time: '10:00:00', departure_time: '10:00:00', stop_id: 'stop_A', stop_sequence: '1' },
        { trip_id: 'trip1', arrival_time: '10:05:00', departure_time: '10:05:00', stop_id: 'stop_B', stop_sequence: '2' },
        { trip_id: 'trip1', arrival_time: '10:10:00', departure_time: '10:10:00', stop_id: 'stop_C', stop_sequence: '3' },
        { trip_id: 'trip1', arrival_time: '10:15:00', departure_time: '10:15:00', stop_id: 'stop_D', stop_sequence: '4' }
    ];

    gtfsData.pathways = [];
    gtfsData.transfers = [];
}

test('runHeatmapSearch finds all reachable meeting points in simple network', async () => {
    loadSimpleNetworkFixture();

    const startTimeSec = 10 * 3600; // 10:00
    const participants = [
        { label: 'A', query: 'Station A', startStopId: 'stop_A' },
        { label: 'D', query: 'Station D', startStopId: 'stop_D' }
    ];

    let progressCalls = 0;
    let stopUpdateCalls = 0;
    const discoveredStops = [];

    const result = await runHeatmapSearch({
        participants,
        startTimeSec,
        onProgress: (percent, minutes, iterations, stopsFound) => {
            progressCalls++;
            assert.ok(percent >= 0 && percent <= 100, 'progress percent should be in valid range');
            assert.ok(minutes >= 0, 'minutes should be non-negative');
            assert.ok(iterations >= 0, 'iterations should be non-negative');
            assert.ok(stopsFound >= 0, 'stopsFound should be non-negative');
        },
        onStopUpdate: (stopId, lat, lon, totalTime, maxTime) => {
            stopUpdateCalls++;
            discoveredStops.push({ stopId, lat, lon, totalTime, maxTime });
            assert.ok(typeof stopId === 'string', 'stopId should be a string');
            assert.ok(typeof lat === 'number', 'lat should be a number');
            assert.ok(typeof lon === 'number', 'lon should be a number');
            assert.ok(totalTime > 0, 'totalTime should be positive');
            assert.ok(maxTime > 0, 'maxTime should be positive');
            assert.ok(totalTime >= maxTime, 'totalTime should be >= maxTime');
        }
    });

    // Verify basic result structure
    assert.ok(result, 'result should exist');
    assert.ok(Array.isArray(result.results), 'results should be an array');
    assert.ok(result.results.length > 0, 'should find at least one meeting point');
    assert.ok(result.iterations > 0, 'should have performed iterations');
    assert.ok(result.totalStopsReached > 0, 'should have reached some stops');

    console.log(`Found ${result.results.length} meeting points in ${result.iterations} iterations`);

    // Verify callbacks were called
    assert.ok(progressCalls > 0, 'progress callback should be called');

    // Verify all results have required properties
    for (const stop of result.results) {
        assert.ok(stop.stopId, 'each stop should have an ID');
        assert.ok(typeof stop.lat === 'number', 'each stop should have latitude');
        assert.ok(typeof stop.lon === 'number', 'each stop should have longitude');
        assert.ok(stop.totalTime > 0, 'each stop should have positive total time');
        assert.ok(stop.maxTime > 0, 'each stop should have positive max time');
        assert.ok(Array.isArray(stop.times), 'each stop should have times array');
        assert.equal(stop.times.length, 2, 'times array should have entry for each participant');
    }

    // Verify best meeting point makes sense
    const sortedByTotal = [...result.results].sort((a, b) => a.totalTime - b.totalTime);
    const bestStop = sortedByTotal[0];
    console.log(`Best meeting point: ${bestStop.stopId}, total time: ${(bestStop.totalTime / 60).toFixed(1)} min`);

    // In this simple network, the best meeting point should be B or C (middle stations)
    assert.ok(['stop_B', 'stop_C'].includes(bestStop.stopId), 'best meeting point should be a middle station');
});

test('runHeatmapSearch with real GTFS data finds comprehensive results', async () => {
    loadRealGTFSSubset();

    const startTimeSec = 10 * 3600; // 10:00
    const participants = [
        { label: 'A', query: 'U Uhlandstr. (Berlin)' },
        { label: 'B', query: 'U Vinetastr. (Berlin)' }
    ];

    let lastProgressPercent = -1;
    const progressUpdates = [];

    const result = await runHeatmapSearch({
        participants,
        startTimeSec,
        maxIterations: 500000, // Limit for faster tests (needs enough iterations to find meeting points)
        onProgress: (percent, minutes, iterations, stopsFound) => {
            progressUpdates.push({ percent, minutes, iterations, stopsFound });
            assert.ok(percent >= lastProgressPercent, 'progress should be monotonically increasing');
            lastProgressPercent = percent;
        },
        onStopUpdate: (stopId, lat, lon, totalTime, maxTime) => {
            // Just verify the parameters are valid
            assert.ok(stopId, 'stopId should exist');
            assert.ok(!isNaN(lat) && !isNaN(lon), 'coordinates should be valid numbers');
        }
    });

    // Verify comprehensive results (relaxed for limited iterations)
    assert.ok(result.results.length > 50, `should find some meeting points (found ${result.results.length})`);
    assert.ok(result.iterations > 1000, `should perform iterations (found ${result.iterations})`);
    console.log(`Heatmap search completed: ${result.results.length} meeting points, ${result.iterations} iterations`);

    if (result.results.length > 0) {
        // Verify time ranges are reasonable
        const times = result.results.map(r => r.totalTime / 60); // convert to minutes
        const minTime = Math.min(...times);
        const maxTime = Math.max(...times);
        const avgTime = times.reduce((a, b) => a + b, 0) / times.length;

        console.log(`Time range: ${minTime.toFixed(1)} - ${maxTime.toFixed(1)} min (avg: ${avgTime.toFixed(1)} min)`);

        assert.ok(minTime > 0, 'minimum time should be positive');
        // Note: max time can exceed 120 minutes in heatmap mode as it explores all reachable nodes
        assert.ok(maxTime <= 300, 'maximum time should be reasonable (within 5 hours)');
        if (result.results.length > 1) {
            assert.ok(minTime < maxTime, 'should have a range of times');
        }
    }

    // Verify progress was tracked
    assert.ok(progressUpdates.length > 0, 'progress should be updated');
    assert.equal(progressUpdates[progressUpdates.length - 1].percent, 100, 'final progress should be 100%');

    // Probe a few specific stations
    const sortedByTotal = [...result.results].sort((a, b) => a.totalTime - b.totalTime);
    const bestStop = sortedByTotal[0];
    const worstStop = sortedByTotal[sortedByTotal.length - 1];
    const middleStop = sortedByTotal[Math.floor(sortedByTotal.length / 2)];

    console.log('\nSample stations:');
    console.log(`  Best: ${bestStop.stopId} - ${(bestStop.totalTime / 60).toFixed(1)} min total, ${(bestStop.maxTime / 60).toFixed(1)} min max`);
    console.log(`  Middle: ${middleStop.stopId} - ${(middleStop.totalTime / 60).toFixed(1)} min total, ${(middleStop.maxTime / 60).toFixed(1)} min max`);
    console.log(`  Worst: ${worstStop.stopId} - ${(worstStop.totalTime / 60).toFixed(1)} min total, ${(worstStop.maxTime / 60).toFixed(1)} min max`);

    // Verify individual participant times
    for (const stop of [bestStop, middleStop, worstStop]) {
        assert.equal(stop.times.length, 2, 'each stop should have times for both participants');
        assert.ok(stop.times[0] > 0, 'participant A should have positive travel time');
        assert.ok(stop.times[1] > 0, 'participant B should have positive travel time');

        const sum = stop.times.reduce((a, b) => a + b, 0);
        assert.equal(sum, stop.totalTime, 'total time should equal sum of individual times');

        const max = Math.max(...stop.times);
        assert.equal(max, stop.maxTime, 'max time should equal maximum individual time');
    }
});

test('runHeatmapSearch with three participants finds valid meeting points', async () => {
    loadRealGTFSSubset();

    const startTimeSec = 10 * 3600; // 10:00
    const participants = [
        { label: 'A', query: 'U Uhlandstr. (Berlin)' },
        { label: 'B', query: 'U Vinetastr. (Berlin)' },
        { label: 'C', query: 'S+U Pankow (Berlin)' }
    ];

    const result = await runHeatmapSearch({
        participants,
        startTimeSec,
        maxIterations: 500000 // Limit for faster tests (needs enough iterations to find meeting points)
    });

    assert.ok(result.results.length > 0, 'should find meeting points for three participants');
    console.log(`Found ${result.results.length} meeting points for 3 participants`);

    // Verify each result has 3 participant times
    for (const stop of result.results) {
        assert.equal(stop.times.length, 3, 'each stop should have times for all 3 participants');
        assert.ok(stop.times.every(t => t >= 0), 'all times should be non-negative');
    }

    // Find and verify best meeting point
    const sortedByTotal = [...result.results].sort((a, b) => a.totalTime - b.totalTime);
    const bestStop = sortedByTotal[0];

    console.log(`Best meeting point: ${bestStop.stopId}`);
    console.log(`  Participant A: ${(bestStop.times[0] / 60).toFixed(1)} min`);
    console.log(`  Participant B: ${(bestStop.times[1] / 60).toFixed(1)} min`);
    console.log(`  Participant C: ${(bestStop.times[2] / 60).toFixed(1)} min`);
    console.log(`  Total: ${(bestStop.totalTime / 60).toFixed(1)} min`);

    // Verify totals are correct
    const calculatedTotal = bestStop.times.reduce((a, b) => a + b, 0);
    assert.equal(calculatedTotal, bestStop.totalTime, 'total should equal sum of individual times');
});

test('runHeatmapSearch handles participants starting from addresses', async () => {
    loadRealGTFSSubset();

    const startTimeSec = 10 * 3600; // 10:00

    // Use real Berlin coordinates
    const participants = [
        {
            label: 'A',
            query: 'Seydlitzstr. 19, Berlin',
            isAddress: true,
            lat: 52.5254,
            lon: 13.3692
        },
        {
            label: 'B',
            query: 'Martin-Luther-Str. 30, Berlin',
            isAddress: true,
            lat: 52.4956,
            lon: 13.3489
        }
    ];

    const result = await runHeatmapSearch({
        participants,
        startTimeSec,
        maxIterations: 500000 // Limit for faster tests (needs enough iterations to find meeting points)
    });

    assert.ok(result.results.length > 0, 'should find meeting points for address-based participants');
    console.log(`Found ${result.results.length} meeting points for address-based search`);

    // Verify results are valid
    const sortedByTotal = [...result.results].sort((a, b) => a.totalTime - b.totalTime);
    const bestStop = sortedByTotal[0];

    console.log(`Best meeting point from addresses: ${bestStop.stopId}`);
    console.log(`  Total time: ${(bestStop.totalTime / 60).toFixed(1)} min`);

    assert.ok(bestStop.totalTime > 0, 'should have positive travel time from addresses');
    assert.ok(bestStop.times.every(t => t > 0), 'both participants should have walking time to transit');
});

test('runHeatmapSearch results are deterministic', async () => {
    loadRealGTFSSubset();

    const startTimeSec = 10 * 3600;
    const participants = [
        { label: 'A', query: 'U Gleisdreieck (Berlin)' },
        { label: 'B', query: 'S+U Pankow (Berlin)' }
    ];

    // Run twice with same parameters
    const result1 = await runHeatmapSearch({ participants, startTimeSec, maxIterations: 250000 });
    const result2 = await runHeatmapSearch({ participants, startTimeSec, maxIterations: 250000 });

    // Results should be identical
    assert.equal(result1.results.length, result2.results.length, 'should find same number of stops');

    // Sort both by stopId for comparison
    const sorted1 = [...result1.results].sort((a, b) => a.stopId.localeCompare(b.stopId));
    const sorted2 = [...result2.results].sort((a, b) => a.stopId.localeCompare(b.stopId));

    // Compare first 10 stops in detail
    for (let i = 0; i < Math.min(10, sorted1.length); i++) {
        assert.equal(sorted1[i].stopId, sorted2[i].stopId, `stop ${i} ID should match`);
        assert.equal(sorted1[i].totalTime, sorted2[i].totalTime, `stop ${i} total time should match`);
        assert.equal(sorted1[i].maxTime, sorted2[i].maxTime, `stop ${i} max time should match`);
    }

    console.log('Determinism verified: both runs produced identical results');
});
