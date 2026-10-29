"""Fast deterministic tests. No network access required."""
import unittest
from datetime import datetime, timezone

from pipeline import calculate, calculate_fair, closest_observation, merge, number, parse_asos, parse_mos


class PipelineTests(unittest.TestCase):
    def test_numeric_missing(self):
        self.assertIsNone(number(-99, "tmp"))
        self.assertIsNone(number("M", "wsp"))
        self.assertIsNone(number(999, "gst"))
        self.assertEqual(number("72", "tmp"), 72)

    def test_mos_original_run_and_lead(self):
        payload = {"data": [{
            "runtime_utc": "2026-10-20T00:00:00Z", "ftime_utc": "2026-10-21T00:00:00Z",
            "tmp": 72, "dpt": 60, "wsp": 8, "gst": "-99",
        }]}
        rows = parse_mos(payload, "KBTR", "NBS")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["lead"], 24)
        self.assertEqual(rows[0]["init"], "2026-10-20T00:00:00Z")
        self.assertIsNone(rows[0]["gst"])

    def test_asos_parsing(self):
        csvtext = "station,valid,tmpf,dwpf,sknt,gust\nBTR,2026-10-21 00:00,70,58,7,M\n"
        obs = parse_asos(csvtext, "KBTR")
        self.assertEqual(obs[0]["tmp"], 70)
        self.assertIsNone(obs[0]["gst"])

    def test_keep_original_forecast_runs(self):
        old = [{"station": "KBTR", "model": "NBS", "init": "2026-10-20T00:00:00Z",
                "valid": "2026-10-21T00:00:00Z", "tmp": 72}]
        new = [{"station": "KBTR", "model": "NBS", "init": "2026-10-20T12:00:00Z",
                "valid": "2026-10-21T00:00:00Z", "tmp": 70}]
        merged = merge(old, new, ("station", "model", "init", "valid"), "2026-10-01")
        self.assertEqual(len(merged), 2)

    def test_verification_and_bias_sign(self):
        f = [{"station": "KBTR", "model": "NBS", "init": "2026-10-20T00:00:00Z",
              "valid": "2026-10-21T00:00:00Z", "lead": 24, "tmp": 73,
              "dpt": None, "wsp": None, "gst": None}]
        o = [{"station": "KBTR", "valid": "2026-10-21T00:05:00Z", "tmp": 70}]
        scores, _, _, _, matched = calculate(f, o, datetime(2026, 10, 22, tzinfo=timezone.utc))
        self.assertEqual(matched, 1)
        score = next(x for x in scores if x["lead"] == "24-48" and x["days"] == 7)
        self.assertEqual(score["bias"], 3)
        self.assertEqual(score["mae"], 3)


    def test_common_case_requires_all_models(self):
        from datetime import datetime, timezone
        base = {"station": "KBTR", "valid": "2026-10-21T00:00:00Z",
                "lead": 24, "tmp": 70}
        forecasts = [{**base, "model": model,
                      "init": "2026-10-20T00:00:00Z"}
                     for model in ("NBS", "NBE", "GFS")]
        obs = [{"station": "KBTR", "valid": base["valid"], "tmp": 70}]
        scores, daily, count = calculate_fair(forecasts, obs, datetime(2026,10,22,tzinfo=timezone.utc))
        self.assertEqual(scores, [])
        self.assertEqual(count, 0)

    def test_common_case_scores_identical_samples_and_wins(self):
        from datetime import datetime, timezone
        base = {"station": "KBTR", "valid": "2026-10-21T00:00:00Z",
                "lead": 24, "init": "2026-10-20T00:00:00Z"}
        fcsts = [{**base, "model": model, "tmp": val}
                 for model, val in (("NBS",72), ("NBE",75), ("GFS",73), ("NAM",69))]
        observations = [{"station": "KBTR", "valid": base["valid"], "tmp": 70}]
        scores, daily, count = calculate_fair(fcsts, observations, datetime(2026,10,22,tzinfo=timezone.utc))
        sample = [row for row in scores if row["station"] == "KBTR"
                  and row["element"] == "tmp" and row["days"] == 7
                  and row["lead"] == "24-48"]
        self.assertEqual(count, 1)
        self.assertEqual(len(sample), 4)
        self.assertEqual({row["n"] for row in sample}, {1})
        self.assertEqual(next(x["mae"] for x in sample if x["model"]=="NAM"), 1)
        self.assertEqual(next(x["winRate"] for x in sample if x["model"]=="NAM"), 100)
        self.assertTrue(any(x["station"] == "ALL" for x in scores))

    def test_common_case_selects_nearest_lead_center(self):
        from datetime import datetime, timezone
        valid = "2026-10-21T00:00:00Z"
        fcsts = [{"station": "KBTR", "valid": valid, "lead": 24, "tmp": 99,
                  "model": "NBS", "init": "2026-10-20T00:00:00Z"},
                 {"station": "KBTR", "valid": valid, "lead": 35, "tmp": 71,
                  "model": "NBS", "init": "2026-10-19T13:00:00Z"}]
        for model in ("NBE", "GFS", "NAM"):
            fcsts.append({"station": "KBTR", "valid": valid, "lead": 36, "tmp": 70,
                          "model": model, "init": "2026-10-19T12:00:00Z"})
        obs = [{"station": "KBTR", "valid": valid, "tmp": 70}]
        scores, _, _ = calculate_fair(fcsts, obs, datetime(2026,10,22,tzinfo=timezone.utc))
        nbs = next(x for x in scores if x["station"]=="KBTR"
                   and x["model"]=="NBS" and x["element"]=="tmp"
                   and x["lead"]=="24-48" and x["days"]==7)
        self.assertEqual(nbs["mae"], 1)


    def test_short_range_compares_three_available_products(self):
        from datetime import datetime, timezone
        valid = "2026-10-21T00:00:00Z"
        fcsts = [{"station":"KBTR","valid":valid,"init":"2026-10-20T12:00:00Z",
                  "lead":12,"model":m,"tmp":v}
                 for m,v in (("NBS",70),("GFS",72),("NAM",69))]
        observations = [{"station":"KBTR","valid":valid,"tmp":70}]
        scores, _, count = calculate_fair(fcsts, observations, datetime(2026,10,22,tzinfo=timezone.utc))
        short = [x for x in scores if x["station"]=="KBTR" and x["days"]==7
                 and x["element"]=="tmp" and x["lead"]=="12-24"]
        self.assertEqual(count, 1)
        self.assertEqual(len(short), 3)
        self.assertEqual({x["model"] for x in short}, {"NBS","GFS","NAM"})

    def test_wind_gust_compares_nbm_products_only(self):
        from datetime import datetime, timezone
        valid="2026-10-21T00:00:00Z"
        forecasts=[{"station":"KBTR","valid":valid,"init":"2026-10-20T00:00:00Z",
                    "lead":24,"model":m,"gst":value}
                   for m,value in (("NBS",14),("NBE",18))]
        observations=[{"station":"KBTR","valid":valid,"gst":15}]
        scores, _, count=calculate_fair(forecasts, observations, datetime(2026,10,22,tzinfo=timezone.utc))
        gust=[x for x in scores if x["station"]=="KBTR" and x["days"]==7
              and x["element"]=="gst" and x["lead"]=="24-48"]
        self.assertEqual(count,1)
        self.assertEqual(len(gust),2)
        self.assertEqual(gust[0]["model"],"NBS")

    def test_time_tolerance(self):
        obs = [{"valid": "2026-10-21T00:50:00Z", "tmp": 70}]
        self.assertIsNone(closest_observation(obs, "2026-10-21T00:00:00Z", "tmp"))


if __name__ == "__main__":
    unittest.main()
