#!/usr/bin/env python3
"""
filter_gtfs_by_date_time.py
Limit a GTFS feed to a single service date and a time window (e.g., 10:00–14:00).
Keeps ALL stations/stops/pathways/transfers/levels (no spatial cutting).

Usage:
  python filter_gtfs_by_date_time.py \
    --in ~/Desktop/GTFS \
    --out ~/Desktop/gtfs_1day_10to14 \
    --date 2025-11-12 \
    --start 10:00:00 \
    --end 14:00:00

What it does
- Finds service_ids active on --date using calendar + calendar_dates.
- Keeps ONLY trips for those services that have at least one stop_time inside [--start, --end).
- Keeps ONLY stop_times inside the time window (trims outside rows).
- Keeps ONLY referenced routes/agencies/shapes/frequencies.
- Keeps ONLY calendar/calendar_dates rows for used service_ids.
- Keeps ALL stops, pathways, transfers, levels unmodified (so no stations are “cut off”).

Notes
- Time parsing handles GTFS extended hours (e.g., 25:10:00).
- If you want trips to remain “complete” (not trimmed), flip TRIM_STOP_TIMES=False below.
"""

import argparse
import os
import sys
from datetime import datetime
import pandas as pd

# ------------- config -------------
TRIM_STOP_TIMES = True  # True: write only stop_times within window. False: keep all rows of the kept trips.

# ------------- utils -------------
def read_csv(path, **kwargs):
    return pd.read_csv(path, dtype=str, keep_default_na=False, na_values=[], quoting=0, **kwargs)

def write_csv(df, path):
    df.to_csv(path, index=False)

def parse_args():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="indir", required=True, help="Input GTFS folder")
    ap.add_argument("--out", dest="outdir", required=True, help="Output GTFS folder")
    ap.add_argument("--date", required=True, help="Service date YYYY-MM-DD (local feed date)")
    ap.add_argument("--start", default="10:00:00", help="Window start HH:MM:SS (default 10:00:00)")
    ap.add_argument("--end",   default="14:00:00", help="Window end HH:MM:SS, exclusive (default 14:00:00)")
    return ap.parse_args()

def yyyymmdd(datestr):
    return datetime.strptime(datestr, "%Y-%m-%d").strftime("%Y%m%d")

def parse_hms_to_seconds(hms):
    """
    Parse 'HH:MM:SS' with HH possibly >= 24 per GTFS. Returns int seconds from 00:00:00.
    """
    if not isinstance(hms, str) or ":" not in hms:
        return None
    parts = hms.split(":")
    if len(parts) != 3:
        return None
    try:
        hh = int(parts[0])
        mm = int(parts[1])
        ss = int(parts[2])
        return hh*3600 + mm*60 + ss
    except:
        return None

def active_service_ids_for_date(indir, date_ymd):
    """
    Return set of service_id active on date_ymd (YYYYMMDD).
    Logic:
      1) calendar weekday & range
      2) calendar_dates exceptions (add/remove)
    """
    cal_path = os.path.join(indir, "calendar.txt")
    cald_path = os.path.join(indir, "calendar_dates.txt")

    weekday_services = set()
    if os.path.exists(cal_path):
        cal = read_csv(cal_path)
        required = {"service_id","monday","tuesday","wednesday","thursday","friday","saturday","sunday","start_date","end_date"}
        if required.issubset(cal.columns):
            dt = datetime.strptime(date_ymd, "%Y%m%d")
            dow = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"][dt.weekday()]
            ymd_i = int(date_ymd)
            def to_int_safe(s, default):
                try: return int(s)
                except: return default
            mask = (cal[dow] == "1")
            start_ok = cal["start_date"].apply(lambda s: to_int_safe(s, -10**12)) <= ymd_i
            end_ok   = cal["end_date"].apply(lambda s: to_int_safe(s,  10**12)) >= ymd_i
            weekday_services = set(cal[mask & start_ok & end_ok]["service_id"].tolist())

    additions = set()
    removals = set()
    if os.path.exists(cald_path):
        cald = read_csv(cald_path)
        if {"service_id","date","exception_type"}.issubset(cald.columns):
            drows = cald[cald["date"] == date_ymd]
            additions = set(drows[drows["exception_type"] == "1"]["service_id"].tolist())
            removals  = set(drows[drows["exception_type"] == "2"]["service_id"].tolist())

    active = set()
    if weekday_services:
        active |= weekday_services
    active |= additions
    active -= removals
    return active

# ------------- main -------------
def main():
    args = parse_args()
    indir = os.path.expanduser(args.indir)
    outdir = os.path.expanduser(args.outdir)
    os.makedirs(outdir, exist_ok=True)

    date_ymd = yyyymmdd(args.date)
    start_s = parse_hms_to_seconds(args.start)
    end_s   = parse_hms_to_seconds(args.end)
    if start_s is None or end_s is None:
        print("Invalid --start/--end. Use HH:MM:SS.", file=sys.stderr); sys.exit(1)
    if end_s <= start_s:
        print("--end must be greater than --start (end is exclusive).", file=sys.stderr); sys.exit(1)

    # 1) active services for the date
    svc_active = active_service_ids_for_date(indir, date_ymd)
    if len(svc_active) == 0:
        print(f"No active services for {args.date} ({date_ymd}).", file=sys.stderr); sys.exit(2)

    # 2) filter trips by active services
    trips_path = os.path.join(indir, "trips.txt")
    if not os.path.exists(trips_path):
        print("trips.txt missing", file=sys.stderr); sys.exit(1)

    kept_trip_ids_by_service = set()
    kept_route_ids = set()
    kept_shape_ids = set()
    trips_chunks = []
    for chunk in pd.read_csv(trips_path, dtype=str, keep_default_na=False, na_values=[], quoting=0, chunksize=200_000):
        if not {"trip_id","service_id","route_id"}.issubset(chunk.columns):
            print("trips.txt missing required columns", file=sys.stderr); sys.exit(1)
        sub = chunk[chunk["service_id"].isin(svc_active)].copy()
        if len(sub):
            trips_chunks.append(sub)
            kept_trip_ids_by_service.update(sub["trip_id"].tolist())
            kept_route_ids.update(sub["route_id"].tolist())
            if "shape_id" in sub.columns:
                kept_shape_ids.update([s for s in sub["shape_id"].tolist() if s])

    if len(kept_trip_ids_by_service) == 0:
        print("No trips after filtering by date.", file=sys.stderr); sys.exit(3)

    trips_by_service = pd.concat(trips_chunks, ignore_index=True)

    # 3) stop_times: choose those in time window; find trips touching the window
    st_path = os.path.join(indir, "stop_times.txt")
    if not os.path.exists(st_path):
        print("stop_times.txt missing", file=sys.stderr); sys.exit(1)

    # We’ll first find, among the trips_by_service, which ones have at least one stop_time in [start,end)
    candidate_trip_ids = set(trips_by_service["trip_id"].tolist())

    trips_touching_window = set()
    st_window_chunks = []     # only rows in window (for writing if TRIM_STOP_TIMES=True)
    st_full_chunks = []       # full rows for trips touching (if TRIM_STOP_TIMES=False)

    required_cols = {"trip_id","arrival_time","departure_time"}
    for chunk in pd.read_csv(st_path, dtype=str, keep_default_na=False, na_values=[], quoting=0, chunksize=300_000):
        # filter to candidate trips first
        if "trip_id" not in chunk.columns:
            print("stop_times.txt missing trip_id", file=sys.stderr); sys.exit(1)
        chunk = chunk[chunk["trip_id"].isin(candidate_trip_ids)].copy()
        if len(chunk) == 0:
            continue

        # Parse times (arrival/departure)
        arr_s = chunk["arrival_time"].apply(parse_hms_to_seconds) if "arrival_time" in chunk.columns else pd.Series([None]*len(chunk))
        dep_s = chunk["departure_time"].apply(parse_hms_to_seconds) if "departure_time" in chunk.columns else pd.Series([None]*len(chunk))

        # A row is "in window" if either arrival or departure is in [start_s, end_s)
        in_window = ((arr_s.notna() & (arr_s >= start_s) & (arr_s < end_s)) |
                     (dep_s.notna() & (dep_s >= start_s) & (dep_s < end_s)))

        # mark trips that touch window
        if in_window.any():
            trips_touching_window.update(chunk.loc[in_window, "trip_id"].unique().tolist())

        # keep rows for writing
        if TRIM_STOP_TIMES:
            sub = chunk[in_window].copy()
            if len(sub):
                st_window_chunks.append(sub)
        else:
            # keep full rows for touching trips
            st_full_chunks.append(chunk)

    if len(trips_touching_window) == 0:
        print("No trips have stop_times inside the requested window.", file=sys.stderr)
        sys.exit(4)

    # 4) finalize trips: only those touching the window
    trips_final = trips_by_service[trips_by_service["trip_id"].isin(trips_touching_window)].copy()
    kept_trip_ids = set(trips_final["trip_id"].tolist())
    kept_route_ids = set(trips_final["route_id"].tolist())
    kept_shape_ids = set(trips_final["shape_id"].dropna().tolist()) if "shape_id" in trips_final.columns else set()
    svc_used = set(trips_final["service_id"].tolist())

    # 5) finalize stop_times: either trimmed rows or full rows for kept trips
    if TRIM_STOP_TIMES:
        stop_times_final = (pd.concat(st_window_chunks, ignore_index=True)
                            if st_window_chunks else read_csv(st_path, nrows=0))
        # Ensure we drop any rows from trips that were filtered out after the last step
        if len(stop_times_final):
            stop_times_final = stop_times_final[stop_times_final["trip_id"].isin(kept_trip_ids)].copy()
    else:
        # collect full rows only for kept trips
        if st_full_chunks:
            st_all = pd.concat(st_full_chunks, ignore_index=True)
            stop_times_final = st_all[st_all["trip_id"].isin(kept_trip_ids)].copy()
        else:
            # fallback: re-read and filter to kept trips
            st_all = read_csv(st_path)
            stop_times_final = st_all[st_all["trip_id"].isin(kept_trip_ids)].copy()

    # 6) routes
    routes_path = os.path.join(indir, "routes.txt")
    if os.path.exists(routes_path):
        routes = read_csv(routes_path)
        routes_final = routes[routes["route_id"].isin(kept_route_ids)].copy() if "route_id" in routes.columns else routes.iloc[0:0].copy()
        kept_agency_ids = set(routes_final["agency_id"].tolist()) if "agency_id" in routes_final.columns else set()
    else:
        routes_final = None
        kept_agency_ids = set()

    # 7) agency
    agency_path = os.path.join(indir, "agency.txt")
    if os.path.exists(agency_path):
        agency = read_csv(agency_path)
        if "agency_id" in agency.columns and kept_agency_ids:
            agency_final = agency[agency["agency_id"].isin(kept_agency_ids)].copy()
        else:
            agency_final = agency.copy()
    else:
        agency_final = None

    # 8) shapes
    shapes_path = os.path.join(indir, "shapes.txt")
    if os.path.exists(shapes_path) and kept_shape_ids:
        sh_chunks = []
        for chunk in pd.read_csv(shapes_path, dtype=str, keep_default_na=False, na_values=[], quoting=0, chunksize=400_000):
            if "shape_id" not in chunk.columns:
                continue
            sub = chunk[chunk["shape_id"].isin(kept_shape_ids)].copy()
            if len(sub): sh_chunks.append(sub)
        shapes_final = pd.concat(sh_chunks, ignore_index=True) if sh_chunks else read_csv(shapes_path, nrows=0)
    else:
        shapes_final = None

    # 9) frequencies (if present): limit to kept trips
    freq_path = os.path.join(indir, "frequencies.txt")
    if os.path.exists(freq_path):
        freq = read_csv(freq_path)
        frequencies_final = freq[freq["trip_id"].isin(kept_trip_ids)].copy() if "trip_id" in freq.columns else freq.iloc[0:0].copy()
    else:
        frequencies_final = None

    # 10) calendars reduced to used services
    cal_path = os.path.join(indir, "calendar.txt")
    if os.path.exists(cal_path):
        cal = read_csv(cal_path)
        calendar_final = cal[cal["service_id"].isin(svc_used)].copy() if "service_id" in cal.columns else cal.iloc[0:0].copy()
    else:
        calendar_final = None

    cald_path = os.path.join(indir, "calendar_dates.txt")
    if os.path.exists(cald_path):
        cald = read_csv(cald_path)
        calendar_dates_final = cald[cald["service_id"].isin(svc_used)].copy() if "service_id" in cald.columns else cald.iloc[0:0].copy()
    else:
        calendar_dates_final = None

    # 11) Keep ALL stops/pathways/transfers/levels unchanged
    for name in ["stops.txt", "levels.txt", "pathways.txt", "transfers.txt"]:
        src = os.path.join(indir, name)
        if os.path.exists(src):
            df = read_csv(src)
            write_csv(df, os.path.join(outdir, name))

    # 12) Write filtered core files
    write_csv(trips_final, os.path.join(outdir, "trips.txt"))
    write_csv(stop_times_final, os.path.join(outdir, "stop_times.txt"))
    if routes_final is not None: write_csv(routes_final, os.path.join(outdir, "routes.txt"))
    if agency_final is not None: write_csv(agency_final, os.path.join(outdir, "agency.txt"))
    if shapes_final is not None: write_csv(shapes_final, os.path.join(outdir, "shapes.txt"))
    if frequencies_final is not None: write_csv(frequencies_final, os.path.join(outdir, "frequencies.txt"))
    if calendar_final is not None: write_csv(calendar_final, os.path.join(outdir, "calendar.txt"))
    if calendar_dates_final is not None: write_csv(calendar_dates_final, os.path.join(outdir, "calendar_dates.txt"))

    # Size report
    total_bytes = 0
    for fn in sorted(os.listdir(outdir)):
        fp = os.path.join(outdir, fn)
        if os.path.isfile(fp):
            total_bytes += os.path.getsize(fp)
    print(f"Done. Wrote to: {outdir}")
    print(f"Approx total size: {round(total_bytes/1_000_000, 2)} MB")

if __name__ == "__main__":
    pd.options.mode.chained_assignment = None
    main()
