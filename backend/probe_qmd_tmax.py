"""Inspect real NBM QMD MAX/TMAX percentile inventory without guessing fields.
Writes a human-readable diagnostics file for the GitHub workflow.
"""
from datetime import timedelta
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from nbm_qmd import get, source_url, utcnow
from pipeline import iso

def main():
    now=utcnow()
    cycle=now.replace(hour=0,minute=0,second=0,microsecond=0)
    if now.hour<9:
        cycle-=timedelta(days=1)
    lines=[f"QMD temperature maximum source probe; UTC: {iso(now)}",
           "A MAX percentile is NOT automatically the NWS official daily high.",
           f"Source cycle: {iso(cycle)}"]
    cycle += timedelta(hours=6)
    lines.append(f"Alternative 06Z source cycle: {iso(cycle)}")
    for lead in (18,24,30,42,48,66,72):
        url=source_url(cycle,lead)+".idx"
        try:
            inventory=get(url).decode("utf-8",errors="replace").splitlines()
            filtered=[x for x in inventory if ("max" in x.lower() or "tmax" in x.lower())
                      and ("tmp" in x.lower() or "tmax" in x.lower() or ":MAX:" in x)]
            instant=[x for x in inventory if ":TMP:2 m above ground:" in x]
            max_window=[x for x in inventory if "18 hour" in x.lower() or "max-18h" in x.lower()]
            lines.append(f"f{lead:03d} total idx lines: {len(inventory)}, TMP lines: {len(instant)}, 18h: {len(max_window)}")
            lines.append("Example TMP: "+" | ".join(instant[:4]))
            lines.append(f"\nf{lead:03d}  matching MAX percentiles: {len(filtered)}")
            lines.extend(filtered[:40])
            if not filtered:
                lines.extend([x for x in inventory if ":MAX:" in x or ":TMAX:" in x][:10])
        except Exception as exc:
            lines.append(f"f{lead:03d} ERROR {type(exc).__name__}: {str(exc)[:300]}")
    # Alternative source check: archive of station-based NBM probabilistic text
    # forecasts, which may supply MAX percentile data separately from QMD GRIB2.
    try:
        import json
        from pipeline import get_text
        url="https://mesonet.agron.iastate.edu/api/1/mos.json?station=KBTR&model=NBP"
        response=json.loads(get_text(url))
        lines.append("\nIEM NBP station percentile API availability:")
        lines.append("Root keys: "+str(list(response)[:20]))
        schema=response.get("schema",[])
        lines.append("Columns: "+str([x.get("name",str(x)) if isinstance(x,dict) else str(x) for x in schema][:120]))
        rows=response.get("data",[])
        lines.append("Rows: "+str(len(rows)))
        lines.append("First data sample: "+str(rows[:1])[:1300])
    except Exception as exc:
        lines.append(f"IEM NBP source probe ERROR {type(exc).__name__}: {str(exc)[:250]}")
    out=Path(__file__).resolve().parents[1]/"diagnostics"/"tmax-inventory.txt"
    out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text("\n".join(lines)+"\n",encoding="utf-8")
    print("\n".join(lines[:70]),flush=True)
if __name__=="__main__":
    main()
