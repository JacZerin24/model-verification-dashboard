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
    for lead in (12,24,36,48,60,72):
        url=source_url(cycle,lead)+".idx"
        try:
            inventory=get(url).decode("utf-8",errors="replace").splitlines()
            filtered=[x for x in inventory if (
                ("max" in x.lower() or "tmax" in x.lower())
                and ("tmp" in x.lower() or "max:" in x.lower() or "tmax" in x.lower())
                and ("% level" in x.lower() or "percentile" in x.lower()))]
            lines.append(f"\nf{lead:03d}  matching MAX percentiles: {len(filtered)}")
            lines.extend(filtered[:40])
            if not filtered:
                lines.extend([x for x in inventory if ":MAX:" in x or ":TMAX:" in x][:10])
        except Exception as exc:
            lines.append(f"f{lead:03d} ERROR {type(exc).__name__}: {str(exc)[:300]}")
    out=Path(__file__).resolve().parents[1]/"diagnostics"/"tmax-inventory.txt"
    out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text("\n".join(lines)+"\n",encoding="utf-8")
    print("\n".join(lines[:70]),flush=True)
if __name__=="__main__":
    main()
