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
| NBM QMD P10/P25/P50/P75/P90 | Pilot collector implemented | Real GRIB2 byte-range extraction; verified percentile scores display only when complete cases exist |

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


## Historical backfill and why a new installation initially showed one day

The original GitHub Actions collector only requested the latest MOS forecast run, so the first day's verification archive was tiny even when a 7/30-day filter was selected. The separate **Backfill 30 days of archived station verification** workflow uses IEM's documented historical MOS endpoint (original model runs and timestamps) and downloads up to 35 days of ASOS reports. It is idempotent and can be manually rerun under Actions. Backfilled cases are actual historical forecasts, not synthetic or hindsight-reconstructed forecasts.

The continuously running workflow still adds newly issued runs; the leaderboard preserves its common-case sample requirements.

## Verification time-series chart

The NBM percentile page now leads with a station-specific **observed-versus-guidance time series**. The X axis is verifying valid time (Central Time); the Y axis is temperature or dew point in °F. Default traces are a thick observed line, NBM P50, and all available NBM Short/Extended, GFS MOS and NAM MOS traces, with semi-transparent P10–P90 and P25–P75 ranges. Users can turn bands off, reveal P10/P25/P75/P90 as individual lines, and click the legend chips to hide or restore any line. Hover/tap a date for all forecasts and their absolute errors versus the observation. On mobile, the plot scrolls horizontally rather than shrinking into illegibility.

This is a **fixed-lead, one-station** chart, not a spliced multi-station or multi-lead spaghetti plot. Forecast lead is selectable at +12, +24, +36, or +48 hours. Model guidance is joined **only** when station, variable, original initialization, and valid time exactly match the QMD case. A missing product remains missing; no newer or different-lead forecasts are substituted. MOS labels are explicit to prevent confusing the GFS/NAM MOS text products with raw deterministic GFS/NAM.

The main leaderboard remains directly under the chart, followed by real observed-versus-forecast example cases and calibration/WIS metrics. The available QMD source still verifies *instantaneous 2-m* temperature/dew point rather than a station's daily high; daily Tmax is a separate future dataset.

## Which NBM percentile has been closest to observations?

The percentile page now also ranks **P10, P25, P50, P75 and P90 by mean absolute error** against each station's observed instantaneous 2-m temperature/dew point. For each station/element/+12,+24,+36,+48h/7- or 30-day group, it also reports the percentage of cases on which each percentile was closest (with tied cases splitting credit), signed bias and actual recent validating observations beside each percentile prediction.

Ranking percentiles as point forecasts is **descriptive**, not a proper assessment of quantile skill. Probabilistic calibration (observed fraction below each percentile, P10–P90/P25–P75 interval coverage, quantile loss and WIS) remains a separate component below the accuracy leaderboard.

**Daily high temperatures (Tmax) are not yet included.** An observed high of 80°F must be verified against the matching 12/24-hour NBM maximum-temperature percentile field and a station maximum from that same interval. Instantaneous 2-m temperature at +12h is not a substitute for Tmax. See issue #3 for the next dataset.

## NBM QMD percentile verification (first implementation)

The independent **Archive and verify NBM QMD percentiles** workflow collects the actual 00Z QMD GRIB2 CONUS fields from the public NOAA AWS archive. It uses the .idx inventory and HTTP range downloads rather than whole CONUS files. The initial scope is P10/P25/P50/P75/P90 for 2-m temperature and dew point, at +12, +24, +36 and +48 hours, sampled at seven LIX-area airports by nearest grid point.

Files: backend/nbm_qmd.py, backend/test_qmd.py, .github/workflows/nbm-qmd.yml. The 00Z GRIB may not be available until several hours after initialization. The workflow defaults to validating one previous cycle and supports an explicit 1–30 cycle backfill in the GitHub Actions manual dispatch.

After complete five-quantile sets are matched to observed METAR temperature/dew point values within 40 minutes, public/data/qmd.json publishes empirical P10–P90 and P25–P75 coverage (nominal 80/50%), rank/PIT-style empirical CDF checks at P10/P25/P50/P75/P90, P50 MAE/bias, quantile loss and weighted interval score. The percentile page does **not** manufacture results when the archived QMD fields have not decoded successfully or no observations have verified.

Scientific notes: the QMD P50 point forecast is not necessarily identical to NBM deterministic guidance; 00Z QMD is not comparable with hourly MOS without matching issuance/availability and verifying windows. Only compare proper scores over identical cases. A low number of cases is preliminary.

## Next scientific milestones

1. **NBM percentiles**: source verified QMD P05–P95 GRIB2 forecasts per station/lead and calculate interval coverage, quantile loss and WIS using actual observations.
2. **Raw deterministic guidance**: extract GFS, NAM, HRRR, RAP and ECMWF at station coordinates, preserving model type, cycle, interpolation and availability time.
3. **Statistical confidence**: uncertainty intervals, stratification by weather regime and season, and more archive history.
4. **More elements**: high/low temperatures and precipitation, with correct valid periods and observation-window definitions.

Source data: https://mesonet.agron.iastate.edu/mos/ and https://mesonet.agron.iastate.edu/request/download.phtml

Independent research, not an official NWS product. Data and GitHub Actions may be late or incomplete.
