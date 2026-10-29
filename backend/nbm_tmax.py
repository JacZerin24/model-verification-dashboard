#!/usr/bin/env python3
"""Period-matched NOAA NBM QMD 18-hour daytime Tmax percentile verification.

NBM forecast: 06 UTC initialization, TMP 6-24/30-48/54-72-hour MAX
statistical field, five percentiles. Station observed surrogate: max of
three six-hour ASOS maximum temperature remarks ending at valid time.
Not official local-standard-day CLI temperature.
"""
from __future__ import annotations
import argparse
import csv
import io
import json
import re
import urllib.parse
from datetime import timedelta
from pathlib import Path

from nbm_qmd import (
    PERCENTILES, decode_points, get, parse_index, source_url, utcnow,
    verify,
)
from pipeline import (
    ARCHIVE, ROOT, STATIONS, dt, get_text, iso, merge, read_archive,
    write_json,
)
from tmax_observations import observed_period_max, parse_metar_max_csv

OUTPUT = ROOT / "public" / "data" / "tmax.json"
FORECAST_ARCHIVE = ARCHIVE / "tmax_forecasts.json"
OBS_ARCHIVE = ARCHIVE / "metar_max6h.json"
LEADS = (24, 48, 72)
HOURS = 18


def select_max_index(index, lead):
    """Only actual 18h MAX forecast percentiles ending at the requested lead."""
    fields = {}
    for description, start, end in index:
        match = re.search(
            r":TMP:2 m above ground:(\d+)-(\d+) hour max fcst:(\d+)% level(?:$|:)",
            ":" + description,
        )
        if not match:
            continue
        begin, last, percentile = map(int, match.groups())
        if percentile not in PERCENTILES or last != lead or last - begin != HOURS:
            continue
        if percentile in fields:
            raise ValueError(f"Duplicate Tmax percentile P{percentile}")
        fields[percentile] = (start, end, description)
    return fields


def fetch_tmax(cycle, lead, stations):
    url = source_url(cycle, lead)
    idx = parse_index(get(url + ".idx").decode("utf-8"))
    found = select_max_index(idx, lead)
    missing = set(PERCENTILES) - set(found)
    if missing:
        raise ValueError(f"Tmax 18h fields absent at {iso(cycle)} f{lead:03d}: P{sorted(missing)}")
    rows = []
    for percentile in PERCENTILES:
        start, end, _ = found[percentile]
        values = decode_points(get(url, start, end), "tmp", percentile,
                               cycle, lead, stations, temporal_max=True)
        period_start = iso(cycle + timedelta(hours=lead-HOURS))
        for value in values:
            value["periodStart"] = period_start
            value["periodEnd"] = value["valid"]
            value["verificationKind"] = "18h-daytime-tmax"
        rows.extend(values)
    return rows


def fetch_metar_groups(station, meta, now, days=10):
    start = now - timedelta(days=days)
    end = now + timedelta(days=1)
    params = [
        ("station", meta["iem"]), ("network", meta["network"]),
        ("data", "metar"),
        ("year1", str(start.year)), ("month1", str(start.month)),
        ("day1", str(start.day)), ("year2", str(end.year)),
        ("month2", str(end.month)), ("day2", str(end.day)),
        ("tz", "Etc/UTC"), ("format", "onlycomma"),
        ("missing", "M"), ("trace", "T"), ("direct", "no"),
        ("report_type", "3"), ("report_type", "4"),
    ]
    url = "https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?" + urllib.parse.urlencode(params)
    return parse_metar_max_csv(get_text(url), station)


def build_period_observations(forecasts, metar_groups):
    by_station = {}
    for observation in metar_groups:
        by_station.setdefault(observation["station"], []).append(observation)
    for rows in by_station.values():
        rows.sort(key=lambda x:x["valid"])
    windows = {}
    for item in forecasts:
        key = (item["station"], item["valid"])
        if key in windows:
            continue
        matched = observed_period_max(
            by_station.get(item["station"], []), item["valid"], hours=HOURS)
        if matched:
            windows[key] = matched
    observed = [
        {"station":station, "valid":end, "tmp":source["value"]}
        for (station, end), source in windows.items()
    ]
    return observed, windows


def count_distinct_observed_windows(cases):
    """A forecast cycle is not an independent observed station/window event."""
    return len({(row["station"], row["valid"]) for row in cases})



def run(no_network=False, days=7):
    now = utcnow()
    archive_cutoff = iso(now - timedelta(days=35))
    old = json.loads(FORECAST_ARCHIVE.read_text()) if FORECAST_ARCHIVE.exists() else []
    existing = {
        (x["station"], x["init"], x["valid"], x["percentile"]):x
        for x in old if x.get("valid", "") >= archive_cutoff
    }
    metar = json.loads(OBS_ARCHIVE.read_text()) if OBS_ARCHIVE.exists() else []
    warnings = []
    if not no_network:
        latest_day = (now - timedelta(hours=9)).replace(hour=6, minute=0, second=0, microsecond=0)
        if latest_day > now - timedelta(hours=9):
            latest_day -= timedelta(days=1)
        for age in range(days):
            cycle = latest_day - timedelta(days=age)
            for lead in LEADS:
                found = {(x["station"], x["percentile"]) for x in existing.values()
                         if x["init"] == iso(cycle) and x["lead"] == lead}
                required = {(station, p) for station in STATIONS for p in PERCENTILES}
                if required <= found:
                    continue
                try:
                    print(f"Tmax {iso(cycle)} f{lead:03d}: retrieving",flush=True)
                    values = fetch_tmax(cycle, lead, STATIONS)
                    if not values:
                        raise ValueError("No sampled Tmax grid values")
                    for row in values:
                        key = (row["station"], row["init"], row["valid"], row["percentile"])
                        existing[key] = row
                    print(f"Decoded {len(values)} Tmax percentile points",flush=True)
                except Exception as exc:
                    warnings.append(f"{iso(cycle)} f{lead:03d}: {type(exc).__name__}: {str(exc)[:170]}")
        for station, meta in STATIONS.items():
            try:
                recent = fetch_metar_groups(station, meta, now, days=min(35,days+5))
                metar = merge(metar, recent, ("station","valid"), archive_cutoff)
                print(f"METAR 6-hour maxima {station}: {len(recent)}",flush=True)
            except Exception as exc:
                warnings.append(f"ASOS max6h {station}: {type(exc).__name__}: {str(exc)[:170]}")

    archive = sorted(existing.values(), key=lambda r:(r["valid"],r["station"],r["init"],r["percentile"]))
    metar = [r for r in metar if r.get("valid","") >= archive_cutoff]
    observations, periods = build_period_observations(archive, metar)
    scores, matched, case_details = verify(archive, observations, now)
    # Several forecast cycles can verify against the same observed 18h window.
    # Report the number of distinct observed station/window events separately
    # from the number of matched forecast vintages.
    distinct_observed_windows = count_distinct_observed_windows(case_details)
    for item in scores:
        item["element"] = "tmax18"
    for case in case_details:
        case["element"] = "tmax18"
        match = periods.get((case["station"],case["valid"]))
        if match:
            case["periodStart"] = match["periodStart"]
            case["periodEnd"] = match["periodEnd"]
            case["observationSource"] = match["source"]
    write_json(FORECAST_ARCHIVE, archive)
    write_json(OBS_ARCHIVE, metar)
    write_json(OUTPUT, {
        "generatedAt": iso(now),
        "dataStatus": "verified" if scores else ("collecting" if archive else "unavailable"),
        "source":"NOAA NBM QMD 18-hour MAX; ASOS 6-hour METAR extremes",
        "verificationType":"18-hour-daytime-maximum-not-official-CLI",
        "elements":[{"id":"tmax18","label":"Daytime high (NBM 18-hour window)","unit":"°F"}],
        "percentiles":list(PERCENTILES),"leads":list(LEADS),
        "stations":[{"id":station,"name":info["name"]} for station,info in STATIONS.items()],
        "scores":scores,
        "timeseries":case_details,
        "recentCases":case_details,
        "quality":{
            "archivedQuantilePoints":len(archive),
            "completeVerifyingCases":matched,
            "distinctObservedStationWindows":distinct_observed_windows,
            "metarSixHourReports":len(metar),
            "completeObservedWindows":len(periods),
            "sourceCycles":"06Z",
            "windowHours":HOURS,
            "observationToleranceMinutes":20,
            "warning":"18h NBM daytime maxima and six-hour METAR extremes are not official local-standard-day CLI highs",
            "warnings":warnings,
        },
    })
    print(f"18h Tmax: {len(archive)} percentile values, {matched} complete verifying cases; {len(warnings)} warnings",flush=True)


if __name__ == "__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--days",type=int,default=7)
    parser.add_argument("--no-network",action="store_true")
    args=parser.parse_args()
    if not 1 <= args.days <= 30:
        parser.error("--days must be between 1 and 30")
    run(args.no_network,args.days)
