#!/usr/bin/env python3
"""Collect archived station MOS guidance and ASOS observations; publish honest verification.

Python standard library only. Forecasts are stored by ORIGINAL model run, so they
are never retroactively replaced by the latest forecast.
"""
from __future__ import annotations

import argparse
import bisect
import csv
import io
import json
import math
import os
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = ROOT / "data" / "archive"
OUTPUT = ROOT / "public" / "data" / "dashboard.json"
UTC = timezone.utc
STATIONS = {
    "KBTR": {"name": "Baton Rouge", "iem": "BTR", "network": "LA_ASOS", "lat": 30.533, "lon": -91.150},
    "KMSY": {"name": "New Orleans Intl", "iem": "MSY", "network": "LA_ASOS", "lat": 29.993, "lon": -90.258},
    "KHDC": {"name": "Hammond", "iem": "HDC", "network": "LA_ASOS", "lat": 30.521, "lon": -90.418},
    "KNEW": {"name": "New Orleans Lakefront", "iem": "NEW", "network": "LA_ASOS", "lat": 30.042, "lon": -90.028},
    "KASD": {"name": "Slidell", "iem": "ASD", "network": "LA_ASOS", "lat": 30.346, "lon": -89.820},
    "KMCB": {"name": "McComb", "iem": "MCB", "network": "MS_ASOS", "lat": 31.178, "lon": -90.472},
    "KGPT": {"name": "Gulfport", "iem": "GPT", "network": "MS_ASOS", "lat": 30.407, "lon": -89.070},
}
MODELS = {
    "NBS": {"label": "NBM Short", "family": "NBM station guidance"},
    "NBE": {"label": "NBM Extended", "family": "NBM station guidance"},
    "GFS": {"label": "GFS MOS", "family": "Statistical guidance — not raw GFS"},
    "NAM": {"label": "NAM MOS", "family": "Statistical guidance — not raw NAM"},
}
ELEMENTS = {
    "tmp": {"label": "Temperature", "unit": "°F", "min": -80, "max": 145},
    "dpt": {"label": "Dew point", "unit": "°F", "min": -100, "max": 115},
    "wsp": {"label": "Wind speed", "unit": "kt", "min": 0, "max": 160},
    "gst": {"label": "Wind gust", "unit": "kt", "min": 0, "max": 180},
}
LEADS = {"all": (0, 999), "0-12": (0, 12), "12-24": (12, 24),
         "24-48": (24, 48), "48-72": (48, 72), "72-120": (72, 120),
         "120+": (120, 999)}
# Only compare products that actually carry each variable at each lead.
# NBE begins at +24h in this text product; GFS/NAM MOS do not
# expose wind gust in the present station API response.
PRODUCTS_BY_LEAD = {
    "0-12": ("NBS", "GFS", "NAM"),
    "12-24": ("NBS", "GFS", "NAM"),
    "24-48": ("NBS", "NBE", "GFS", "NAM"),
    "48-72": ("NBS", "NBE", "GFS", "NAM"),
    "72-120": ("NBS", "NBE", "GFS", "NAM"),
}
COMPARISON_PRODUCTS = {
    element: {
        lead: [model for model in model_ids
               if element != "gst" or model in ("NBS", "NBE")]
        for lead, model_ids in PRODUCTS_BY_LEAD.items()
        if len([model for model in model_ids
                if element != "gst" or model in ("NBS", "NBE")]) >= 2
    }
    for element in ELEMENTS
}

HEADERS = {"User-Agent": "model-verification-dashboard/0.1 (+public research; contact via GitHub)"}


def utcnow():
    return datetime.now(UTC)


def dt(value):
    if value is None or str(value).strip() in ("", "None"):
        raise ValueError("missing timestamp")
    s = str(value).strip().replace(" UTC", "").replace("Z", "+00:00")
    parsed = datetime.fromisoformat(s)
    return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)


def iso(value):
    return value.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def number(value, variable):
    if value is None or str(value).strip() in ("", "M", "T", "-99", "999", "9999", "None", "null"):
        return None
    try:
        x = float(value)
    except (TypeError, ValueError):
        return None
    bounds = ELEMENTS[variable]
    return round(x, 2) if math.isfinite(x) and bounds["min"] <= x <= bounds["max"] else None


def get_text(url):
    last_exc = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=35) as res:
                text = res.read().decode("utf-8-sig")
            if text.lstrip().startswith("<!DOCTYPE") or text.lstrip().startswith("<html"):
                raise ValueError("HTML returned in place of data")
            return text
        except (OSError, ValueError) as exc:
            last_exc = exc
            if attempt < 2:
                time.sleep(2 ** attempt)
    raise RuntimeError(str(last_exc))


def parse_mos(payload, station, model):
    """Parse IEM MOS API data, rejecting ambiguous or missing timestamps."""
    records = []
    schema = payload.get("schema", [])
    cols = [(x.get("name") if isinstance(x, dict) else str(x)) for x in schema]
    for raw in payload.get("data", []):
        row = raw if isinstance(raw, dict) else dict(zip(cols, raw))
        try:
            init = dt(row.get("runtime_utc") or row.get("runtime"))
            valid = dt(row.get("ftime_utc") or row.get("ftime"))
        except (ValueError, TypeError):
            continue
        lead = (valid - init).total_seconds() / 3600
        if lead < 0 or lead > 300:
            continue
        values = {key: number(row.get(key), key) for key in ELEMENTS}
        if all(val is None for val in values.values()):
            continue
        records.append({"station": station, "model": model, "init": iso(init),
                        "valid": iso(valid), "lead": round(lead, 2), **values})
    return records


def fetch_mos(station, model):
    query = urllib.parse.urlencode({"station": station, "model": model})
    url = "https://mesonet.agron.iastate.edu/api/1/mos.json?" + query
    return parse_mos(json.loads(get_text(url)), station, model)



def fetch_historical_mos(station, model, start, end):
    """IEM documented bulk download; recover original historical forecast cycles."""
    params = urllib.parse.urlencode({
        "station": station, "model": model, "format": "csv",
        "sts": iso(start), "ets": iso(end),
    })
    url = "https://mesonet.agron.iastate.edu/cgi-bin/request/mos.py?" + params
    text = get_text(url)
    rows = list(csv.DictReader(io.StringIO(text)))
    if not rows or "runtime" not in rows[0] or "ftime" not in rows[0]:
        raise ValueError(f"Historical MOS response invalid for {station} {model}")
    return parse_mos({"data": rows}, station, model)


def parse_asos(text, station):
    lines = [line for line in text.splitlines() if line.strip() and not line.startswith("#")]
    records = []
    if not lines:
        return records
    for row in csv.DictReader(io.StringIO("\n".join(lines))):
        try:
            valid = dt(row.get("valid"))
        except (ValueError, TypeError):
            continue
        values = {key: number(row.get(src), key)
                  for key, src in (("tmp", "tmpf"), ("dpt", "dwpf"),
                                   ("wsp", "sknt"), ("gst", "gust"))}
        if all(value is None for value in values.values()):
            continue
        records.append({"station": station, "valid": iso(valid), **values})
    return records


def fetch_asos(station, meta, now, days=5):
    start = now - timedelta(days=days)
    end = now + timedelta(days=1)
    params = [
        ("station", meta["iem"]), ("network", meta["network"]),
        ("data", "tmpf"), ("data", "dwpf"), ("data", "sknt"), ("data", "gust"),
        ("year1", str(start.year)), ("month1", str(start.month)), ("day1", str(start.day)),
        ("year2", str(end.year)), ("month2", str(end.month)), ("day2", str(end.day)),
        ("tz", "Etc/UTC"), ("format", "onlycomma"), ("latlon", "no"),
        ("elev", "no"), ("missing", "M"), ("trace", "T"), ("direct", "no"),
        ("report_type", "3"), ("report_type", "4"),
    ]
    url = "https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?" + urllib.parse.urlencode(params)
    return parse_asos(get_text(url), station)


def read_archive(name):
    path = ARCHIVE / name
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    return data if isinstance(data, list) else []


def write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, separators=(",", ":"), ensure_ascii=False) + "\n",
                         encoding="utf-8")
    temporary.replace(path)


def merge(old, incoming, keys, cutoff):
    unique = {tuple(rec[k] for k in keys): rec for rec in old if rec.get("valid", "") >= cutoff}
    for rec in incoming:
        if rec.get("valid", "") >= cutoff:
            key = tuple(rec[k] for k in keys)
            # Preserve good older values if a later report omits one element.
            unique[key] = {**unique.get(key, {}), **{k: v for k, v in rec.items() if v is not None}}
    return sorted(unique.values(), key=lambda x: tuple(x[k] for k in keys))


def closest_observation(obs, valid, element, tolerance_seconds=2400):
    """Return nearest valid observation within ±40 min, no temporal interpolation."""
    if not obs:
        return None
    times = [r["valid"] for r in obs]
    pos = bisect.bisect_left(times, valid)
    candidates = obs[max(0, pos - 1):pos + 2]
    candidates = [x for x in candidates if x.get(element) is not None
                  and abs((dt(x["valid"]) - dt(valid)).total_seconds()) <= tolerance_seconds]
    return min(candidates, key=lambda x: abs((dt(x["valid"]) - dt(valid)).total_seconds())) if candidates else None


def calculate(forecasts, observations, now):
    obs_by_station = defaultdict(list)
    for row in observations:
        obs_by_station[row["station"]].append(row)
    for rows in obs_by_station.values():
        rows.sort(key=lambda x: x["valid"])
    # Scores are based on matched, previously archived forecast/observation pairs.
    bins = defaultdict(list)
    matched = 0
    recent_pairs = []
    for forecast in forecasts:
        valid = dt(forecast["valid"])
        if valid > now - timedelta(minutes=10) or valid < now - timedelta(days=30):
            continue
        for element in ELEMENTS:
            predicted = forecast.get(element)
            if predicted is None:
                continue
            obs = closest_observation(obs_by_station[forecast["station"]], forecast["valid"], element)
            if not obs:
                continue
            error = predicted - obs[element]
            matched += 1
            for horizon in (7, 30):
                if valid < now - timedelta(days=horizon):
                    continue
                for label, (lo, hi) in LEADS.items():
                    if lo <= forecast["lead"] < hi:
                        bins[(forecast["station"], forecast["model"], element, horizon, label)].append(error)
            if valid >= now - timedelta(days=3):
                recent_pairs.append({
                    "station": forecast["station"], "model": forecast["model"],
                    "element": element, "valid": forecast["valid"], "init": forecast["init"],
                    "lead": forecast["lead"], "forecast": predicted, "observed": obs[element],
                    "error": round(error, 2),
                })
    scores = []
    for (station, model, element, horizon, lead), errors in bins.items():
        count = len(errors)
        scores.append({"station": station, "model": model, "element": element,
                       "days": horizon, "lead": lead, "n": count,
                       "mae": round(sum(abs(x) for x in errors) / count, 2),
                       "rmse": round(math.sqrt(sum(x * x for x in errors) / count), 2),
                       "bias": round(sum(errors) / count, 2)})
    scores.sort(key=lambda r: (r["station"], r["element"], r["days"], r["lead"], r["model"]))
    latest_by_run = {}
    for forecast in forecasts:
        key = forecast["station"], forecast["model"]
        latest_by_run[key] = max(latest_by_run.get(key, ""), forecast["init"])
    latest = [
        row for row in forecasts
        if row["init"] == latest_by_run[(row["station"], row["model"])]
        and now - timedelta(hours=6) <= dt(row["valid"]) <= now + timedelta(days=10)
    ]
    recent_obs = [row for row in observations if dt(row["valid"]) >= now - timedelta(days=4)]
    return scores, latest, recent_obs, recent_pairs[-8000:], matched



def calculate_fair(forecasts, observations, now):
    """Rank guidance on identical station/valid/element cases within each lead bin.

    For each product and verifying time choose the model cycle with lead closest
    to the center of that bin. A case is included ONLY when all required model
    products have forecasts and one verifying observation. This prevents
    'best model' claims based on different samples of weather situations.
    """
    observed = defaultdict(list)
    for row in observations:
        if row.get("station") in STATIONS:
            observed[row["station"]].append(row)
    for rows in observed.values():
        rows.sort(key=lambda item: item["valid"])
    model_ids = set(MODELS)
    # Keyed by station, element, valid time, lead bucket, model.
    selected = {}
    for f in forecasts:
        if f.get("station") not in STATIONS or f.get("model") not in model_ids:
            continue
        try:
            valid_dt = dt(f["valid"])
            lead_hours = float(f["lead"])
        except (ValueError, KeyError, TypeError):
            continue
        if not (now - timedelta(days=30) <= valid_dt <= now - timedelta(minutes=10)):
            continue
        for name, (lo, hi) in LEADS.items():
            if name == "all" or not (lo <= lead_hours < hi):
                continue
            # A fixed reference lead per bin makes selection reproducible.
            center = (lo + hi) / 2 if hi < 900 else lo
            for element in ELEMENTS:
                if f.get(element) is None:
                    continue
                key = (f["station"], element, f["valid"], name, f["model"])
                rank = (abs(lead_hours - center), -dt(f["init"]).timestamp())
                previous = selected.get(key)
                if previous is None or rank < previous[0]:
                    selected[key] = (rank, f[element])
    grouped = defaultdict(dict)
    for (station, element, valid, lead, model), (_, forecast_value) in selected.items():
        grouped[(station, element, valid, lead)][model] = forecast_value

    scores = defaultdict(list)
    by_day = defaultdict(list)
    now7 = now - timedelta(days=7)
    common_count = 0
    for (station, element, valid, lead), forecasts_by_model in grouped.items():
        expected = COMPARISON_PRODUCTS.get(element, {}).get(lead, [])
        if len(expected) < 2 or not all(model in forecasts_by_model for model in expected):
            continue
        observation = closest_observation(observed[station], valid, element)
        if observation is None:
            continue
        common_count += 1
        errors = {model: forecasts_by_model[model] - observation[element]
                  for model in expected}
        best_abs = min(abs(value) for value in errors.values())
        winners = [model for model, err in errors.items()
                   if math.isclose(abs(err), best_abs, abs_tol=1e-8)]
        for model, error in errors.items():
            win = 1.0 / len(winners) if model in winners else 0.0
            for group_station in (station, "ALL"):
                for days in (7, 30):
                    if days == 7 and dt(valid) < now7:
                        continue
                    scores[(group_station, element, days, lead, model)].append((error, win))
                by_day[(group_station, element, lead, valid[:10], model)].append((error, win))

    fair_scores = []
    for (station, element, days, lead, model), observations_used in scores.items():
        errors = [error for error, _ in observations_used]
        n = len(errors)
        fair_scores.append({
            "station": station, "element": element, "days": days,
            "lead": lead, "model": model, "n": n,
            "mae": round(sum(abs(err) for err in errors) / n, 3),
            "rmse": round(math.sqrt(sum(err ** 2 for err in errors) / n), 3),
            "bias": round(sum(errors) / n, 3),
            "winRate": round(100 * sum(win for _, win in observations_used) / n, 1),
        })
    fair_scores.sort(key=lambda r: (r["station"], r["element"], r["days"],
                                     r["lead"], r["mae"], r["model"]))

    daily_scores = []
    for (station, element, lead, day, model), observations_used in by_day.items():
        errors = [err for err, _ in observations_used]
        daily_scores.append({
            "station": station, "element": element, "lead": lead,
            "day": day, "model": model, "n": len(errors),
            "mae": round(sum(abs(err) for err in errors) / len(errors), 3),
        })
    daily_scores.sort(key=lambda r: (r["station"], r["element"], r["lead"],
                                     r["day"], r["model"]))
    return fair_scores, daily_scores, common_count


def run(offline=False, backfill_days=0):
    now = utcnow()
    cutoff = iso(now - timedelta(days=35))
    forecasts = read_archive("forecasts.json")
    observations = read_archive("observations.json")
    new_forecasts, new_obs, warnings = [], [], []
    if not offline:
        if backfill_days:
            # IEM MOS archive can be backfilled, including original historic runs.
            # Overlap a few days before the verification window for longer leads.
            start = now - timedelta(days=min(35, backfill_days + 5))
            end = now - timedelta(hours=1)
            for station in STATIONS:
                for model in MODELS:
                    try:
                        historic = fetch_historical_mos(station, model, start, end)
                        if not historic:
                            raise ValueError("No archived station forecasts returned")
                        new_forecasts.extend(historic)
                        print(f"Historical MOS {station} {model}: {len(historic)}", flush=True)
                    except (RuntimeError, ValueError, KeyError) as exc:
                        warnings.append(f"History {station} {model}: {str(exc)[:130]}")
        for station in STATIONS:
            for model in MODELS:
                try:
                    rows = fetch_mos(station, model)
                    if not rows:
                        raise ValueError("Empty station forecast response")
                    new_forecasts.extend(rows)
                    print(f"MOS {station} {model}: {len(rows)}")
                except (RuntimeError, ValueError, KeyError, json.JSONDecodeError) as exc:
                    warnings.append(f"{station} {model}: {str(exc)[:130]}")
            try:
                rows = fetch_asos(station, STATIONS[station], now, days=min(35, backfill_days + 5) if backfill_days else 5)
                if not rows:
                    raise ValueError("No station observations returned")
                new_obs.extend(rows)
                print(f"ASOS {station}: {len(rows)}")
            except (RuntimeError, ValueError, KeyError) as exc:
                warnings.append(f"{station} ASOS: {str(exc)[:130]}")
    forecasts = merge(forecasts, new_forecasts, ("station", "model", "init", "valid"), cutoff)
    observations = merge(observations, new_obs, ("station", "valid"), cutoff)
    scores, latest, recent_obs, recent_pairs, matched = calculate(forecasts, observations, now)
    fair_scores, daily_scores, common_count = calculate_fair(forecasts, observations, now)
    write_json(ARCHIVE / "forecasts.json", forecasts)
    write_json(ARCHIVE / "observations.json", observations)
    write_json(OUTPUT, {
        "generatedAt": iso(now),
        "dataStatus": "active" if forecasts and observations else "awaiting_data",
        "stations": [{"id": code, **meta} for code, meta in STATIONS.items()],
        "models": [{"id": code, **meta} for code, meta in MODELS.items()],
        "elements": [{"id": code, **meta} for code, meta in ELEMENTS.items()],
        "leadBins": list(LEADS),
        # Publish aggregate verification only. The 30-day forecast archive stays
        # in data/archive; unnecessary raw trajectories would make Pages JSON huge.
        "scores": [], "fairScores": fair_scores, "dailyScores": daily_scores,
        "rankingMethod": "available-products-common-station-valid-time-lead-bin",
        "comparisonProducts": COMPARISON_PRODUCTS,
        "latestForecasts": [], "recentObservations": [], "recentPairs": [],
        "quality": {
            "forecastRecords": len(forecasts), "observationRecords": len(observations),
            "matchedElementPairs30d": matched, "fairCaseKeys30d": common_count,
            "warnings": warnings,
            "observationToleranceMinutes": 40, "archiveDays": 35,
            "NBMPercentilesAvailable": False,
        },
        "sources": {
            "forecast": "IEM archived MOS/operational NBM station text guidance (NBS/NBE)",
            "observations": "IEM ASOS/METAR archive",
        },
    })
    print(f"Published {len(fair_scores)} common-case scores, {common_count} matched case keys; {len(warnings)} warnings")
    for warning in warnings:
        print("WARNING:", warning)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--offline", action="store_true", help="Regenerate from archives without network access")
    parser.add_argument("--backfill-days", type=int, default=0,
                        help="Recover historical IEM model runs and ASOS observations (up to 30 days)")
    args = parser.parse_args()
    if not 0 <= args.backfill_days <= 30:
        parser.error("--backfill-days must be between 0 and 30")
    run(offline=args.offline, backfill_days=args.backfill_days)
