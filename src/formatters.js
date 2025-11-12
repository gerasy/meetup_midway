import { parsedData } from './state.js';
import { sec2hm } from './parsing.js';

export function fmtStopLabel(stopId) {
    const stop = parsedData.stopById.get(stopId);
    const stationId = parsedData.stopIdToStationId.get(stopId) || stopId;
    const stationName = parsedData.stationToName.get(stationId) || stationId;
    const platformName = stop?.stop_desc || stop?.stop_name || stopId;
    return `${platformName} [${stopId}] • ${stationName} [${stationId}]`;
}

export function describeAction(info) {
    if (info.mode === 'WALK') {
        const extra = info.source === 'GEO' && info.distance_m ? ` (≈${info.distance_m} m)` : '';
        const src = info.source || '';
        return `WALK${src ? ` (${src})` : ''}: ${sec2hm(info.depart_sec)} ${fmtStopLabel(info.from_stop)} → ${fmtStopLabel(info.to_stop)} in ${Math.floor(info.walk_sec / 60)} min${extra}`;
    } else if (info.mode === 'START') {
        return `START at ${sec2hm(info.depart_sec)} from ${fmtStopLabel(info.to_stop)}`;
    }

    const routeInf = parsedData.routeInfo.get(info.route_id);
    const rshort = routeInf?.route_short_name || '?';
    return `RIDE: ${sec2hm(info.depart_sec)} ${fmtStopLabel(info.from_stop)} → ${fmtStopLabel(info.to_stop)} • wait ${Math.floor(info.wait_sec / 60)} min, ride ${Math.floor(info.ride_sec / 60)} min on ${rshort} '${info.headsign}'`;
}
