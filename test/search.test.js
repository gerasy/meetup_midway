import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { validatePeopleInputs, runMeetingSearch, runDeterministicRouteSelfCheck } from '../src/search.js';
import { MAX_PARTICIPANTS } from '../src/constants.js';
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

function loadPotsdamerFixture() {
    resetTestState();

    gtfsData.stops = [
        { stop_id: 'potsdamer', stop_name: 'S+U Potsdamer Platz Bhf (Berlin)', stop_lat: '52.509', stop_lon: '13.377', location_type: 0 },
        { stop_id: 'suedkreuz', stop_name: 'S Südkreuz Bhf (Berlin)', stop_lat: '52.475', stop_lon: '13.365', location_type: 0 },
        { stop_id: 'spittelmarkt', stop_name: 'U Spittelmarkt (Berlin)', stop_lat: '52.511', stop_lon: '13.405', location_type: 0 },
        { stop_id: 'buelowstr', stop_name: 'U Bülowstr. (Berlin)', stop_lat: '52.500', stop_lon: '13.355', location_type: 0 }
    ];

    gtfsData.routes = [
        { route_id: 'S25', route_short_name: 'S25', route_long_name: 'S25 Line', route_type: 2 },
        { route_id: 'U2', route_short_name: 'U2', route_long_name: 'U2 Line', route_type: 1 }
    ];

    gtfsData.trips = [
        { trip_id: 'S25_trip', route_id: 'S25', service_id: 'WK', trip_headsign: 'S Hennigsdorf Bhf' },
        { trip_id: 'U2_east', route_id: 'U2', service_id: 'WK', trip_headsign: 'U Theodor-Heuss-Platz (Berlin)' },
        { trip_id: 'U2_west', route_id: 'U2', service_id: 'WK', trip_headsign: 'S+U Pankow (Berlin)' }
    ];

    gtfsData.stopTimes = [
        { trip_id: 'S25_trip', arrival_time: '10:01:00', departure_time: '10:01:00', stop_id: 'suedkreuz', stop_sequence: '1' },
        { trip_id: 'S25_trip', arrival_time: '10:07:00', departure_time: '10:07:00', stop_id: 'potsdamer', stop_sequence: '2' },

        { trip_id: 'U2_east', arrival_time: '10:00:00', departure_time: '10:00:00', stop_id: 'spittelmarkt', stop_sequence: '1' },
        { trip_id: 'U2_east', arrival_time: '10:06:00', departure_time: '10:06:00', stop_id: 'potsdamer', stop_sequence: '2' },

        { trip_id: 'U2_west', arrival_time: '10:03:00', departure_time: '10:03:00', stop_id: 'buelowstr', stop_sequence: '1' },
        { trip_id: 'U2_west', arrival_time: '10:08:00', departure_time: '10:08:00', stop_id: 'potsdamer', stop_sequence: '2' }
    ];

    gtfsData.pathways = [];
    gtfsData.transfers = [];
}

function loadLinearLineFixture() {
    resetTestState();

    const stops = [];
    const stopTimes = [];
    const numStops = 6;
    for (let i = 0; i < numStops; i++) {
        stops.push({
            stop_id: `line_stop_${i}`,
            stop_name: `Line Stop ${i}`,
            stop_lat: String(52.5 + i * 0.001),
            stop_lon: String(13.3 + i * 0.001),
            location_type: 0
        });
        const minutesOffset = i * 2;
        const hh = String(10 + Math.floor(minutesOffset / 60)).padStart(2, '0');
        const mm = String((minutesOffset % 60)).padStart(2, '0');
        const time = `${hh}:${mm}:00`;
        stopTimes.push({
            trip_id: 'line_trip_forward',
            arrival_time: time,
            departure_time: time,
            stop_id: `line_stop_${i}`,
            stop_sequence: String(i + 1)
        });
    }

    gtfsData.stops = stops;
    gtfsData.routes = [
        { route_id: 'LINE', route_short_name: 'L', route_long_name: 'Line Route', route_type: 0 }
    ];
    gtfsData.trips = [
        { trip_id: 'line_trip_forward', route_id: 'LINE', service_id: 'WK', trip_headsign: 'To Terminus' }
    ];
    gtfsData.stopTimes = stopTimes;
    gtfsData.pathways = [];
    gtfsData.transfers = [];
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

function mulberry32(seed) {
    return function () {
        let t = seed += 0x6D2B79F5;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

test('validatePeopleInputs rejects when fewer than two participants are provided', async () => {
    const result = validatePeopleInputs([{ label: 'A', query: 'Alexanderplatz' }]);
    assert.equal(result.ok, false);
    assert.match(result.error, /at least two/i);
});

test('validatePeopleInputs rejects empty station queries', async () => {
    const result = validatePeopleInputs([
        { label: 'A', query: 'Alexanderplatz' },
        { label: 'B', query: '' }
    ]);
    assert.equal(result.ok, false);
    assert.match(result.error, /Person B/i);
});

test('validatePeopleInputs enforces maximum participants', async () => {
    const tooMany = Array.from({ length: MAX_PARTICIPANTS + 1 }, (_, idx) => ({
        label: String.fromCharCode(65 + idx),
        query: `Station ${idx}`
    }));

    const result = validatePeopleInputs(tooMany);
    assert.equal(result.ok, false);
    assert.match(result.error, /maximum/i);
});

test('validatePeopleInputs passes for valid inputs', async () => {
    const inputs = [
        { label: 'A', query: 'Alexanderplatz' },
        { label: 'B', query: 'U Spittelmarkt' },
        { label: 'C', query: 'Potsdamer Platz' }
    ];

    const result = validatePeopleInputs(inputs);
    assert.equal(result.ok, true);
    assert.deepEqual(result.people, inputs);
});

test('meeting persists when a participant already starts at the solution station', async () => {
    loadPotsdamerFixture();

    const startTimeSec = 10 * 3600;
    const baseParticipants = [
        { label: 'A', query: 'S Südkreuz Bhf (Berlin)' },
        { label: 'B', query: 'U Spittelmarkt (Berlin)' },
        { label: 'C', query: 'U Bülowstr. (Berlin)' }
    ];

    const firstRun = await runMeetingSearch({ participants: baseParticipants, startTimeSec });
    assert.ok(firstRun.meeting, 'expected meeting to be found for three participants');
    assert.equal(firstRun.meeting.type, 'OK');
    assert.equal(firstRun.meeting.stopId, 'potsdamer');

    const withFourth = [...baseParticipants, { label: 'D', query: 'S+U Potsdamer Platz Bhf (Berlin)' }];
    const secondRun = await runMeetingSearch({ participants: withFourth, startTimeSec });
    assert.ok(secondRun.meeting, 'expected meeting to still be found with fourth participant');
    assert.equal(secondRun.meeting.type, 'OK');
    assert.equal(secondRun.meeting.stopId, 'potsdamer');

    const firstTimes = firstRun.persons.map(p => p.reachedStopFirst.get('potsdamer').elapsed);
    const secondTimes = secondRun.persons.slice(0, 3).map(p => p.reachedStopFirst.get('potsdamer').elapsed);
    assert.deepEqual(secondTimes, firstTimes);
    const lastPerson = secondRun.persons[3];
    assert.equal(lastPerson.label, 'D');
    assert.equal(lastPerson.reachedStopFirst.get('potsdamer').elapsed, 0);
});

test('adding the solution station as a new participant maintains the meeting across random runs', async () => {
    loadLinearLineFixture();
    const rng = mulberry32(0xC0FFEE);
    const startTimeSec = 10 * 3600;
    const stopNames = gtfsData.stops.map(s => s.stop_name);

    for (let run = 0; run < 10; run++) {
        let idxA = Math.floor(rng() * stopNames.length);
        let idxB = Math.floor(rng() * stopNames.length);
        while (idxB === idxA) {
            idxB = Math.floor(rng() * stopNames.length);
        }

        const participants = [
            { label: 'A', query: stopNames[idxA] },
            { label: 'B', query: stopNames[idxB] }
        ];

        const baseline = await runMeetingSearch({ participants, startTimeSec });
        assert.ok(baseline.meeting, `expected meeting on baseline run ${run}`);
        assert.equal(baseline.meeting.type, 'OK');
        const meetingStop = baseline.meeting.stopId;
        const meetingName = gtfsData.stops.find(stop => stop.stop_id === meetingStop)?.stop_name;
        assert.ok(meetingName, 'meeting stop should map to a known station name');

        const extended = await runMeetingSearch({
            participants: [...participants, { label: 'C', query: meetingName }],
            startTimeSec
        });

        assert.ok(extended.meeting, `expected meeting with third participant on run ${run}`);
        assert.equal(extended.meeting.type, 'OK');
        assert.equal(extended.meeting.stopId, meetingStop);

        for (let i = 0; i < participants.length; i++) {
            const baseArrival = baseline.persons[i].reachedStopFirst.get(meetingStop).elapsed;
            const extendedArrival = extended.persons[i].reachedStopFirst.get(meetingStop).elapsed;
            assert.equal(extendedArrival, baseArrival, `participant ${participants[i].label} should keep same travel time on run ${run}`);
        }

        const newParticipantArrival = extended.persons[2].reachedStopFirst.get(meetingStop).elapsed;
        assert.equal(newParticipantArrival, 0, 'added participant should already be at the meeting stop');
    }
});

test('randomly selected triple participants on the GTFS subset always meet', async () => {
    loadRealGTFSSubset();
    const rng = mulberry32(0xBADA55);
    const startTimeSec = 10 * 3600;
    // Only use stations in Berlin to avoid selecting incompatible distant stations
    const stationNames = Array.from(new Set(gtfsData.stops.map(s => s.stop_name).filter(name => name.includes('Berlin'))));
    assert.ok(stationNames.length >= 3, 'expected at least three unique Berlin stations in GTFS subset');

    for (let iteration = 0; iteration < 1; iteration++) {
        const chosen = new Set();
        const participants = [];
        while (participants.length < 3) {
            const idx = Math.floor(rng() * stationNames.length);
            const name = stationNames[idx];
            if (chosen.has(name)) continue;
            chosen.add(name);
            participants.push({ label: String.fromCharCode(65 + participants.length), query: name });
        }

        const result = await runMeetingSearch({ participants, startTimeSec });
        assert.ok(result.meeting, `expected meeting for iteration ${iteration}`);
        assert.equal(result.meeting.type, 'OK');
        const meetingStop = result.meeting.stopId;
        for (const person of result.persons) {
            const reach = person.reachedStopFirst.get(meetingStop);
            assert.ok(reach, `participant ${person.label} should reach meeting stop on iteration ${iteration}`);
        }
    }
});

test('deterministic U2 self-check succeeds on the GTFS subset', async () => {
    loadRealGTFSSubset();
    const outcome = runDeterministicRouteSelfCheck();
    assert.equal(outcome.success, true, outcome.message);
    assert.equal(outcome.meetingStopId, 'de:11000:900100003::1');
    assert.ok(outcome.stats);
    assert.ok(outcome.stats.totalVisitedNodes > 0, 'self-check should visit nodes');
    assert.ok(outcome.stats.maxAccumulatedTime <= 120 * 60, 'self-check should stay within two hours');
});

test('finds meeting point for two participants starting from real Berlin addresses', async () => {
    loadRealGTFSSubset();

    const startTimeSec = 10 * 3600; // 10:00 AM

    // Use hardcoded coordinates for real Berlin addresses to avoid network calls
    // Seydlitzstr. 19, 10557 Berlin - near Hauptbahnhof area
    const address1 = {
        displayName: 'Seydlitzstr. 19, 10557 Berlin',
        lat: 52.5254,
        lon: 13.3692
    };
    console.log(`Using address 1: ${address1.displayName} at (${address1.lat}, ${address1.lon})`);

    // Martin-Luther-Str. 30, 10777 Berlin - near Schöneberg area
    const address2 = {
        displayName: 'Martin-Luther-Str. 30, 10777 Berlin',
        lat: 52.4956,
        lon: 13.3489
    };
    console.log(`Using address 2: ${address2.displayName} at (${address2.lat}, ${address2.lon})`);

    // Run meeting search with both addresses
    const participants = [
        {
            label: 'A',
            query: address1.displayName,
            isAddress: true,
            lat: address1.lat,
            lon: address1.lon
        },
        {
            label: 'B',
            query: address2.displayName,
            isAddress: true,
            lat: address2.lat,
            lon: address2.lon
        }
    ];

    const result = await runMeetingSearch({ participants, startTimeSec });

    // Verify meeting was found
    assert.ok(result.meeting, 'Should find a meeting point for two address-based participants');
    assert.equal(result.meeting.type, 'OK', 'Meeting should be of type OK');
    assert.ok(result.meeting.stopId, 'Meeting should have a stop ID');

    console.log(`Meeting point found: ${result.meeting.stopId}`);

    // Verify both participants can reach the meeting point
    assert.equal(result.persons.length, 2, 'Should have two participants');

    for (const person of result.persons) {
        const reach = person.reachedStopFirst.get(result.meeting.stopId);
        assert.ok(reach, `Participant ${person.label} should reach the meeting point`);
        assert.ok(reach.elapsed > 0, `Participant ${person.label} should have non-zero travel time from address`);

        console.log(`Participant ${person.label}: ${Math.floor(reach.elapsed / 60)} minutes travel time`);

        // Verify the person has address properties
        assert.equal(person.isAddress, true, `Participant ${person.label} should be marked as address-based`);
        assert.ok(person.addressLat, `Participant ${person.label} should have address latitude`);
        assert.ok(person.addressLon, `Participant ${person.label} should have address longitude`);
    }

    // Verify stats
    assert.ok(result.stats, 'Should have stats');
    assert.ok(result.stats.totalVisitedNodes > 0, 'Should visit some nodes');
    assert.ok(result.stats.maxAccumulatedTime <= 120 * 60, 'Should stay within two hours');
});
