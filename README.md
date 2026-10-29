# Model Verification Lab · Gulf South

A station-focused, automatically updating model verification website for the NWS New Orleans/Baton Rouge area. Built with React, TypeScript, Vite, a Python standard-library collector/verifier, GitHub Actions, and GitHub Pages.

**Status: v0.1 deterministic-style station guidance verification.** The website does not claim NBM QMD percentile verification or raw HRRR/GFS skill results. QMD ingestion is a future phase.

## Website and first-time setup

After Pages is enabled and a workflow has completed:

https://jaczerin24.github.io/model-verification-dashboard/

1. Open repository **Settings → Pages → Build and deployment**, select **GitHub Actions** for Source. This one-time setting cannot be enabled using the standard workflow token.
2. Open **Actions → Update verification data and publish dashboard → Run workflow**, or let the initial push run automatically.
3. Watch the workflow logs for data source and deployment status. The dashboard initially contains **no invented data**; verification scores appear when archived forecasts reach their valid times and observations arrive.

## Implemented

- Seven stations: KBTR, KMSY, KHDC, KNEW, KASD, KMCB, KGPT
- NBM Short (IEM NBS), NBM Extended (NBE), GFS MOS, and NAM MOS
- 2-m temperature, dew point (degrees Fahrenheit), wind speed and gust (knots)
- Forecast run/valid time stored per station forecast vintage; no rewriting older forecasts with new runs
- IEM ASOS/METAR observations, matched to nearest report within ±40 minutes, without interpolation
- MAE, RMSE, bias and sample sizes for 7/30-day windows and lead-time bins
- Interactive station/element/time/lead filters, model ranking, recent forecast traces and CSV export
- Automated schedule eight times daily (scheduled Actions may be delayed)

## Sources and scientific limitations

- IEM MOS: https://mesonet.agron.iastate.edu/mos/
- IEM ASOS/METAR: https://mesonet.agron.iastate.edu/request/download.phtml
- NOAA NBM: https://vlab.noaa.gov/web/mdl/nbm

**GFS MOS and NAM MOS are postprocessed station forecasts, not raw GFS/NAM output.** NBS/NBE are NBM text guidance, not gridded QMD percentile forecasts. There is no inferred NBM P10/P90 coverage in this release.

Error = forecast minus observation; MAE = mean absolute error; RMSE = root mean squared error; bias = mean error. Each product currently has its own available verifying sample, so cross-model skill rankings are descriptive rather than common-case skill comparisons. The JSON archive retains a rolling 35 days; displayed scores cover 7 or 30 days. Times are UTC in the archive and America/Chicago in the UI.

The nearest available METAR within ±40 minutes verifies each valid time. Missing data is excluded. Gust and sustained wind forecasts may have averaging and station-exposure differences; this MVP does not adjust for them. Daily extrema and QPF are not yet scored because their verification periods require special treatment.

## Local development

Requirements: Python 3.11+ and Node 20+.

~~~bash
npm install
npm run dev
python -m unittest discover -s backend -p "test_*.py" -v
python backend/pipeline.py             # requires internet
python backend/pipeline.py --offline  # process existing archive
npm run build
~~~

The dev frontend loads public/data/dashboard.json. The GitHub Actions workflow generates this JSON, commits the rolling station archive, builds the frontend, and deploys the built site to Pages.

## Planned milestones

1. Validate per-station field completeness, surface source health, and add **common-case** intermodel comparisons.
2. Add raw deterministic HRRR/RAP/GFS point extraction from archived GRIB2 datasets.
3. Ingest NBM QMD P05–P95 quantiles by cycle and projection; calculate nominal interval coverage, calibration/PIT, quantile loss and WIS from real quantiles.
4. Add seasonal and weather-regime diagnostics and scalable archival storage.

Independent research preview. Not an official NWS operational product. Source data and scheduled jobs can be delayed.
