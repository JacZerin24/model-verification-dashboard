#!/usr/bin/env python3
"""Archive and verify actual NBM QMD percentile GRIB2 point forecasts.

Uses anonymous NOAA AWS .idx inventories + HTTP GRIB2 byte ranges. No synthetic
percentiles and no distribution approximations from text-card standard deviations.
Requires pip package eccodes. Initial scope: CONUS 00Z, f012/f024/f036/f048,
2-m temperature and dewpoint, P10/P25/P50/P75/P90, seven LIX stations.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

from pipeline import ARCHIVE, ROOT, STATIONS, closest_observation, dt, iso, read_archive, utcnow, write_json

AWS = "https://noaa-nbm-grib2-pds.s3.amazonaws.com"
OUTPUT = ROOT / "public" / "data" / "qmd.json"
ARCHIVE_FILE = ARCHIVE / "qmd_forecasts.json"
PERCENTILES = (10, 25, 50, 75, 90)
LEADS = (12, 24, 36, 48)
VARIABLES = {"tmp": "TMP", "dpt": "DPT"}
LABELS = {"tmp": "Temperature", "dpt": "Dew point"}
UTC = timezone.utc


def source_url(cycle: datetime, lead: int):
    date = cycle.strftime("%Y%m%d")
    hour = cycle.strftime("%H")
    return f"{AWS}/blend.{date}/{hour}/qmd/blend.t{hour}z.qmd.f{lead:03d}.co.grib2"


def get(url, start=None, stop=None, tries=3):
    last = None
    for attempt in range(tries):
        headers = {"User-Agent": "model-verification-dashboard/0.2 (+github.com/JacZerin24/model-verification-dashboard)"}
        if start is not None:
            headers["Range"] = f"bytes={start}-{stop}"
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=55) as res:
                if start is not None and res.status != 206:
                    raise ValueError(f"Expected HTTP 206 for byte range, received {res.status}")
                data = res.read()
            if start is not None and len(data) != stop - start + 1:
                raise ValueError(f"Unexpected GRIB byte range size: {len(data)}")
            return data
        except (OSError, ValueError) as exc:
            last = exc
            if isinstance(exc, urllib.error.HTTPError) and exc.code in (403, 404):
                break
            if attempt < tries - 1:
                time.sleep(2 ** attempt)
    raise RuntimeError(f"{url}: {last}")


def parse_index(text):
    """Parse wgrib2 .idx inventory; uses adjacent byte offsets for exact ranges."""
    entries = []
    for line in text.splitlines():
        match = re.match(r"^\d+:(\d+):(.+)$", line.strip())
        if match:
            entries.append((int(match.group(1)), match.group(2)))
    if any(b <= a for (a, _), (b, _) in zip(entries, entries[1:])):
        raise ValueError("GRIB index offsets not strictly increasing")
    return [(description, start, next_start - 1)
            for (start, description), (next_start, _) in zip(entries, entries[1:])]


def select_index(index):
    selected = {}
    for description, start, end in index:
        # Ignore max/min temperature percentile accumulation fields.
        if re.search(r"\b(?:max|min)(?:-|(?:imum)?\b)", description.lower()):
            continue
        for element, grib_name in VARIABLES.items():
            if not re.search(rf":{grib_name}:2 m above ground:", ":" + description):
                continue
            for percentile in PERCENTILES:
                if re.search(rf"(?<!\d){percentile}% level(?!\d)", description):
                    key = (element, percentile)
                    if key in selected:
                        raise ValueError(f"Duplicate GRIB percentile field {key}")
                    selected[key] = (start, end, description)
    return selected


def decode_points(message, element, percentile, cycle, lead, stations):
    import eccodes

    if not message.startswith(b"GRIB"):
        raise ValueError("Selected message doesn't start with GRIB")
    gid = eccodes.codes_new_from_message(message)
    try:
        short_name = str(eccodes.codes_get(gid, "shortName")).upper()
        if short_name != VARIABLES[element]:
            raise ValueError(f"Expected {VARIABLES[element]}, got {short_name}")
        # Validate GRIB product template percentile metadata rather than relying on
        # inventory text alone. Some encodings provide scaled value in 'percentileValue'.
        try:
            encoded_percentile = int(eccodes.codes_get_long(gid, "percentileValue"))
        except (ValueError, RuntimeError) as exc:
            raise ValueError("Percentile metadata is absent from GRIB") from exc
        if encoded_percentile != percentile:
            raise ValueError(f"Expected P{percentile}, decoded P{encoded_percentile}")
        try:
            level = int(eccodes.codes_get_long(gid, "level"))
            if level != 2:
                raise ValueError(f"Unexpected height above ground: {level}")
        except KeyError:
            raise ValueError("GRIB height metadata unavailable")
        out = []
        for station, meta in stations.items():
            nearest = eccodes.codes_grib_find_nearest(gid, meta["lat"], meta["lon"])
            # ecCodes returns a list of (lat, lon, value, distance, index).
            point = nearest[0]
            value = float(point[2])
            distance = float(point[3])
            if not math.isfinite(value) or distance > 30:
                continue
            fahrenheit = (value - 273.15) * 9 / 5 + 32
            if not -110 <= fahrenheit <= 145:
                continue
            out.append({
                "station": station, "element": element, "percentile": percentile,
                "init": iso(cycle), "valid": iso(cycle + timedelta(hours=lead)),
                "lead": lead, "value": round(fahrenheit, 2),
                "gridDistanceKm": round(distance, 2),
                "source": "NOAA NBM QMD CONUS",
            })
        return out
    finally:
        eccodes.codes_release(gid)


def fetch_cycle(cycle, lead, stations):
    url = source_url(cycle, lead)
    inventory = parse_index(get(url + ".idx").decode("utf-8"))
    selections = select_index(inventory)
    required = {(element, p) for element in VARIABLES for p in PERCENTILES}
    missing = required - set(selections)
    if missing:
        raise ValueError(f"QMD fields missing for f{lead:03d}: {sorted(missing)}")
    values = []
    for (element, percentile), (start, end, description) in sorted(selections.items()):
        message = get(url, start, end)
        values.extend(decode_points(message, element, percentile, cycle, lead, stations))
    return values


def quantile_loss(predicted, observed, q):
    """Pinball loss; correct orientation for an observation below the quantile."""
    error = observed - predicted
    return max(q * error, (q - 1) * error)


def interval_score(lower, upper, observed, alpha):
    """Proper interval score (lower is better); nominal coverage 1-alpha."""
    return (upper - lower) + 2 / alpha * max(lower - observed, 0) + 2 / alpha * max(observed - upper, 0)


def weighted_interval_score(quantiles, observed):
    """Five-quantile WIS using two central intervals and median."""
    q = quantiles
    return (0.5 * abs(q[50] - observed)
            + 0.1 * interval_score(q[10], q[90], observed, 0.2)
            + 0.25 * interval_score(q[25], q[75], observed, 0.5)) / 2.5


def verify(records, observations, now):
    obs = defaultdict(list)
    for x in observations:
        obs[x["station"]].append(x)
    for group in obs.values():
        group.sort(key=lambda r: r["valid"])
    cases = defaultdict(dict)
    for f in records:
        if f["valid"] > iso(now - timedelta(minutes=10)) or f["valid"] < iso(now - timedelta(days=30)):
            continue
        key = (f["station"], f["element"], f["valid"], f["init"], f["lead"])
        cases[key][f["percentile"]] = f["value"]
    group_stats = defaultdict(list)
    matched_cases = 0
    for (station, element, valid, init, lead), q in cases.items():
        if set(PERCENTILES) != set(q):
            continue
        if not all(q[a] <= q[b] for a,b in zip(PERCENTILES, PERCENTILES[1:])):
            continue
        verifying = closest_observation(obs[station], valid, element)
        if verifying is None:
            continue
        y = verifying[element]
        matched_cases += 1
        metrics = {
            "p50AbsError": abs(q[50] - y),
            "p50Bias": q[50] - y,
            "p10Below": float(y <= q[10]), "p25Below": float(y <= q[25]),
            "p50Below": float(y <= q[50]), "p75Below": float(y <= q[75]),
            "p90Below": float(y <= q[90]),
            "coverage80": float(q[10] <= y <= q[90]),
            "coverage50": float(q[25] <= y <= q[75]),
            "width80": q[90] - q[10],
            "wis": weighted_interval_score(q, y),
        }
        for p in PERCENTILES:
            metrics[f"pinball{p}"] = quantile_loss(q[p], y, p/100)
        for days in (7, 30):
            if dt(valid) >= now - timedelta(days=days):
                for station_key in (station, "ALL"):
                    group_stats[(station_key, element, lead, days)].append(metrics)
    scored = []
    for (station, element, lead, days), items in group_stats.items():
        n = len(items)
        mean = lambda key: round(sum(x[key] for x in items)/n, 3)
        entry = {"station": station, "element": element, "lead": lead, "days": days, "n": n,
                 "p50MAE": mean("p50AbsError"), "p50Bias": mean("p50Bias"),
                 "wis": mean("wis"), "interval80Width": mean("width80")}
        for key in ("coverage80", "coverage50", "p10Below", "p25Below", "p50Below", "p75Below", "p90Below"):
            entry[key] = round(100 * mean(key), 1)
        for p in PERCENTILES:
            entry[f"pinball{p}"] = mean(f"pinball{p}")
        scored.append(entry)
    scored.sort(key=lambda x: (x["station"], x["element"], x["lead"], x["days"]))
    return scored, matched_cases


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=2, help="How many 00Z cycles to attempt")
    parser.add_argument("--no-network", action="store_true")
    parser.add_argument("--max-stations", type=int, default=7)
    args = parser.parse_args()
    if not 1 <= args.days <= 30:
        parser.error("--days must be between 1 and 30")
    now = utcnow()
    previous = json.loads(ARCHIVE_FILE.read_text()) if ARCHIVE_FILE.exists() else []
    records = {tuple(row[key] for key in ("station","element","percentile","init","lead")):row
               for row in previous if row.get("valid","") >= iso(now-timedelta(days=35))}
    warnings = []
    if not args.no_network:
        # Forecast cycles need at least the expected publication latency.
        # 00Z QMD may not be available until 07:20Z.
        latest = now.replace(hour=0, minute=0, second=0, microsecond=0)
        if now.hour < 9:
            latest -= timedelta(days=1)
        for age in range(args.days):
            cycle = latest - timedelta(days=age)
            for lead in LEADS:
                known = {(r["station"],r["element"],r["percentile"])
                         for r in records.values() if r["init"] == iso(cycle) and r["lead"]==lead}
                expected = {(station,element,p) for station in list(STATIONS)[:args.max_stations]
                            for element in VARIABLES for p in PERCENTILES}
                if expected <= known:
                    continue
                try:
                    print(f"QMD {cycle.isoformat()} f{lead:03d}: fetching source inventory",flush=True)
                    subset=fetch_cycle(cycle,lead,dict(list(STATIONS.items())[:args.max_stations]))
                    if not subset:
                        raise ValueError("No valid station samples decoded")
                    for row in subset:
                        records[tuple(row[key] for key in ("station","element","percentile","init","lead"))]=row
                    print(f"Saved {len(subset)} percentile station values",flush=True)
                except Exception as error:
                    warning=f"{iso(cycle)} f{lead:03d}: {type(error).__name__}: {str(error)[:180]}"
                    warnings.append(warning)
                    print("WARNING "+warning,flush=True)
    archive=sorted(records.values(),key=lambda r:(r["init"],r["lead"],r["station"],r["element"],r["percentile"]))
    observations=read_archive("observations.json")
    scores, matched=verify(archive,observations,now)
    write_json(ARCHIVE_FILE,archive)
    write_json(OUTPUT,{
        "generatedAt":iso(now),
        "source":"NOAA AWS NBM QMD CONUS GRIB2 / nearest gridpoint",
        "dataStatus":"verified" if scores else ("collecting" if archive else "unavailable"),
        "elements":[{"id":k,"label":v,"unit":"°F"} for k,v in LABELS.items()],
        "percentiles":list(PERCENTILES),"leads":list(LEADS),
        "stations":[{"id":key,"name":meta["name"]} for key,meta in STATIONS.items()],
        "scores":scores,
        "quality":{"archivedQuantilePoints":len(archive),"completeVerifyingCases":matched,
                   "observationToleranceMinutes":40,
                   "warnings":warnings,"sourceCycles":"00Z","spatialMethod":"nearest grid point"},
    })
    print(f"QMD status: {len(archive)} quantile values; {matched} verifying cases; {len(warnings)} warnings",flush=True)


if __name__=="__main__":
    main()
