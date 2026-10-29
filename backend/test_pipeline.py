"""Fast deterministic tests. No network access required."""
import unittest
from datetime import datetime, timezone

from pipeline import calculate, closest_observation, merge, number, parse_asos, parse_mos


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

    def test_time_tolerance(self):
        obs = [{"valid": "2026-10-21T00:50:00Z", "tmp": 70}]
        self.assertIsNone(closest_observation(obs, "2026-10-21T00:00:00Z", "tmp"))


if __name__ == "__main__":
    unittest.main()
