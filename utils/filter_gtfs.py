#!/usr/bin/env python3
"""
filter_gtfs.py
Shrink a GTFS feed by spatial radius and (optionally) a single service date.

Usage:
  python filter_gtfs.py --in ~/Desktop/GTFS --out ./gtfs_subset \
    --center 52.5219 13.4132 --radius_km 3 --date 2025-11-12

Notes:
- Works with large files by chunking (stop_times, shapes, trips, pathways, transfers).
- Keeps referential integrity across files.
- If --date is omitted, only spatial filtering is applied.
"""
import argparse
import os
import sys
from datetime import datetime
from math import radians, sin, cos, asin, sqrt
import pandas as pd

# -------- utils --------
def haversine_km(lat1, lon1, lat2, lon2):
    # convert decimal degrees to radians
    lon1, lat1, lon2, lat2 = map(radians, [lon1, lat1, lon2, lat2])
    # haversine formula
    dlon = lon2 - lon1
    dlat = lat2 - lat1
    a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
    c = 2 * asin(sqrt(a))
    r = 6371  # km
    return c * r

def ensure_dir(path):
    os.makedirs(path, exist_ok=True)

def read_csv(path, **kwargs):
    # Robust defaults for GTFS CSVs with quotes and mixed types
    return pd.read_csv(path, dtype=str, keep_default_na=False, na_values=[], quoting=0, **kwargs)

def write_csv(df, path):
    # Always write with quotes around strings (GTFS is tolerant; keeping simple)
    # But to stay close to input, don't force quoting. Just write with index=False.
    df.to_csv(path, index=False)

def parse_args():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="indir", required=True, help="Input GTFS folder")
    ap.add_argument("--out", dest="outdir", required=True, help="Output GTFS folder")
    ap.add_argument("--center", nargs=2, type=float, metavar=("LAT", "LON"), required=True, help="Center lat lon")
    ap.add_argument("--radius_km", type=float, default=3.0, help="Radius in km (default 3)")
    ap.add_argument("--date", type=str, default=None, help="YYYY-MM-DD to keep (optional)")
    return ap.parse_args()

def yyyymmdd(datestr):
    # Input is YYYY-MM-DD; GTFS expects YYYYMMDD
    return datetime.strptime(datestr, "%Y-%m-%d").strftime("%Y%m%d")

# -------- core pipeline --------
def main():
    args = parse_args()
    indir = os.path.expanduser(args.indir)
    outdir = os.path.expanduser(args.outdir)
    ensure_dir(outdir)

    center_lat, center_lon = args.center
    radius_km = args.radius_km
    date_filter = yyyymmdd(args.date) if args.date else None

    # 1) Load stops and spatially filter
    stops_path = os.path.join(indir, "stops.txt")
    if not os.path.exists(stops_path):
        print("stops.txt missing", file=sys.stderr)
        sys.exit(1)

    stops = read_csv(stops_path)
    # Expect columns: stop_id, stop_lat, stop_lon
    for col in ["stop_id", "stop_lat", "stop_lon"]:
        if col not in stops.columns:
            print(f"Column {col} missing from stops.txt", file=sys.stderr)
            sys.exit(1)

    # Compute distance and apply radius
    stops["stop_lat_float"] = stops["stop_lat"].astype(float)
    stops["stop_lon_float"] = stops["stop_lon"].astype(float)
    stops["dist_km"] = stops.apply(
        lambda r: haversine_km(center_lat, center_lon, r["stop_lat_float"], r["stop_lon_float"]),
        axis=1
    )
    stops_in_area = stops[stops["dist_km"] <= radius_km].copy()
    kept_stop_ids = set(stops_in_area["stop_id"].tolist())

    if len(kept_stop_ids) == 0:
        print("No stops found in the specified radius. Try increasing --radius_km or adjusting --center.", file=sys.stderr)
        sys.exit(2)

    # 2) Filter calendar/calendar_dates by optional date
    kept_service_ids = None
    cal_dates_path = os.path.join(indir, "calendar_dates.txt")
    cal_path = os.path.join(indir, "calendar.txt")

    if date_filter and os.path.exists(cal_dates_path):
        cal_dates = read_csv(cal_dates_path)
        if "date" in cal_dates.columns and "service_id" in cal_dates.columns and "exception_type" in cal_dates.columns:
            cal_dates = cal_dates[ (cal_dates["date"] == date_filter) & (cal_dates["exception_type"] == "1") ]
            kept_service_ids = set(cal_dates["service_id"].tolist())
        else:
            kept_service_ids = set()

    # If no calendar_dates or empty, try calendar by weekday window
    if date_filter and (kept_service_ids is None or len(kept_service_ids) == 0) and os.path.exists(cal_path):
        cal = read_csv(cal_path)
        if all(c in cal.columns for c in ["service_id","monday","tuesday","wednesday","thursday","friday","saturday","sunday","start_date","end_date"]):
            dt = datetime.strptime(date_filter, "%Y%m%d")
            dow = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"][dt.weekday()]
            ymd = int(date_filter)
            cal_ok = cal[ (cal[dow] == "1") & (cal["start_date"].astype(int) <= ymd) & (cal["end_date"].astype(int) >= ymd) ]
            kept_service_ids = set(cal_ok["service_id"].tolist())
        else:
            kept_service_ids = set()

    # If no date filter, we'll accept all service_ids as we derive them from trips
    if kept_service_ids is None:
        kept_service_ids = set()

    # 3) stop_times -> keep by stop and (later) by trips/services
    st_path = os.path.join(indir, "stop_times.txt")
    if not os.path.exists(st_path):
        print("stop_times.txt missing", file=sys.stderr)
        sys.exit(1)

    # We'll do two-pass: first pass to collect trips that touch kept stops (and optionally match date via service after join)
    kept_trip_ids = set()
    kept_stop_times_chunks = []

    # We don't yet know which trips have the right service_id; so we temporarily keep by stop_id and filter later by trips after we know service_ids.
    chunk_iter = pd.read_csv(st_path, dtype=str, keep_default_na=False, na_values=[], quoting=0, chunksize=200000)
    for chunk in chunk_iter:
        # standardize required cols
        if not {"trip_id","stop_id"}.issubset(set(chunk.columns)):
            print("stop_times.txt missing required columns", file=sys.stderr)
            sys.exit(1)
        mask = chunk["stop_id"].isin(kept_stop_ids)
        sub = chunk[mask].copy()
        if len(sub):
            kept_trip_ids.update(sub["trip_id"].unique().tolist())
            kept_stop_times_chunks.append(sub)

    # 4) trips -> filter by trip_id (from area) AND optional service_ids (date)
    trips_path = os.path.join(indir, "trips.txt")
    if not os.path.exists(trips_path):
        print("trips.txt missing", file=sys.stderr)
        sys.exit(1)
    trips_iter = pd.read_csv(trips_path, dtype=str, keep_default_na=False, na_values=[], quoting=0, chunksize=200000)
    trips_kept_chunks = []
    kept_route_ids = set()
    kept_shape_ids = set()
    # if date filter: decide valid service_ids first
    for tchunk in trips_iter:
        if not {"trip_id","route_id","service_id"}.issubset(set(tchunk.columns)):
            print("trips.txt missing required columns", file=sys.stderr)
            sys.exit(1)
        tmask = tchunk["trip_id"].isin(kept_trip_ids)
        if date_filter and len(kept_service_ids) > 0:
            tmask &= tchunk["service_id"].isin(kept_service_ids)
        sub = tchunk[tmask].copy()
        if len(sub):
            kept_route_ids.update(sub["route_id"].unique().tolist())
            if "shape_id" in sub.columns:
                kept_shape_ids.update([s for s in sub["shape_id"].unique().tolist() if pd.notna(s) and s != ""])
            trips_kept_chunks.append(sub)
    if len(trips_kept_chunks) == 0:
        print("No trips remained after filtering by area/date. Try relaxing filters.", file=sys.stderr)
        sys.exit(3)

    trips_kept = pd.concat(trips_kept_chunks, ignore_index=True)
    final_kept_trip_ids = set(trips_kept["trip_id"].unique().tolist())

    # Now filter stop_times again to only those trips
    if kept_stop_times_chunks:
        st_all = pd.concat(kept_stop_times_chunks, ignore_index=True)
        st_final = st_all[st_all["trip_id"].isin(final_kept_trip_ids)].copy()
    else:
        st_final = pd.DataFrame(columns=read_csv(st_path, nrows=0).columns.tolist())

    # Update kept stops to only those that actually appear after trip filter
    used_stop_ids = set(st_final["stop_id"].unique().tolist())
    stops_final = stops[stops["stop_id"].isin(used_stop_ids)].copy()

    # 5) routes -> filter
    routes_path = os.path.join(indir, "routes.txt")
    if os.path.exists(routes_path):
        routes = read_csv(routes_path)
        if "route_id" in routes.columns:
            routes_final = routes[routes["route_id"].isin(kept_route_ids)].copy()
            kept_agency_ids = set(routes_final["agency_id"].unique().tolist()) if "agency_id" in routes_final.columns else set()
        else:
            routes_final = routes.iloc[0:0].copy()
            kept_agency_ids = set()
    else:
        routes_final = None
        kept_agency_ids = set()

    # 6) agency -> filter
    agency_path = os.path.join(indir, "agency.txt")
    if os.path.exists(agency_path):
        agency = read_csv(agency_path)
        if "agency_id" in agency.columns and len(kept_agency_ids) > 0:
            agency_final = agency[agency["agency_id"].isin(kept_agency_ids)].copy()
        else:
            # keep all if no agency reference available
            agency_final = agency.copy()
    else:
        agency_final = None

    # 7) shapes -> filter by kept shape_ids
    shapes_path = os.path.join(indir, "shapes.txt")
    if os.path.exists(shapes_path) and len(kept_shape_ids) > 0:
        shapes_iter = pd.read_csv(shapes_path, dtype=str, keep_default_na=False, na_values=[], quoting=0, chunksize=300000)
        shapes_kept_chunks = []
        for schunk in shapes_iter:
            if "shape_id" not in schunk.columns:
                continue
            sub = schunk[schunk["shape_id"].isin(kept_shape_ids)].copy()
            if len(sub):
                shapes_kept_chunks.append(sub)
        shapes_final = pd.concat(shapes_kept_chunks, ignore_index=True) if shapes_kept_chunks else schunk.iloc[0:0].copy()
    else:
        shapes_final = None

    # 8) frequencies -> filter by kept trips (if present)
    freq_path = os.path.join(indir, "frequencies.txt")
    if os.path.exists(freq_path):
        freq = read_csv(freq_path)
        if "trip_id" in freq.columns:
            freq_final = freq[freq["trip_id"].isin(final_kept_trip_ids)].copy()
        else:
            freq_final = freq.iloc[0:0].copy()
    else:
        freq_final = None

    # 9) calendar / calendar_dates -> keep only service_ids actually used by trips_final
    svc_used = set(trips_kept["service_id"].unique().tolist())
    if os.path.exists(cal_path):
        cal = read_csv(cal_path)
        if "service_id" in cal.columns:
            cal_final = cal[cal["service_id"].isin(svc_used)].copy()
        else:
            cal_final = cal.iloc[0:0].copy()
    else:
        cal_final = None

    if os.path.exists(cal_dates_path):
        cald = read_csv(cal_dates_path)
        if "service_id" in cald.columns:
            cald_final = cald[cald["service_id"].isin(svc_used)].copy()
        else:
            cald_final = cald.iloc[0:0].copy()
    else:
        cald_final = None

    # 10) levels/pathways/transfers -> filter by kept stops where applicable
    # levels (pass-through)
    levels_path = os.path.join(indir, "levels.txt")
    if os.path.exists(levels_path):
        levels_final = read_csv(levels_path)
    else:
        levels_final = None

    # pathways: keep rows where both from/to are in kept stops (best effort; keep those referencing any kept stop)
    pathways_path = os.path.join(indir, "pathways.txt")
    if os.path.exists(pathways_path):
        p_iter = pd.read_csv(pathways_path, dtype=str, keep_default_na=False, na_values=[], quoting=0, chunksize=200000)
        p_chunks = []
        for pch in p_iter:
            if {"from_stop_id","to_stop_id"}.issubset(set(pch.columns)):
                mask = pch["from_stop_id"].isin(used_stop_ids) & pch["to_stop_id"].isin(used_stop_ids)
                sub = pch[mask].copy()
                if len(sub):
                    p_chunks.append(sub)
        pathways_final = pd.concat(p_chunks, ignore_index=True) if p_chunks else read_csv(pathways_path, nrows=0)
    else:
        pathways_final = None

    # transfers: keep rows where both from/to in kept stops
    transfers_path = os.path.join(indir, "transfers.txt")
    if os.path.exists(transfers_path):
        t_iter = pd.read_csv(transfers_path, dtype=str, keep_default_na=False, na_values=[], quoting=0, chunksize=200000)
        t_chunks = []
        for tch in t_iter:
            if {"from_stop_id","to_stop_id"}.issubset(set(tch.columns)):
                mask = tch["from_stop_id"].isin(used_stop_ids) & tch["to_stop_id"].isin(used_stop_ids)
                sub = tch[mask].copy()
                if len(sub):
                    t_chunks.append(sub)
        transfers_final = pd.concat(t_chunks, ignore_index=True) if t_chunks else read_csv(transfers_path, nrows=0)
    else:
        transfers_final = None

    # 11) Write outputs
    print("Writing output to", outdir)

    write_csv(stops_final.drop(columns=[c for c in ["stop_lat_float","stop_lon_float","dist_km"] if c in stops_final.columns]), os.path.join(outdir, "stops.txt"))
    write_csv(st_final, os.path.join(outdir, "stop_times.txt"))
    write_csv(trips_kept, os.path.join(outdir, "trips.txt"))
    if routes_final is not None: write_csv(routes_final, os.path.join(outdir, "routes.txt"))
    if agency_final is not None: write_csv(agency_final, os.path.join(outdir, "agency.txt"))
    if shapes_final is not None: write_csv(shapes_final, os.path.join(outdir, "shapes.txt"))
    if freq_final is not None: write_csv(freq_final, os.path.join(outdir, "frequencies.txt"))
    if cal_final is not None: write_csv(cal_final, os.path.join(outdir, "calendar.txt"))
    if cald_final is not None: write_csv(cald_final, os.path.join(outdir, "calendar_dates.txt"))
    if levels_final is not None: write_csv(levels_final, os.path.join(outdir, "levels.txt"))
    if pathways_final is not None: write_csv(pathways_final, os.path.join(outdir, "pathways.txt"))
    if transfers_final is not None: write_csv(transfers_final, os.path.join(outdir, "transfers.txt"))

    # Quick size report
    total_bytes = 0
    for fn in sorted(os.listdir(outdir)):
        fp = os.path.join(outdir, fn)
        if os.path.isfile(fp):
            total_bytes += os.path.getsize(fp)
    print(f"Done. Approx total size: {round(total_bytes/1_000_000, 2)} MB")

if __name__ == "__main__":
    pd.options.mode.chained_assignment = None
    main()
