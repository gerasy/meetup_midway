(function () {
  const GTFS_PATH = "gtfs_subset";
  const WALK_SPEED_MPS = 1.3;
  const MAX_WALK_TIME_S = 10 * 60;
  const MAX_TRIP_TIME_S = 2 * 60 * 60;
  const START_TIME_STR = "13:00:00";
  const PROGRESS_STEP_S = 10 * 60;
  const PEOPLE_INPUTS = [
    ["A", "Alexanderplatz"],
    ["B", "U Spittelmarkt"],
  ];

  const statusEl = document.getElementById("status");
  const logEl = document.getElementById("log");

  function log(message) {
    console.log(message);
    logEl.textContent += message + "\n";
  }

  function toSeconds(hms) {
    if (hms === undefined || hms === null) return null;
    const str = String(hms).trim();
    if (!str) return null;
    const m = str.match(/^(\d+):(\d{2}):(\d{2})$/);
    if (!m) return null;
    const h = Number(m[1]);
    const m1 = Number(m[2]);
    const s = Number(m[3]);
    if (Number.isNaN(h) || Number.isNaN(m1) || Number.isNaN(s)) return null;
    return h * 3600 + m1 * 60 + s;
  }

  function sec2hm(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  function haversineMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000.0;
    const phi1 = (lat1 * Math.PI) / 180;
    const phi2 = (lat2 * Math.PI) / 180;
    const dphi = ((lat2 - lat1) * Math.PI) / 180;
    const dlambda = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dphi / 2) ** 2 +
      Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlambda / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function routeTypeName(rt) {
    const mapping = {
      0: "Tram/Streetcar",
      2: "Rail",
      3: "Bus",
      100: "Rail",
      400: "Subway/Metro",
      700: "Bus",
      900: "Tram",
    };
    const key = rt !== undefined && rt !== null ? Number(rt) : NaN;
    if (!Number.isNaN(key) && key in mapping) return mapping[key];
    return `Type${rt}`;
  }

  function parseCsv(url) {
    return fetch(url)
      .then((resp) => {
        if (!resp.ok) {
          throw new Error(`Failed to fetch ${url}: ${resp.status}`);
        }
        return resp.text();
      })
      .then((text) => {
        const result = Papa.parse(text, {
          header: true,
          skipEmptyLines: true,
        });
        if (result.errors && result.errors.length) {
          console.warn(`Warnings while parsing ${url}:`, result.errors);
        }
        return result.data;
      });
  }

  class PriorityQueue {
    constructor() {
      this._data = [];
    }
    get length() {
      return this._data.length;
    }
    push(priority, payload) {
      this._data.push({ priority, payload });
      this._bubbleUp(this._data.length - 1);
    }
    peek() {
      return this._data[0] || null;
    }
    pop() {
      if (this._data.length === 0) return null;
      const top = this._data[0];
      const end = this._data.pop();
      if (this._data.length > 0 && end) {
        this._data[0] = end;
        this._sinkDown(0);
      }
      return top;
    }
    _bubbleUp(n) {
      const element = this._data[n];
      while (n > 0) {
        const parentN = Math.floor((n - 1) / 2);
        const parent = this._data[parentN];
        if (comparePriority(element.priority, parent.priority) >= 0) break;
        this._data[parentN] = element;
        this._data[n] = parent;
        n = parentN;
      }
    }
    _sinkDown(n) {
      const length = this._data.length;
      const element = this._data[n];
      while (true) {
        let leftN = 2 * n + 1;
        let rightN = leftN + 1;
        let swap = null;
        if (leftN < length) {
          const left = this._data[leftN];
          if (comparePriority(left.priority, element.priority) < 0) swap = leftN;
        }
        if (rightN < length) {
          const right = this._data[rightN];
          if (
            comparePriority(
              right.priority,
              swap === null ? element.priority : this._data[swap].priority
            ) < 0
          ) {
            swap = rightN;
          }
        }
        if (swap === null) break;
        this._data[n] = this._data[swap];
        this._data[swap] = element;
        n = swap;
      }
    }
  }

  function comparePriority(a, b) {
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i += 1) {
      if (a[i] < b[i]) return -1;
      if (a[i] > b[i]) return 1;
    }
    if (a.length < b.length) return -1;
    if (a.length > b.length) return 1;
    return 0;
  }

  let counter = 0;
  function heappushEntry(pq, priorityTuple, payload) {
    counter += 1;
    pq.push([...priorityTuple, counter], payload);
  }

  function cellFor(lat, lon, dlat, dlon) {
    return [Math.floor(lat / dlat), Math.floor(lon / dlon)];
  }

  function gridKey(i, j) {
    return `${i}|${j}`;
  }

  function fmtStopLabel(stopId, stopIdToStationId, stationIdToName, stopIdToDesc, stopIdToName) {
    const stationId = stopIdToStationId.get(stopId) || stopId;
    const stationName = stationIdToName.get(stationId) || stationId;
    const platformName = stopIdToDesc.get(stopId) || stopIdToName.get(stopId) || stopId;
    return `${platformName} [${stopId}] • ${stationName} [${stationId}]`;
  }

  function describeAction(info, helpers) {
    const { stopIdToStationId, stationIdToName, stopIdToDesc, stopIdToName, routeInfo } = helpers;
    if (info.mode === "WALK") {
      const extra = info.source === "GEO" && info.distance_m !== undefined ? ` (≈${info.distance_m} m)` : "";
      const src = info.source ? `(${info.source})` : "";
      return `WALK${src} ${sec2hm(info.depart_sec)} ${fmtStopLabel(
        info.from_stop,
        stopIdToStationId,
        stationIdToName,
        stopIdToDesc,
        stopIdToName
      )} → ${fmtStopLabel(
        info.to_stop,
        stopIdToStationId,
        stationIdToName,
        stopIdToDesc,
        stopIdToName
      )} in ${Math.round(info.walk_sec / 60)}m${extra}`;
    }
    if (info.mode === "START") {
      return `START at ${sec2hm(info.depart_sec)} on ${fmtStopLabel(
        info.to_stop,
        stopIdToStationId,
        stationIdToName,
        stopIdToDesc,
        stopIdToName
      )}`;
    }
    const rid = info.route_id;
    const route = rid ? routeInfo.get(rid) : undefined;
    const rshort = route ? route.route_short_name : null;
    const rtype = route ? route.route_type : null;
    return `RIDE ${sec2hm(info.depart_sec)} ${fmtStopLabel(
      info.from_stop,
      stopIdToStationId,
      stationIdToName,
      stopIdToDesc,
      stopIdToName
    )} → ${fmtStopLabel(
      info.to_stop,
      stopIdToStationId,
      stationIdToName,
      stopIdToDesc,
      stopIdToName
    )} • wait ${Math.round(info.wait_sec / 60)}m ride ${Math.round(info.ride_sec / 60)}m on ${routeTypeName(
      rtype
    )} ${rshort || "(route?)"}`;
  }

  function reconstruct(person, stopId) {
    const path = [];
    let current = stopId;
    while (person.parent.has(current)) {
      const entry = person.parent.get(current);
      path.push(entry.info);
      current = entry.prev;
    }
    path.reverse();
    return path;
  }

  function prettySteps(person, path, totalElapsed, arrivalAbs, helpers) {
    const { stopIdToStationId, stationIdToName, stopIdToDesc, stopIdToName, routeInfo } = helpers;
    const lines = [];
    lines.push(
      `Person ${person.label} start ${sec2hm(person.t0)} at ${fmtStopLabel(
        person.start_stop_id,
        stopIdToStationId,
        stationIdToName,
        stopIdToDesc,
        stopIdToName
      )}`
    );
    for (const step of path) {
      lines.push(" - " + describeAction(step, helpers));
    }
    lines.push(`Arrival for ${person.label}: ${sec2hm(arrivalAbs)} (elapsed ${Math.round(totalElapsed / 60)} min)`);
    return lines.join("\n");
  }

  async function main() {
    try {
      log(`[DEBUG] Loading GTFS from: ${GTFS_PATH}`);
      const [stops, stopTimesRaw, trips, routes, pathways, transfers] = await Promise.all([
        parseCsv(`${GTFS_PATH}/stops.txt`),
        parseCsv(`${GTFS_PATH}/stop_times.txt`),
        parseCsv(`${GTFS_PATH}/trips.txt`),
        parseCsv(`${GTFS_PATH}/routes.txt`),
        parseCsv(`${GTFS_PATH}/pathways.txt`).catch(() => []),
        parseCsv(`${GTFS_PATH}/transfers.txt`).catch(() => []),
      ]);

      const stopIdToStationId = new Map();
      const stationToPlatforms = new Map();
      const stationIdToName = new Map();
      const stopIdToName = new Map();
      const stopIdToDesc = new Map();
      const stopLat = new Map();
      const stopLon = new Map();
      const stationNameCandidates = new Map();

      for (const stop of stops) {
        const stopId = stop.stop_id;
        const parentStation = stop.parent_station && String(stop.parent_station).trim();
        const stationId = parentStation || stopId;
        stopIdToStationId.set(stopId, stationId);
        stopIdToName.set(stopId, stop.stop_name || "");
        stopIdToDesc.set(stopId, stop.stop_desc || "");
        stopLat.set(stopId, Number(stop.stop_lat));
        stopLon.set(stopId, Number(stop.stop_lon));
        if (!stationToPlatforms.has(stationId)) {
          stationToPlatforms.set(stationId, []);
        }
        stationToPlatforms.get(stationId).push(stopId);
        if (!stationNameCandidates.has(stationId)) {
          stationNameCandidates.set(stationId, []);
        }
        if (stop.stop_desc) stationNameCandidates.get(stationId).push(String(stop.stop_desc).trim());
        if (stop.stop_name) stationNameCandidates.get(stationId).push(String(stop.stop_name).trim());
      }

      for (const [stationId, names] of stationNameCandidates.entries()) {
        const counts = new Map();
        for (const name of names) {
          if (!name) continue;
          counts.set(name, (counts.get(name) || 0) + 1);
        }
        let bestName = names.length ? names[0] : stationId;
        let bestCount = bestName ? counts.get(bestName) || 0 : 0;
        for (const [name, count] of counts.entries()) {
          if (count > bestCount) {
            bestName = name;
            bestCount = count;
          } else if (count === bestCount && name < bestName) {
            bestName = name;
          }
        }
        stationIdToName.set(stationId, bestName || stationId);
      }

      const stopTimes = stopTimesRaw
        .map((row) => ({
          trip_id: row.trip_id,
          arrival_time: row.arrival_time,
          departure_time: row.departure_time,
          stop_id: row.stop_id,
          stop_sequence: Number(row.stop_sequence),
          arr_sec: toSeconds(row.arrival_time),
          dep_sec: toSeconds(row.departure_time),
        }))
        .filter((row) => row.trip_id && row.stop_id && !Number.isNaN(row.stop_sequence));

      stopTimes.sort((a, b) => {
        if (a.trip_id < b.trip_id) return -1;
        if (a.trip_id > b.trip_id) return 1;
        return a.stop_sequence - b.stop_sequence;
      });

      const rowsAtStop = new Map();
      const tripGroups = new Map();
      for (const row of stopTimes) {
        if (!rowsAtStop.has(row.stop_id)) rowsAtStop.set(row.stop_id, []);
        rowsAtStop.get(row.stop_id).push(row);
        if (!tripGroups.has(row.trip_id)) tripGroups.set(row.trip_id, []);
        tripGroups.get(row.trip_id).push(row);
      }

      for (const arr of rowsAtStop.values()) {
        arr.sort((a, b) => {
          const aDep = a.dep_sec ?? Number.POSITIVE_INFINITY;
          const bDep = b.dep_sec ?? Number.POSITIVE_INFINITY;
          return aDep - bDep;
        });
      }

      const tripInfo = new Map();
      for (const trip of trips) {
        tripInfo.set(trip.trip_id, {
          route_id: trip.route_id,
          trip_headsign: trip.trip_headsign || "",
          direction_id: trip.direction_id,
          shape_id: trip.shape_id,
        });
      }

      const routeInfo = new Map();
      for (const route of routes) {
        routeInfo.set(route.route_id, {
          route_short_name: route.route_short_name || "",
          route_long_name: route.route_long_name || "",
          route_type: route.route_type !== undefined && route.route_type !== null ? Number(route.route_type) : null,
          agency_id: route.agency_id,
        });
      }

      const walkEdges = new Map();
      const providedPairs = new Set();
      function pushWalkEdge(from, to, timeSec, source) {
        if (!walkEdges.has(from)) walkEdges.set(from, []);
        walkEdges.get(from).push({ to, timeSec, source });
      }

      if (Array.isArray(pathways) && pathways.length && pathways[0].from_stop_id !== undefined) {
        for (const row of pathways) {
          const from = row.from_stop_id;
          const to = row.to_stop_id;
          const traversalRaw = row.traversal_time;
          const traversal =
            traversalRaw !== undefined && traversalRaw !== null && String(traversalRaw).trim() !== ""
              ? Number(traversalRaw)
              : NaN;
          if (!from || !to || Number.isNaN(traversal)) continue;
          const ttime = Math.max(30, Math.round(traversal));
          pushWalkEdge(from, to, ttime, "PATHWAYS");
          providedPairs.add(`${from}|${to}`);
        }
      }

      if (Array.isArray(transfers) && transfers.length && transfers[0].from_stop_id !== undefined) {
        for (const row of transfers) {
          const from = row.from_stop_id;
          const to = row.to_stop_id;
          const traversalRaw = row.min_transfer_time;
          const traversal =
            traversalRaw !== undefined && traversalRaw !== null && String(traversalRaw).trim() !== ""
              ? Number(traversalRaw)
              : NaN;
          if (!from || !to || Number.isNaN(traversal)) continue;
          const ttime = Math.max(30, Math.round(traversal));
          pushWalkEdge(from, to, ttime, "TRANSFERS");
          providedPairs.add(`${from}|${to}`);
        }
      }

      const DLAT = 0.004;
      const DLON = 0.007;
      const grid = new Map();
      for (const [stopId, lat] of stopLat.entries()) {
        const lon = stopLon.get(stopId);
        if (Number.isNaN(lat) || Number.isNaN(lon)) continue;
        const cell = cellFor(lat, lon, DLAT, DLON);
        const key = gridKey(cell[0], cell[1]);
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(stopId);
      }

      function nearbyStopsWithinRadius(stopId, radiusM) {
        const lat0 = stopLat.get(stopId);
        const lon0 = stopLon.get(stopId);
        if (lat0 === undefined || lon0 === undefined) return [];
        const c0 = cellFor(lat0, lon0, DLAT, DLON);
        const mPerDegLat = 111320.0;
        const mPerDegLon = 111320.0 * Math.cos((lat0 * Math.PI) / 180);
        const nlat = Math.ceil((radiusM / mPerDegLat) / DLAT) + 1;
        const nlon = Math.ceil((radiusM / mPerDegLon) / DLON) + 1;
        const seen = new Set();
        const results = [];
        for (let di = -nlat; di <= nlat; di += 1) {
          for (let dj = -nlon; dj <= nlon; dj += 1) {
            const key = gridKey(c0[0] + di, c0[1] + dj);
            const bucket = grid.get(key);
            if (!bucket) continue;
            for (const cand of bucket) {
              if (cand === stopId || seen.has(cand)) continue;
              seen.add(cand);
              const lat = stopLat.get(cand);
              const lon = stopLon.get(cand);
              if (lat === undefined || lon === undefined) continue;
              const dist = haversineMeters(lat0, lon0, lat, lon);
              results.push([cand, dist]);
            }
          }
        }
        return results;
      }

      function enqueuePathwayTransferWalks(pq, curStop, curTime, accumTime, owner) {
        const edges = walkEdges.get(curStop);
        if (!edges) return;
        for (const edge of edges) {
          const arrival = curTime + edge.timeSec;
          heappushEntry(pq, [accumTime + edge.timeSec, arrival, edge.to], {
            owner,
            mode: "WALK",
            source: edge.source,
            from_stop: curStop,
            to_stop: edge.to,
            walk_sec: edge.timeSec,
            depart_sec: curTime,
            arrive_sec: arrival,
          });
        }
      }

      function enqueueGeoWalks(pq, curStop, curTime, accumTime, owner) {
        const candidates = nearbyStopsWithinRadius(curStop, WALK_SPEED_MPS * MAX_WALK_TIME_S);
        for (const [cand, dist] of candidates) {
          if (dist > WALK_SPEED_MPS * MAX_WALK_TIME_S) continue;
          if (providedPairs.has(`${curStop}|${cand}`)) continue;
          const ttime = Math.max(30, Math.ceil(dist / WALK_SPEED_MPS));
          if (ttime > MAX_WALK_TIME_S) continue;
          const arrival = curTime + ttime;
          heappushEntry(pq, [accumTime + ttime, arrival, cand], {
            owner,
            mode: "WALK",
            source: "GEO",
            from_stop: curStop,
            to_stop: cand,
            walk_sec: ttime,
            depart_sec: curTime,
            arrive_sec: arrival,
            distance_m: Math.round(dist),
          });
        }
      }

      function enqueueRides(pq, curStop, curTime, accumTime, owner) {
        const rows = rowsAtStop.get(curStop);
        if (!rows || !rows.length) return;
        for (const depRow of rows) {
          if (depRow.dep_sec === null || depRow.dep_sec === undefined) continue;
          if (depRow.dep_sec < curTime) continue;
          const tripId = depRow.trip_id;
          const depTime = depRow.dep_sec;
          const wait = depTime - curTime;
          const after = tripGroups.get(tripId);
          if (!after) continue;
          for (const row of after) {
            if (row.stop_sequence <= depRow.stop_sequence) continue;
            if (row.arr_sec === null || row.arr_sec === undefined) continue;
            const arrTime = row.arr_sec;
            const ride = arrTime - depTime;
            if (ride < 0) continue;
            heappushEntry(pq, [accumTime + wait + ride, arrTime, row.stop_id], {
              owner,
              mode: "RIDE",
              from_stop: curStop,
              to_stop: row.stop_id,
              trip_id: tripId,
              route_id: tripInfo.has(tripId) ? tripInfo.get(tripId).route_id : null,
              headsign: tripInfo.has(tripId) ? tripInfo.get(tripId).trip_headsign : "",
              wait_sec: wait,
              ride_sec: ride,
              depart_sec: depTime,
              arrive_sec: arrTime,
            });
          }
        }
      }

      const helpers = {
        stopIdToStationId,
        stationIdToName,
        stopIdToDesc,
        stopIdToName,
        routeInfo,
      };

      function resolveStation(query) {
        const q = query.trim().toLowerCase();
        const matches = [];
        for (const [stationId, stationName] of stationIdToName.entries()) {
          if (stationName && stationName.toLowerCase().includes(q)) {
            matches.push([stationId, stationName]);
          }
        }
        if (!matches.length) throw new Error(`No station matches '${query}'`);
        matches.sort((a, b) => a[1].localeCompare(b[1]));
        return matches[0];
      }

      function pickStartPlatform(stationId, t0) {
        const platforms = stationToPlatforms.get(stationId) || [];
        let bestSid = null;
        let bestDep = null;
        for (const sid of platforms) {
          const grp = rowsAtStop.get(sid);
          if (!grp || !grp.length) continue;
          for (const row of grp) {
            if (row.dep_sec === null || row.dep_sec === undefined) continue;
            if (row.dep_sec < t0) continue;
            if (bestDep === null || row.dep_sec < bestDep) {
              bestDep = row.dep_sec;
              bestSid = row.stop_id;
            }
            break;
          }
        }
        if (bestSid === null) {
          bestSid = platforms.length ? platforms[0] : null;
        }
        return bestSid;
      }

      const T0 = toSeconds(START_TIME_STR);
      log(`[DEBUG] Start time: ${START_TIME_STR} (${T0}s)`);

      const persons = [];
      for (const [label, query] of PEOPLE_INPUTS) {
        const [stationId, stationName] = resolveStation(query);
        const startStop = pickStartPlatform(stationId, T0);
        log(`[DEBUG] Person ${label}: query='${query}' -> station='${stationName}' [${stationId}] | start_stop_id=${startStop}`);
        const person = {
          label,
          station_id: stationId,
          station_name: stationName,
          start_stop_id: startStop,
          t0: T0,
          pq: new PriorityQueue(),
          visited_stops: new Set(),
          reached_stop_first: new Map(),
          parent: new Map(),
        };
        heappushEntry(person.pq, [0, person.t0, person.start_stop_id], {
          owner: label,
          mode: "START",
          from_stop: null,
          to_stop: person.start_stop_id,
          depart_sec: person.t0,
          arrive_sec: person.t0,
        });
        enqueuePathwayTransferWalks(person.pq, person.start_stop_id, person.t0, 0, label);
        enqueueGeoWalks(person.pq, person.start_stop_id, person.t0, 0, label);
        enqueueRides(person.pq, person.start_stop_id, person.t0, 0, label);
        log(`[DEBUG]   initial frontier size=${person.pq.length}`);
        persons.push(person);
      }

      let nextProgressMark = PROGRESS_STEP_S;
      log(`[DEBUG] Entering search loop… progress step = ${PROGRESS_STEP_S / 60} min`);
      let meeting = null;

      function popGlobal() {
        const candidates = [];
        for (const person of persons) {
          const peeked = person.pq.peek();
          if (peeked) {
            candidates.push({
              priority: peeked.priority,
              person,
            });
          }
        }
        if (!candidates.length) return { status: "EMPTY" };
        candidates.sort((a, b) => comparePriority(a.priority, b.priority));
        const chosen = candidates[0];
        const popped = chosen.person.pq.pop();
        if (!popped) return { status: "EMPTY" };
        const [accum, arrTime, destStop] = popped.priority;
        if (accum > MAX_TRIP_TIME_S) {
          return { status: "CAP", person: chosen.person };
        }
        return {
          status: "OK",
          accum,
          person: chosen.person,
          destStop,
          info: popped.payload,
        };
      }

      while (true) {
        const result = popGlobal();
        if (result.status === "EMPTY") {
          log("[DEBUG] All queues empty — no meeting found.");
          break;
        }
        if (result.status === "CAP") {
          meeting = { status: "CAP", person: result.person };
          log(
            `[DEBUG] Time cap hit by Person ${result.person.label} (> ${Math.round(MAX_TRIP_TIME_S / 60)} min).`
          );
          break;
        }

        const { accum, person, destStop, info } = result;
        if (accum >= nextProgressMark) {
          const touched = persons
            .map((p) => `${p.label}:${p.reached_stop_first.size} stops`)
            .join(", ");
          log(
            `[PROGRESS] frontier elapsed ≥ ${nextProgressMark / 60}m | popped: ${person.label} ${describeAction(
              info,
              helpers
            )} | reached: ${touched}`
          );
          nextProgressMark += PROGRESS_STEP_S;
        }

        if (person.visited_stops.has(destStop)) {
          continue;
        }
        person.visited_stops.add(destStop);

        if (info.mode !== "START") {
          person.parent.set(destStop, { prev: info.from_stop, info });
        }

        if (!person.reached_stop_first.has(destStop)) {
          person.reached_stop_first.set(destStop, { arrival_abs: info.arrive_sec, elapsed: accum });
        }

        const everyoneReached = persons.every((p) => p.reached_stop_first.has(destStop));
        if (everyoneReached) {
          meeting = { status: "OK", stopId: destStop };
          log(`[DEBUG] Found common platform: ${destStop}`);
          break;
        }

        const currentTime = info.arrive_sec;
        enqueuePathwayTransferWalks(person.pq, destStop, currentTime, accum, info.owner);
        enqueueGeoWalks(person.pq, destStop, currentTime, accum, info.owner);
        enqueueRides(person.pq, destStop, currentTime, accum, info.owner);
      }

      if (meeting && meeting.status === "OK") {
        const stopId = meeting.stopId;
        log(`\n✅ Meeting platform for ALL: ${fmtStopLabel(stopId, stopIdToStationId, stationIdToName, stopIdToDesc, stopIdToName)} (start time ${START_TIME_STR})`);
        const arrivals = [];
        for (const person of persons) {
          const rec = person.reached_stop_first.get(stopId);
          arrivals.push({ label: person.label, elapsed: rec.elapsed, arrival_abs: rec.arrival_abs });
        }
        const meetTime = Math.max(...arrivals.map((a) => a.arrival_abs));
        const fairnessLine = arrivals
          .map((a) => `${a.label}: ${Math.round(a.elapsed / 60)} min`)
          .join(", ");
        const maxElapsed = Math.max(...arrivals.map((a) => a.elapsed));
        const minElapsed = Math.min(...arrivals.map((a) => a.elapsed));
        log(`Meeting time (allowing waiting): ${sec2hm(meetTime)}`);
        log(`Fairness — ${fairnessLine} | max elapsed: ${Math.round(maxElapsed / 60)} min | diff: ${Math.round((maxElapsed - minElapsed) / 60)} min\n`);
        for (const person of persons) {
          const rec = person.reached_stop_first.get(stopId);
          const path = reconstruct(person, stopId);
          log(prettySteps(person, path, rec.elapsed, rec.arrival_abs, helpers));
          log("");
        }
        statusEl.textContent = "Simulation complete — see log for details.";
      } else if (meeting && meeting.status === "CAP") {
        statusEl.textContent = "Simulation stopped — time cap exceeded.";
        log(
          `\n⚠️ Stopped: Person ${meeting.person.label} exceeded the ${Math.round(
            MAX_TRIP_TIME_S / 60
          )} min cap (likely missing links).`
        );
      } else {
        statusEl.textContent = "Simulation ended without finding a meeting point.";
        log("\nNo meeting found before queues were exhausted.");
      }
    } catch (error) {
      console.error(error);
      statusEl.textContent = "Simulation failed — see console for details.";
      log(`[ERROR] ${error.message}`);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    main();
  });
})();
