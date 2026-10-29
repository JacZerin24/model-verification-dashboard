# Guidance / Verify — Gulf South weather model skill

Public, automatically updating, station-based **verification leaderboard** answering:

> Which guidance has been closest to actual observations recently, for this weather element, location and forecast lead?

**Live site:** https://jaczerin24.github.io/model-verification-dashboard/

## The verification-first design

- Select seven-station Gulf South region or KBTR, KMSY, KHDC, KNEW, KASD, KMCB or KGPT individually.
- Choose temperature, dew point, wind speed or gust, past 7/30 days, and matching forecast lead.
- See the **lowest MAE (mean absolute error)** guidance at the top; lower is better.
- Examine bias (positive means too high), percentage of cases with smallest error (ties split credit), trends, lead dependence and station-by-station scores.
- Each model uses the **same station/valid-time cases** in a given lead/element comparison. Sample sizes appear prominently, with **preliminary** labels for fewer than 30 common cases.
- This is not a forecast display. Empty states are explicit until forecasts verify.

## Guidance genuinely supported

| Product | Status | Important distinction |
| --- | --- | --- |
| NBM Short (NBS) | Active | Station text guidance |
| NBM Extended (NBE) | Active at overlapping longer leads | Station text guidance, not the full QMD distribution |
| GFS MOS | Active | Postprocessed statistical guidance, NOT raw deterministic GFS |
| NAM MOS | Active | Postprocessed statistical guidance, NOT raw deterministic NAM |
| Raw GFS, NAM, HRRR, RAP, ECMWF | Planned | Separate GRIB2 point data ingestion needed |
| NBM QMD P05–P95 percentiles | Planned | Actual quantile data required for calibration scores |

Available products vary legitimately by forecast element and lead:
- Temperature, dew point and sustained wind for 0–24 hours: NBS, GFS MOS, NAM MOS. NBE begins at longer leads.
- Temperature, dew point and wind at 24–72 hours and approximately +72h: NBS, NBE, GFS MOS, NAM MOS.
- Wind gust for 24h and beyond where overlapping: NBS and NBE only. Ingested GFS/NAM MOS text has no gust values.
- Lead/element combinations without at least two comparable products are not offered.

## Scientific verification method

1. Archive forecasts by original station, model, **initialization and valid time**. Later cycles never overwrite previous forecast vintages.
2. Use IEM ASOS/METAR values; select the nearest qualifying observation within ±40 minutes (without interpolation).
3. Within each lead-time bucket, use one forecast per model and station/valid time, preferring the forecast lead nearest the bucket midpoint (most recent initialization breaks ties).
4. Only score a common case when **every participating product** has a forecast for the identical station/element/valid time and an observation exists.
5. Compare every model using the same verifying case sample. This replaces earlier potentially misleading unmatched sample rankings.
6. MAE = mean absolute error; RMSE = root mean square error; bias = mean(forecast minus observation). Closest percentage shares tied wins between products.
7. Regional pooled results count station/time pairs, which are not fully spatially independent. Fewer than 30 shared cases are marked preliminary. Even larger samples do not establish statistical significance.

Lead bins do not necessarily compare identical initialization times. Wind representativeness and averaging definitions need additional quality control. The rolling archive retains 35 days, and the dashboard offers the last 7 or 30 days.

## Software

- React + TypeScript + Vite + Recharts frontend in src/
- Standard-library Python collection, matching and scoring in backend/pipeline.py
- Offline unit tests in backend/test_pipeline.py
- Rolling forecast and METAR archives in data/archive/
- Public verification payload in public/data/dashboard.json (fairScores, dailyScores, comparisonProducts)
- Scheduled GitHub workflow in .github/workflows/update-and-deploy.yml, eight times per day

Local setup (Node.js 20+, Python 3.11+):

~~~bash
npm install
npm run dev
python -m unittest discover -s backend -p 'test_*.py' -v
python backend/pipeline.py
npm run build
~~~

## Next scientific milestones

1. **NBM percentiles**: source verified QMD P05–P95 GRIB2 forecasts per station/lead and calculate interval coverage, quantile loss and WIS using actual observations.
2. **Raw deterministic guidance**: extract GFS, NAM, HRRR, RAP and ECMWF at station coordinates, preserving model type, cycle, interpolation and availability time.
3. **Statistical confidence**: uncertainty intervals, stratification by weather regime and season, and more archive history.
4. **More elements**: high/low temperatures and precipitation, with correct valid periods and observation-window definitions.

Source data: https://mesonet.agron.iastate.edu/mos/ and https://mesonet.agron.iastate.edu/request/download.phtml

Independent research, not an official NWS product. Data and GitHub Actions may be late or incomplete.
