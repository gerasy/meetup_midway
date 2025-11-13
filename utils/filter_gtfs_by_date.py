#!/usr/bin/env python3
"""
filter_gtfs_by_date.py
Limit a GTFS feed to a single 24-hour service date (keep ALL stations).

Usage:
  python filter_gtfs_by_date.py --in ~/Desktop/GTFS --out ./gtfs_1day --date 2025-11-12

What it does
- Computes which service_ids run on --date (YYYY-MM-DD) using calendar_dates + calendar.
- Keeps ONLY trips for those service_ids.
- Keeps ONLY stop_times for those kept trips.
- Keeps ONLY routes/agency/shapes/frequencies that are referenced by the kept trips.
- Keeps ONLY calendar/calendar_dates rows for kept service_ids.
- IMPORTANT: Keeps ALL stops, pathways, transfers, and levels (no station cut).

Notes
- Chunked reads for large files (stop_times, trips, shapes).
- Exception precedence: calendar_dates removes (exception_type=2) or adds (exception_type=1) service for the date.
"""

import argparse
import os
import sys
from datetime import datetime
import pandas as pd

# ---------- utils ----------
def read_csv(path, **kwargs):
    return pd.read_csv(path, dtype=str, keep_default_na=False, na_values=[], quoting=0, **kwargs)

def write_csv(df, path):
    df.to_csv(path, index=False)

def parse_args():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="indir", required=True, help="Input GTFS folder")
    ap.add_argument("--out", dest="outdir", required=True, help="Output GTFS folder")
    ap.add_argument("--date", dest="date", required=True, help="Service date YYYY-MM-DD (local feed date)")
    return ap.parse_args()

def yyyymmdd(datestr):
    return datetime.strptime(datestr, "%Y-%m-%d").strftime("%Y%m%d")

# ---------- service activation ----------
def active_service_ids_for_date(indir, date_ymd):
    """
    Return set of service_id active on date_ymd (YYYYMMDD string).
    Logic:
      1) Start with services that run per calendar weekday + within [start_date, end_date]
      2) Apply calendar_dates exceptions: add (1) and remove (2) for this date
    If calendar is missing, rely solely on calendar_dates (adds).
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
            mask = (cal[dow] == "1")
            # guard numeric compare if fields are empty; coerce invalid to large negatives/positives
            def to_int_safe(s, default):
                try: return int(s)
                except: return default
            start_ok = cal["start_date"].apply(lambda s: to_int_safe(s, -10**12)) <= ymd_i
            end_ok   = cal["end_date"].apply(lambda s: to_int_safe(s,  10**12)) >= ymd_i
            cal_ok = cal[mask & start_ok & end_ok]
            weekday_services = set(cal_ok["service_id"].tolist())

    additions = set()
    removals  = set()
    if os.path.exists(cald_path):
        cald = read_csv(cald_path)
        if {"service_id","date","exception_type"}.issubset(cald.columns):
            day_rows = cald[cald["date"] == date_ymd]
            additions = set(day_rows[day_rows["exception_type"] == "1"]["service_id"].tolist())
            removals  = set(day_rows[day_rows["exception_type"] == "2"]["service_id"].tolist())

    # Combine
    active = set()
    if len(weekday_services) > 0:
        active |= weekday_services
    # Add explicit additions, then remove explicit removals
    active |= additions
    active -= removals

    # If we have NO calendar and NO additions, active stays empty; caller will handle.
    return active

# ---------- main pipeline ----------
def main():
    args = parse_args()
    indir = os.path.expanduser(args.indir)
    outdir = os.path.expanduser(args.outdir)
    os.makedirs(outdir, exist_ok=True)

    if not os.path.isdir(indir):
        print("Input folder not found.", file=sys.stderr); sys.exit(1)

    # 1) Which service_ids are active on the date?
    date_ymd = yyyymmdd(args.date)
    svc_active = active_service_ids_for_date(indir, date_ymd)

    if len(svc_active) == 0:
        print(f"No active services found for {args.date} ({date_ymd}). "
              f"Check calendar/calendar_dates.", file=sys.stderr)
        sys.exit(2)

    # 2) Filter trips by active service_ids
    trips_path = os.path.join(indir, "trips.txt")
    if not os.path.exists(trips_path):
        print("trips.txt missing", file=sys.stderr); sys.exit(1)

    kept_trip_ids = set()
    kept_route_ids = set()
    kept_shape_ids = set()
    trips_chunks = []
    for chunk in pd.read_csv(trips_path, dtype=str, keep_default_na=False, na_values=[], quoting=0, chunksize=200_000):
        if not {"trip_id","service_id","route_id"}.issubset(chunk.columns):
            print("trips.txt missing required columns", file=sys.stderr); sys.exit(1)
        sub = chunk[chunk["service_id"].isin(svc_active)].copy()
        if len(sub):
            trips_chunks.append(sub)
            kept_trip_ids.update(sub["trip_id"].tolist())
            kept_route_ids.update(sub["route_id"].tolist())
            if "shape_id" in sub.columns:
                kept_shape_ids.update([s for s in sub["shape_id"].tolist() if s])

    if len(kept_trip_ids) == 0:
        print("No trips remain after filtering by date.", file=sys.stderr); sys.exit(3)

    trips_final = pd.concat(trips_chunks, ignore_index=True)

    # 3) stop_times -> only for kept trips
    st_path = os.path.join(indir, "stop_times.txt")
    if not os.path.exists(st_path):
        print("stop_times.txt missing", file=sys.stderr); sys.exit(1)

    st_chunks = []
    for chunk in pd.read_csv(st_path, dtype=str, keep_default_na=False, na_values=[], quoting=0, chunksize=300_000):
        if "trip_id" not in chunk.columns:
            print("stop_times.txt missing trip_id", file=sys.stderr); sys.exit(1)
        sub = chunk[chunk["trip_id"].isin(kept_trip_ids)].copy()
        if len(sub):
            st_chunks.append(sub)
    stop_times_final = pd.concat(st_chunks, ignore_index=True) if st_chunks else read_csv(st_path, nrows=0)

    # 4) routes -> only referenced routes
    routes_path = os.path.join(indir, "routes.txt")
    if os.path.exists(routes_path):
        routes = read_csv(routes_path)
        routes_final = routes[routes["route_id"].isin(kept_route_ids)].copy() if "route_id" in routes.columns else routes.iloc[0:0].copy()
        kept_agency_ids = set(routes_final["agency_id"].tolist()) if "agency_id" in routes_final.columns else set()
    else:
        routes_final = None
        kept_agency_ids = set()

    # 5) agency -> only those referenced (or all if agency mapping isn’t present)
    agency_path = os.path.join(indir, "agency.txt")
    if os.path.exists(agency_path):
        agency = read_csv(agency_path)
        if "agency_id" in agency.columns and kept_agency_ids:
            agency_final = agency[agency["agency_id"].isin(kept_agency_ids)].copy()
        else:
            agency_final = agency.copy()
    else:
        agency_final = None

    # 6) shapes -> only referenced shapes
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

    # 7) frequencies -> only for kept trips (if provided)
    freq_path = os.path.join(indir, "frequencies.txt")
    if os.path.exists(freq_path):
        freq = read_csv(freq_path)
        frequencies_final = freq[freq["trip_id"].isin(kept_trip_ids)].copy() if "trip_id" in freq.columns else freq.iloc[0:0].copy()
    else:
        frequencies_final = None

    # 8) calendar / calendar_dates -> only service_ids actually used
    svc_used = set(trips_final["service_id"].tolist())

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

    # 9) KEEP ALL STOPS (no station cut), plus levels/pathways/transfers untouched
    for keep_all_name in ["stops.txt", "levels.txt", "pathways.txt", "transfers.txt"]:
        src = os.path.join(indir, keep_all_name)
        if os.path.exists(src):
            df = read_csv(src)
            write_csv(df, os.path.join(outdir, keep_all_name))

    # 10) Write filtered core files
    write_csv(trips_final, os.path.join(outdir, "trips.txt"))
    write_csv(stop_times_final, os.path.join(outdir, "stop_times.txt"))
    if routes_final is not None: write_csv(routes_final, os.path.join(outdir, "routes.txt"))
    if agency_final is not None: write_csv(agency_final, os.path.join(outdir, "agency.txt"))
    if shapes_final is not None: write_csv(shapes_final, os.path.join(outdir, "shapes.txt"))
    if frequencies_final is not None: write_csv(frequencies_final, os.path.join(outdir, "frequencies.txt"))
    if calendar_final is not None: write_csv(calendar_final, os.path.join(outdir, "calendar.txt"))
    if calendar_dates_final is not None: write_csv(calendar_dates_final, os.path.join(outdir, "calendar_dates.txt"))

    # Size report (optional)
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
