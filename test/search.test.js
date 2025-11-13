import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePeopleInputs, runMeetingSearch } from '../src/search.js';
import { MAX_PARTICIPANTS } from '../src/constants.js';
import { gtfsData, appState, resetParsedDataCollections } from '../src/state.js';

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

function mulberry32(seed) {
    return function () {
        let t = seed += 0x6D2B79F5;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

test('validatePeopleInputs rejects when fewer than two participants are provided', () => {
    const result = validatePeopleInputs([{ label: 'A', query: 'Alexanderplatz' }]);
    assert.equal(result.ok, false);
    assert.match(result.error, /at least two/i);
});

test('validatePeopleInputs rejects empty station queries', () => {
    const result = validatePeopleInputs([
        { label: 'A', query: 'Alexanderplatz' },
        { label: 'B', query: '' }
    ]);
    assert.equal(result.ok, false);
    assert.match(result.error, /Person B/i);
});

test('validatePeopleInputs enforces maximum participants', () => {
    const tooMany = Array.from({ length: MAX_PARTICIPANTS + 1 }, (_, idx) => ({
        label: String.fromCharCode(65 + idx),
        query: `Station ${idx}`
    }));

    const result = validatePeopleInputs(tooMany);
    assert.equal(result.ok, false);
    assert.match(result.error, /maximum/i);
});

test('validatePeopleInputs passes for valid inputs', () => {
    const inputs = [
        { label: 'A', query: 'Alexanderplatz' },
        { label: 'B', query: 'U Spittelmarkt' },
        { label: 'C', query: 'Potsdamer Platz' }
    ];

    const result = validatePeopleInputs(inputs);
    assert.equal(result.ok, true);
    assert.deepEqual(result.people, inputs);
});

test('meeting persists when a participant already starts at the solution station', () => {
    loadPotsdamerFixture();

    const startTimeSec = 10 * 3600;
    const baseParticipants = [
        { label: 'A', query: 'S Südkreuz Bhf (Berlin)' },
        { label: 'B', query: 'U Spittelmarkt (Berlin)' },
        { label: 'C', query: 'U Bülowstr. (Berlin)' }
    ];

    const firstRun = runMeetingSearch({ participants: baseParticipants, startTimeSec });
    assert.ok(firstRun.meeting, 'expected meeting to be found for three participants');
    assert.equal(firstRun.meeting.type, 'OK');
    assert.equal(firstRun.meeting.stopId, 'potsdamer');

    const withFourth = [...baseParticipants, { label: 'D', query: 'S+U Potsdamer Platz Bhf (Berlin)' }];
    const secondRun = runMeetingSearch({ participants: withFourth, startTimeSec });
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

test('adding the solution station as a new participant maintains the meeting across random runs', () => {
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

        const baseline = runMeetingSearch({ participants, startTimeSec });
        assert.ok(baseline.meeting, `expected meeting on baseline run ${run}`);
        assert.equal(baseline.meeting.type, 'OK');
        const meetingStop = baseline.meeting.stopId;
        const meetingName = gtfsData.stops.find(stop => stop.stop_id === meetingStop)?.stop_name;
        assert.ok(meetingName, 'meeting stop should map to a known station name');

        const extended = runMeetingSearch({
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
