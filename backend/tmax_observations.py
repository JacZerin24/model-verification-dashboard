"""Observed six-hour ASOS maxima for period-matched NBM daytime-Tmax verification.

These are METAR 6-hour temperature extremes, NOT official NWS CLI daily highs.
All three 6-hour windows must be available to estimate an 18-hour peak.
"""
from datetime import timedelta
import re
from pipeline import dt, iso

SIX_HOUR_MAX = re.compile(r"(?<![A-Z0-9])1([01])(\d{3})(?!\d)")


def six_hour_max_f(metar):
    """Parse the signed 6-hour max-temperature group (1snTTT) in METAR RMK."""
    if not metar or " RMK " not in metar:
        return None
    remarks = metar.split(" RMK ", 1)[1]
    result = SIX_HOUR_MAX.search(remarks)
    if result is None:
        return None
    c = int(result.group(2)) / 10.0 * (-1 if result.group(1) == "1" else 1)
    value = c * 1.8 + 32
    return round(value, 2) if -100 <= value <= 140 else None


def observed_period_max(reports, period_end, hours=18, tolerance_minutes=20):
    """Maximum across required synoptic six-hour METAR remark groups.

    An 18-hour verification ending 00 UTC needs 12/18/00 UTC METAR groups.
    Reports are issued before the exact synoptic hour; coverage at period
    boundaries is approximate and this must not be mislabeled as official CLI.
    """
    if hours <= 0 or hours % 6:
        raise ValueError("Period must consist of complete six-hour synoptic blocks")
    end = dt(period_end)
    if end.hour % 6 or end.minute:
        raise ValueError("Forecast end must be on a six-hour synoptic boundary")
    maxima = []
    sources = []
    for remaining in range(hours - 6, -1, -6):
        expected = end - timedelta(hours=remaining)
        candidates = []
        for report in reports:
            if report.get("max6h") is None:
                continue
            timestamp = dt(report["valid"])
            delta = abs((timestamp - expected).total_seconds())
            if delta <= tolerance_minutes * 60:
                candidates.append((delta, report["max6h"], report["valid"]))
        if not candidates:
            return None
        _, value, actual_at = min(candidates, key=lambda item:item[0])
        maxima.append(value)
        sources.append(actual_at)
    return {
        "value": round(max(maxima), 2),
        "source": "ASOS METAR 6h max groups",
        "synopticReports": sources,
        "periodStart": iso(end - timedelta(hours=hours)),
        "periodEnd": iso(end),
        "temporalCaveat": "Issued near synoptic boundaries; not official CLI daily maximum",
    }


def parse_metar_max_csv(text, station):
    import csv
    import io
    rows = []
    for raw in csv.DictReader(io.StringIO("\n".join(
            line for line in text.splitlines() if line.strip() and not line.startswith("#")))):
        try:
            stamp=iso(dt(raw.get("valid")))
            maximum=six_hour_max_f(raw.get("metar"))
            if maximum is None:
                continue
            rows.append({"station":station,"valid":stamp,"max6h":maximum})
        except (TypeError, ValueError):
            continue
    return rows
