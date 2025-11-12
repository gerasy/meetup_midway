# N-person meeting search with PROGRESS DEBUGGING.
# Adds:
# - Startup debug: station resolution, start platform chosen, t0
# - Live progress: prints every 10 minutes of *accumulated time frontier* reached (e.g., 10m, 20m, ...),
#   including the currently popped action summary and how many unique platforms have been touched per person.
# - Final summary unchanged (meeting platform, time, fairness, per-person steps).
#
# You can adjust GTFS path by changing GTFS = Path("...") below.

import pandas as pd
from pathlib import Path
from collections import defaultdict
import heapq, math, re

# ======= CONFIG =======
GTFS = Path("/mnt/data")  # <-- change this to your GTFS folder
WALK_SPEED_MPS = 1.3
MAX_WALK_TIME_S = 10 * 60
MAX_TRIP_TIME_S = 2 * 60 * 60  # safety cap
START_TIME_STR = "13:00:00"
people_inputs = [
    ("A", "Alexanderplatz"),
    ("B", "U Spittelmarkt"),
    ("C", "Museumsinsel"),
]
PROGRESS_STEP_S = 10 * 60  # print progress every 10 minutes frontier time
# ======================

def to_seconds(hms: str):
    if pd.isna(hms): return None
    m = re.match(r"^(\d+):(\d{2}):(\d{2})$", str(hms).strip())
    if not m: return None
    h, m1, s = map(int, m.groups())
    return h*3600 + m1*60 + s

def sec2hm(sec: int):
    h = sec//3600
    m = (sec%3600)//60
    return f"{h:02d}:{m:02d}"

def haversine_m(lat1, lon1, lat2, lon2):
    R = 6371000.0
    phi1 = math.radians(lat1); phi2 = math.radians(lat2)
    dphi = math.radians(lat2-lat1)
    dlambda = math.radians(lon2-lon1)
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlambda/2)**2
    return 2*R*math.asin(math.sqrt(a))

def route_type_name(rt):
    return {0:"Tram/Streetcar",2:"Rail",3:"Bus",100:"Rail",400:"Subway/Metro",700:"Bus",900:"Tram"}.get(int(rt) if pd.notna(rt) else -1, f"Type{rt}")

# ---- Load GTFS ----
print(f"[DEBUG] Loading GTFS from: {GTFS}")
stops = pd.read_csv(GTFS/"stops.txt")
stop_times = pd.read_csv(GTFS/"stop_times.txt")
trips = pd.read_csv(GTFS/"trips.txt")
routes = pd.read_csv(GTFS/"routes.txt")
pathways = pd.read_csv(GTFS/"pathways.txt") if (GTFS/"pathways.txt").exists() else pd.DataFrame()
transfers = pd.read_csv(GTFS/"transfers.txt") if (GTFS/"transfers.txt").exists() else pd.DataFrame()

# ---- Maps ----
stations_df = stops.copy()
stations_df["station_id"] = stations_df["parent_station"].fillna("")
mask = stations_df["station_id"]==""
stations_df.loc[mask, "station_id"] = stations_df.loc[mask, "stop_id"]

def best_name(g):
    cands = pd.concat([g["stop_desc"], g["stop_name"]], axis=0).dropna().astype(str).str.strip()
    return cands.value_counts().index[0] if not cands.empty else g["stop_id"].iloc[0]

agg = stations_df.groupby("station_id").apply(
    lambda g: pd.Series({"station_name": best_name(g)})
).reset_index()

station_to_platforms = stations_df.groupby("station_id")["stop_id"].apply(list).to_dict()
stopid_to_stationid = dict(zip(stations_df["stop_id"], stations_df["station_id"]))
stationid_to_name = dict(zip(agg["station_id"], agg["station_name"]))
stopid_to_name = dict(zip(stops["stop_id"], stops["stop_name"].fillna("")))
stopid_to_desc = dict(zip(stops["stop_id"], stops["stop_desc"].fillna("")))
stop_lat = dict(zip(stops["stop_id"], stops["stop_lat"]))
stop_lon = dict(zip(stops["stop_id"], stops["stop_lon"]))

stop_times["dep_sec"] = stop_times["departure_time"].apply(to_seconds)
stop_times["arr_sec"] = stop_times["arrival_time"].apply(to_seconds)
stop_times.sort_values(["trip_id","stop_sequence"], inplace=True)

by_stop = stop_times.sort_values(["stop_id","dep_sec"]).groupby("stop_id")
rows_at_stop = {sid: grp.reset_index(drop=True) for sid, grp in by_stop}
trip_groups = stop_times.groupby("trip_id")

trip_info = trips.set_index("trip_id")[["route_id","trip_headsign","direction_id","shape_id"]]
route_info = routes.set_index("route_id")[["route_short_name","route_long_name","route_type","agency_id"]]

# ---- Walk edges ----
from collections import defaultdict
walk_edges = defaultdict(list)
provided_pairs = set()

if not pathways.empty and "traversal_time" in pathways.columns:
    for _, r in pathways.iterrows():
        fr, to = r.get("from_stop_id"), r.get("to_stop_id")
        ttime = int(r.get("traversal_time")) if pd.notna(r.get("traversal_time")) else None
        if fr and to and ttime is not None:
            ttime = max(30, ttime)
            walk_edges[fr].append((to, ttime, "PATHWAYS"))
            provided_pairs.add((fr, to))

if not transfers.empty:
    for _, r in transfers.iterrows():
        fr, to = r.get("from_stop_id"), r.get("to_stop_id")
        mtt = r.get("min_transfer_time")
        ttime = int(mtt) if pd.notna(mtt) else None
        if fr and to and ttime is not None:
            ttime = max(30, ttime)
            walk_edges[fr].append((to, ttime, "TRANSFERS"))
            provided_pairs.add((fr, to))

# ---- Spatial index ----
DLAT = 0.004
DLON = 0.007
grid = defaultdict(list)
def cell_for(lat, lon):
    return (int(math.floor(lat / DLAT)), int(math.floor(lon / DLON)))

for sid, lat in stop_lat.items():
    lon = stop_lon[sid]
    grid[cell_for(lat, lon)].append(sid)

def nearby_stops_within_radius(stop_id, radius_m):
    lat0 = stop_lat[stop_id]; lon0 = stop_lon[stop_id]
    c0 = cell_for(lat0, lon0)
    m_per_deg_lat = 111320.0
    m_per_deg_lon = 111320.0 * math.cos(math.radians(lat0))
    nlat = int(math.ceil((radius_m / m_per_deg_lat) / DLAT)) + 1
    nlon = int(math.ceil((radius_m / m_per_deg_lon) / DLON)) + 1
    seen = set()
    for di in range(-nlat, nlat+1):
        for dj in range(-nlon, nlon+1):
            cell = (c0[0]+di, c0[1]+dj)
            for cand in grid.get(cell, []):
                if cand in seen or cand == stop_id:
                    continue
                seen.add(cand)
                d = haversine_m(lat0, lon0, stop_lat[cand], stop_lon[cand])
                yield cand, d

# ---- Search machinery ----
T0 = to_seconds(START_TIME_STR)
MAX_WALK_RADIUS_M = WALK_SPEED_MPS * MAX_WALK_TIME_S

counter = 0
def heappush_entry(pq, priority_tuple, payload_dict):
    global counter
    counter += 1
    heapq.heappush(pq, (*priority_tuple, counter, payload_dict))

def enqueue_pathway_transfer_walks(pq, cur_stop, cur_time, accum_time, owner):
    for to_stop, ttime, src in walk_edges.get(cur_stop, []):
        heappush_entry(
            pq, (accum_time + ttime, cur_time + ttime, to_stop),
            {"owner": owner, "mode": "WALK", "source": src, "from_stop": cur_stop, "to_stop": to_stop,
             "walk_sec": int(ttime), "depart_sec": int(cur_time), "arrive_sec": int(cur_time + ttime)}
        )

def enqueue_geo_walks(pq, cur_stop, cur_time, accum_time, owner):
    for cand, dist_m in nearby_stops_within_radius(cur_stop, MAX_WALK_RADIUS_M):
        if dist_m > MAX_WALK_RADIUS_M: continue
        if (cur_stop, cand) in provided_pairs: continue
        ttime = int(math.ceil(dist_m / WALK_SPEED_MPS))
        ttime = max(30, ttime)
        if ttime <= MAX_WALK_TIME_S:
            heappush_entry(
                pq, (accum_time + ttime, cur_time + ttime, cand),
                {"owner": owner, "mode": "WALK", "source": "GEO", "from_stop": cur_stop, "to_stop": cand,
                 "walk_sec": ttime, "depart_sec": int(cur_time), "arrive_sec": int(cur_time + ttime),
                 "distance_m": int(round(dist_m))}
            )

def enqueue_rides(pq, cur_stop, cur_time, accum_time, owner):
    grp = rows_at_stop.get(cur_stop)
    if grp is None or grp.empty: return
    g = grp[grp["dep_sec"] >= cur_time]
    if g.empty: return
    for _, dep_row in g.iterrows():
        trip_id = dep_row["trip_id"]
        dep_time = int(dep_row["dep_sec"])
        wait = dep_time - cur_time
        after = trip_groups.get_group(trip_id)
        after = after[after["stop_sequence"] > dep_row["stop_sequence"]]
        for _, r2 in after.iterrows():
            arr_time = int(r2["arr_sec"]) if pd.notna(r2["arr_sec"]) else None
            if arr_time is None: 
                continue
            ride = arr_time - dep_time
            total = wait + ride
            heappush_entry(
                pq, (accum_time + total, arr_time, r2["stop_id"]),
                {"owner": owner, "mode": "RIDE", "from_stop": cur_stop, "to_stop": r2["stop_id"],
                 "trip_id": trip_id,
                 "route_id": trip_info.loc[trip_id, "route_id"] if trip_id in trip_info.index else None,
                 "headsign": trip_info.loc[trip_id, "trip_headsign"] if trip_id in trip_info.index else "",
                 "wait_sec": int(wait), "ride_sec": int(ride),
                 "depart_sec": dep_time, "arrive_sec": arr_time}
            )

def fmt_stop_label(stop_id):
    station_id = stopid_to_stationid.get(stop_id, stop_id)
    station_name = stationid_to_name.get(station_id, station_id)
    platform_name = stopid_to_desc.get(stop_id) or stopid_to_name.get(stop_id) or stop_id
    return f"{platform_name} [{stop_id}] • {station_name} [{station_id}]"

def describe_action(info):
    if info["mode"] == "WALK":
        extra = f" (≈{info['distance_m']} m)" if info.get("source") == "GEO" and "distance_m" in info else ""
        src = info.get("source","")
        return f"WALK{f'({src})' if src else ''} {sec2hm(info['depart_sec'])} {fmt_stop_label(info['from_stop'])} → {fmt_stop_label(info['to_stop'])} in {info['walk_sec']//60}m{extra}"
    elif info["mode"] == "START":
        return f"START at {sec2hm(info['depart_sec'])} on {fmt_stop_label(info['to_stop'])}"
    else:
        rid = info.get("route_id")
        rshort = route_info.loc[rid, "route_short_name"] if rid in route_info.index else None
        rtype = route_info.loc[rid, "route_type"] if rid in route_info.index else None
        return f"RIDE {sec2hm(info['depart_sec'])} {fmt_stop_label(info['from_stop'])} → {fmt_stop_label(info['to_stop'])} • wait {info['wait_sec']//60}m ride {info['ride_sec']//60}m on {route_type_name(rtype)} {rshort or '(route?)'}"

def resolve_station(q):
    m = agg[agg["station_name"].str.contains(re.escape(q), case=False, na=False)]
    if m.empty: raise ValueError(f"No station matches '{q}'")
    row = m.sort_values("station_name").iloc[0]
    return row["station_id"], row["station_name"]

def pick_start_platform(station_id, t0):
    platforms = station_to_platforms.get(station_id, [])
    best_sid = None; best_dep = None
    for sid in platforms:
        grp = rows_at_stop.get(sid)
        if grp is None or grp.empty: continue
        g = grp[grp["dep_sec"].notna() & (grp["dep_sec"] >= t0)]
        if g.empty: continue
        cand_dep = int(g["dep_sec"].min())
        if best_dep is None or cand_dep < best_dep:
            best_dep = cand_dep
            best_sid = g.loc[g["dep_sec"].idxmin(), "stop_id"]
    if best_sid is None:
        best_sid = platforms[0] if platforms else None
    return best_sid

# ---- Initialize persons ----
T0 = to_seconds(START_TIME_STR)
persons = []
print(f"[DEBUG] Start time: {START_TIME_STR} ({T0}s)")
for label, query in people_inputs:
    stid, sname = resolve_station(query)
    start_stop = pick_start_platform(stid, T0)
    print(f"[DEBUG] Person {label}: query='{query}' -> station='{sname}' [{stid}] | start_stop_id={start_stop}")
    P = {
        "label": label,
        "station_id": stid, "station_name": sname,
        "start_stop_id": start_stop, "t0": T0,
        "pq": [],
        "visited_stops": set(),
        "reached_stop_first": {},  # stop_id -> (arr_abs, elapsed)
        "parent": {},
    }
    # seed
    heappush_entry(P["pq"], (0, P["t0"], P["start_stop_id"]), {"owner": label, "mode":"START", "from_stop": None, "to_stop": P["start_stop_id"], "depart_sec": P["t0"], "arrive_sec": P["t0"]})
    enqueue_pathway_transfer_walks(P["pq"], P["start_stop_id"], P["t0"], 0, label)
    enqueue_geo_walks(P["pq"], P["start_stop_id"], P["t0"], 0, label)
    enqueue_rides(P["pq"], P["start_stop_id"], P["t0"], 0, label)
    print(f"[DEBUG]   initial frontier size={len(P['pq'])}")
    persons.append(P)

# ---- Global pop helper ----
counter2 = 0
def pop_global(persons):
    candidates = []
    for S in persons:
        if S["pq"]:
            candidates.append((S["pq"][0], S))
    if not candidates:
        return None, None, None, None
    (accum, arr_time, dest_stop, _, info), S = min(candidates, key=lambda x: x[0])
    if accum > MAX_TRIP_TIME_S:
        return "CAP", S, None, None
    _, _, _, _, info = heapq.heappop(S["pq"])
    return accum, S, info["to_stop"], info

# ---- Search loop with progress logs ----
meeting = None
next_progress_mark = PROGRESS_STEP_S
print(f"[DEBUG] Entering search loop… progress step = {PROGRESS_STEP_S//60} min")
while True:
    popped = pop_global(persons)
    if popped[0] is None:
        print("[DEBUG] All queues empty — no meeting found.")
        break
    if popped[0] == "CAP":
        meeting = ("CAP", popped[1])
        print(f"[DEBUG] Time cap hit by Person {meeting[1]['label']} (> {MAX_TRIP_TIME_S//60} min).")
        break

    accum, S, dest_stop, info = popped

    # periodic progress
    if accum >= next_progress_mark:
        touched = ", ".join([f"{P['label']}:{len(P['reached_stop_first'])} stops" for P in persons])
        print(f"[PROGRESS] frontier elapsed ≥ {next_progress_mark//60}m | popped: {S['label']} {describe_action(info)} | reached: {touched}")
        next_progress_mark += PROGRESS_STEP_S

    if dest_stop in S["visited_stops"]:
        continue
    S["visited_stops"].add(dest_stop)

    if info["mode"] != "START":
        S["parent"][dest_stop] = (info["from_stop"], info)

    if dest_stop not in S["reached_stop_first"]:
        S["reached_stop_first"][dest_stop] = (info["arrive_sec"], accum)

    # check if everyone reached this stop at least once
    if all(dest_stop in P["reached_stop_first"] for P in persons):
        meeting = ("OK", dest_stop)
        print(f"[DEBUG] Found common platform: {dest_stop}")
        break

    cur_time = info["arrive_sec"]
    enqueue_pathway_transfer_walks(S["pq"], dest_stop, cur_time, accum, info["owner"])
    enqueue_geo_walks(S["pq"], dest_stop, cur_time, accum, info["owner"])
    enqueue_rides(S["pq"], dest_stop, cur_time, accum, info["owner"])

def reconstruct(S, stop_id):
    path = []
    cur = stop_id
    while cur in S["parent"]:
        prev, info = S["parent"][cur]
        path.append(info)
        cur = prev
    path.reverse()
    return path

def pretty_steps(S, path, total_elapsed, arrival_abs):
    out = []
    out.append(f"Person {S['label']} start {sec2hm(S['t0'])} at {fmt_stop_label(S['start_stop_id'])}")
    for step in path:
        out.append(" - " + describe_action(step))
    out.append(f"Arrival for {S['label']}: {sec2hm(arrival_abs)} (elapsed {total_elapsed//60} min)")
    return "\n".join(out)

# ---- Final report ----
if meeting and meeting[0] == "OK":
    stop_id = meeting[1]
    print(f"\n✅ Meeting platform for ALL: {fmt_stop_label(stop_id)} (start time {START_TIME_STR})")
    arrivals = []
    for S in persons:
        arr_abs, elapsed = S["reached_stop_first"][stop_id]
        arrivals.append((S["label"], elapsed, arr_abs))
    meet_time = max(t for _, _, t in arrivals)
    fairness_line = ", ".join([f"{lbl}: {el//60} min" for lbl, el, _ in arrivals])
    max_elapsed = max(el for _, el, _ in arrivals)
    spread = max_elapsed - min(el for _, el, _ in arrivals)
    print(f"Meeting time (allowing waiting): {sec2hm(meet_time)}")
    print(f"Fairness — {fairness_line} | max elapsed: {max_elapsed//60} min | diff: {spread//60} min\n")
    for S in persons:
        arr_abs, elapsed = S["reached_stop_first"][stop_id]
        path = reconstruct(S, stop_id)
        print(pretty_steps(S, path, elapsed, arr_abs))
        print()
elif meeting and meeting[0] == "CAP":
    who = meeting[1]
    print(f"\n⚠️ Stopped: Person {who['label']} exceeded the {MAX_TRIP_TIME_S//60} min cap (likely missing links).")
else:
    print("\nNo meeting found before queues were exhausted.")
