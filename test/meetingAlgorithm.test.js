import test from 'node:test';
import assert from 'node:assert/strict';

import { runMeetingSearch } from '../src/search.js';
import { gtfsData, appState } from '../src/state.js';
import { toSeconds } from '../src/parsing.js';

function seedGTFS(dataset) {
    gtfsData.stops = dataset.stops.map(row => ({ ...row }));
    gtfsData.stopTimes = dataset.stopTimes.map(row => ({ ...row }));
    gtfsData.trips = dataset.trips.map(row => ({ ...row }));
    gtfsData.routes = dataset.routes.map(row => ({ ...row }));
    gtfsData.pathways = dataset.pathways.map(row => ({ ...row }));
    gtfsData.transfers = dataset.transfers.map(row => ({ ...row }));

    appState.isDataProcessed = false;
    appState.stationLookupList = [];
    appState.stationSearchInitialized = false;
}

const simpleDataset = {
    stops: [
        { stop_id: 'STOP_A', stop_name: 'Stop A', stop_lat: '0.0000', stop_lon: '0.0000' },
        { stop_id: 'STOP_B', stop_name: 'Stop B', stop_lat: '0.0000', stop_lon: '0.1000' },
        { stop_id: 'STOP_M', stop_name: 'Stop M', stop_lat: '0.1000', stop_lon: '0.0500' }
    ],
    stopTimes: [
        { trip_id: 'T_AB', arrival_time: '10:00:00', departure_time: '10:00:00', stop_id: 'STOP_A', stop_sequence: '1' },
        { trip_id: 'T_AB', arrival_time: '10:06:00', departure_time: '10:06:00', stop_id: 'STOP_M', stop_sequence: '2' },
        { trip_id: 'T_BA', arrival_time: '10:00:00', departure_time: '10:00:00', stop_id: 'STOP_B', stop_sequence: '1' },
        { trip_id: 'T_BA', arrival_time: '10:06:00', departure_time: '10:06:00', stop_id: 'STOP_M', stop_sequence: '2' }
    ],
    trips: [
        { route_id: 'R1', service_id: 'WEEK', trip_id: 'T_AB', trip_headsign: 'A to M' },
        { route_id: 'R2', service_id: 'WEEK', trip_id: 'T_BA', trip_headsign: 'B to M' }
    ],
    routes: [
        { route_id: 'R1', agency_id: 'AG', route_short_name: 'R1', route_type: '1' },
        { route_id: 'R2', agency_id: 'AG', route_short_name: 'R2', route_type: '1' }
    ],
    pathways: [],
    transfers: []
};

const branchingDataset = {
    stops: [
        { stop_id: 'STOP_A', stop_name: 'Stop A', stop_lat: '0.0000', stop_lon: '0.0000' },
        { stop_id: 'STOP_B', stop_name: 'Stop B', stop_lat: '0.0000', stop_lon: '0.2000' },
        { stop_id: 'STOP_M', stop_name: 'Stop M', stop_lat: '0.0500', stop_lon: '0.3000' },
        { stop_id: 'STOP_X', stop_name: 'Stop X', stop_lat: '0.0000', stop_lon: '0.1000' }
    ],
    stopTimes: [
        { trip_id: 'T_AX', arrival_time: '10:00:00', departure_time: '10:00:00', stop_id: 'STOP_A', stop_sequence: '1' },
        { trip_id: 'T_AX', arrival_time: '10:03:00', departure_time: '10:03:00', stop_id: 'STOP_X', stop_sequence: '2' },
        { trip_id: 'T_AX', arrival_time: '10:08:00', departure_time: '10:08:00', stop_id: 'STOP_M', stop_sequence: '3' },
        { trip_id: 'T_BX', arrival_time: '10:00:00', departure_time: '10:00:00', stop_id: 'STOP_B', stop_sequence: '1' },
        { trip_id: 'T_BX', arrival_time: '10:04:00', departure_time: '10:04:00', stop_id: 'STOP_X', stop_sequence: '2' },
        { trip_id: 'T_BX', arrival_time: '10:09:00', departure_time: '10:09:00', stop_id: 'STOP_M', stop_sequence: '3' }
    ],
    trips: [
        { route_id: 'R1', service_id: 'WEEK', trip_id: 'T_AX', trip_headsign: 'A to M via X' },
        { route_id: 'R2', service_id: 'WEEK', trip_id: 'T_BX', trip_headsign: 'B to M via X' }
    ],
    routes: [
        { route_id: 'R1', agency_id: 'AG', route_short_name: 'R1', route_type: '1' },
        { route_id: 'R2', agency_id: 'AG', route_short_name: 'R2', route_type: '1' }
    ],
    pathways: [],
    transfers: []
};

test('finds a straightforward meeting stop for two riders', () => {
    seedGTFS(simpleDataset);

    const { meeting, persons } = runMeetingSearch({
        participants: [
            { label: 'A', query: 'Stop A' },
            { label: 'B', query: 'Stop B' }
        ],
        startTimeSec: toSeconds('10:00:00')
    });

    assert.equal(meeting?.type, 'OK');
    assert.equal(meeting.stopId, 'STOP_M');

    const elapsed = persons.map(p => p.reachedStopFirst.get('STOP_M').elapsed);
    assert.deepEqual(elapsed, [360, 360]);
});

test('chooses the meeting stop with the least total travel time', () => {
    seedGTFS(branchingDataset);

    const { meeting, persons } = runMeetingSearch({
        participants: [
            { label: 'A', query: 'Stop A' },
            { label: 'B', query: 'Stop B' }
        ],
        startTimeSec: toSeconds('10:00:00')
    });

    assert.equal(meeting?.type, 'OK');
    assert.equal(meeting.stopId, 'STOP_X');

    const elapsedAtX = persons.map(p => p.reachedStopFirst.get('STOP_X').elapsed);
    assert.deepEqual(elapsedAtX, [180, 240]);
});
