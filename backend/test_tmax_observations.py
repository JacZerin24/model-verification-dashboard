"""Period-aware ASOS Tmax observations are never confused with daily CLI highs."""
import unittest
from datetime import datetime, timedelta, timezone

from tmax_observations import (observed_period_max, parse_metar_max_csv,
                               six_hour_max_f)


class TmaxObservationTests(unittest.TestCase):
    def test_six_hour_remarks_and_signed_tenths(self):
        self.assertAlmostEqual(six_hour_max_f("KBTR 281753Z AUTO RMK AO2 10285 20098"), 83.3, places=1)
        self.assertAlmostEqual(six_hour_max_f("KBTR 281753Z AUTO RMK AO2 11012"), 29.84, places=1)
        self.assertIsNone(six_hour_max_f("KBTR 281753Z AUTO RMK AO2"))
        self.assertIsNone(six_hour_max_f("KBTR 281753Z AUTO 10285"))
        self.assertIsNone(six_hour_max_f("KBTR 281753Z AUTO RMK AO2 19999"))

    def test_exact_three_six_hour_groups_for_eighteen_hour_max(self):
        report_times=("2026-10-28T11:53:00Z","2026-10-28T17:53:00Z","2026-10-28T23:53:00Z")
        reports=[{"valid":stamp,"max6h":value} for stamp,value in zip(report_times,(74,84,81))]
        match=observed_period_max(reports,"2026-10-29T00:00:00Z",hours=18)
        self.assertEqual(match["value"],84)
        self.assertEqual(match["periodStart"],"2026-10-28T06:00:00Z")
        self.assertEqual(len(match["synopticReports"]),3)
        self.assertIsNone(observed_period_max(reports[:-1],"2026-10-29T00:00:00Z",hours=18))

    def test_reject_wrong_boundary_and_missing_report(self):
        reports=[{"valid":"2026-10-28T11:53:00Z","max6h":80}]
        self.assertIsNone(observed_period_max(reports,"2026-10-29T00:00:00Z",hours=18))
        with self.assertRaises(ValueError):
            observed_period_max(reports,"2026-10-29T01:00:00Z",hours=18)
        with self.assertRaises(ValueError):
            observed_period_max(reports,"2026-10-29T00:00:00Z",hours=17)

    def test_parse_csv(self):
        source=("station,valid,metar\n"
                "BTR,2026-10-28 11:53,KBTR 281153Z RMK AO2 10200\n"
                "BTR,2026-10-28 17:53,KBTR 281753Z RMK AO2\n")
        found=parse_metar_max_csv(source,"KBTR")
        self.assertEqual(len(found),1)
        self.assertAlmostEqual(found[0]["max6h"],68)
