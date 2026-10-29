"""Offline QMD math, inventory, and timestamp consistency tests."""
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from nbm_qmd import (
    LEADS, PERCENTILES, interval_score, parse_index, quantile_loss,
    select_index, source_url, verify, weighted_interval_score,
)


class QMDTests(unittest.TestCase):
    def test_index_offsets_and_excludes_last_unknown_length(self):
        index = parse_index(
            "1:0:d=2026102900:TMP:2 m above ground:24 hour fcst:10% level\n"
            "2:120:d=2026102900:TMP:2 m above ground:24 hour fcst:25% level\n"
            "3:250:d=2026102900:TMP:2 m above ground:24 hour fcst:50% level\n"
            "4:400:d=2026102900:TMP:2 m above ground:24 hour fcst:75% level\n"
        )
        selected = select_index(index)
        self.assertEqual(selected[("tmp",10)][:2], (0,119))
        self.assertEqual(selected[("tmp",50)][:2], (250,399))
        self.assertNotIn(("tmp",75), selected)

    def test_no_accumulated_max_or_min_percentiles(self):
        index = parse_index(
            "1:0:d=20261029:TMP:2 m above ground:24 hour fcst:10% level:18 hour max\n"
            "2:120:d=20261029:TMP:2 m above ground:24 hour fcst:10% level\n"
            "3:240:d=20261029:DPT:2 m above ground:24 hour fcst:90% level\n"
            "4:360:d=20261029:TMP:2 m above ground:24 hour fcst:90% level\n"
        )
        fields = select_index(index)
        self.assertEqual(fields[("tmp",10)][:2], (120,239))
        self.assertEqual(fields[("dpt",90)][:2], (240,359))

    def test_quantile_pinball_loss(self):
        self.assertAlmostEqual(quantile_loss(10,20,0.9),9)
        self.assertAlmostEqual(quantile_loss(20,10,0.9),1)
        self.assertAlmostEqual(quantile_loss(10,10,0.9),0)

    def test_interval_score_penalizes_misses(self):
        self.assertEqual(interval_score(10,20,15,0.2),10)
        self.assertEqual(interval_score(10,20,25,0.2),60)

    def test_wis_nonnegative(self):
        q = {10:10,25:12,50:15,75:18,90:20}
        self.assertGreater(weighted_interval_score(q, 25), weighted_interval_score(q, 15))
        self.assertGreaterEqual(weighted_interval_score(q, 15), 0)

    def test_verify_complete_quantiles_only(self):
        now = datetime(2026,10,29,tzinfo=timezone.utc)
        valid = "2026-10-28T12:00:00Z"
        rows = [
            {"station":"KBTR","element":"tmp","init":"2026-10-28T00:00:00Z",
             "valid":valid,"lead":12,"percentile":p,"value":v}
            for p,v in [(10,68),(25,70),(50,72),(75,74),(90,76)]
        ]
        obs = [{"station":"KBTR","valid":valid,"tmp":73}]
        scores, n, cases = verify(rows,obs,now)
        self.assertEqual(n,1)
        matched=[x for x in scores if x["station"]=="KBTR" and x["days"]==7]
        self.assertEqual(len(matched),1)
        self.assertEqual(matched[0]["n"],1)
        self.assertEqual(matched[0]["coverage80"],100)
        self.assertEqual(matched[0]["coverage50"],100)
        self.assertEqual(matched[0]["p50MAE"],1)
        self.assertGreater(matched[0]["wis"],0)
        rows.pop()
        scores, n, cases = verify(rows,obs,now)
        self.assertEqual(n,0)
        self.assertEqual(scores,[])


    def test_closest_percentile_for_observed_80(self):
        # Example is an instantaneous 2-m temperature observation, NOT Tmax.
        now = datetime(2026, 10, 29, tzinfo=timezone.utc)
        valid = "2026-10-28T12:00:00Z"
        values = ((10,72),(25,76),(50,78),(75,81),(90,84))
        rows = [
            {"station":"KBTR","element":"tmp","init":"2026-10-28T00:00:00Z",
             "valid":valid,"lead":12,"percentile":p,"value":v}
            for p,v in values
        ]
        observations = [{"station":"KBTR","valid":valid,"tmp":80}]
        scores, count, cases = verify(rows, observations, now)
        self.assertEqual(count,1)
        score = next(x for x in scores if x["station"]=="KBTR" and x["days"]==7)
        self.assertEqual(score["closestByMAE"],75)
        self.assertEqual(score["closestMostOften"],75)
        ranked = score["closestRanking"]
        self.assertEqual([x["percentile"] for x in ranked],[75,50,25,90,10])
        self.assertEqual(ranked[0]["mae"],1)
        self.assertEqual(ranked[0]["closestPct"],100)
        self.assertEqual(cases[0]["observed"],80)
        self.assertEqual(cases[0]["forecast"]["75"],81)
        self.assertEqual(cases[0]["closest"],[75])

    def test_closest_percentile_ties_share_credit(self):
        now = datetime(2026, 10, 29, tzinfo=timezone.utc)
        valid = "2026-10-28T12:00:00Z"
        values = ((10,65),(25,70),(50,79),(75,81),(90,90))
        rows = [
            {"station":"KMSY","element":"tmp","init":"2026-10-28T00:00:00Z",
             "valid":valid,"lead":12,"percentile":p,"value":v}
            for p,v in values
        ]
        score_rows, count, details = verify(
            rows, [{"station":"KMSY","valid":valid,"tmp":80}],now)
        self.assertEqual(count,1)
        score=next(x for x in score_rows if x["station"]=="KMSY" and x["days"]==7)
        vals={r["percentile"]:r for r in score["closestRanking"]}
        self.assertEqual(vals[50]["closestPct"],50)
        self.assertEqual(vals[75]["closestPct"],50)
        self.assertEqual(sum(r["closestPct"] for r in vals.values()),100)
        self.assertEqual(details[0]["closest"],[50,75])

    def test_url_construction(self):
        cycle=datetime(2026,10,28,tzinfo=timezone.utc)
        self.assertIn("/blend.20261028/00/qmd/blend.t00z.qmd.f024.co.grib2",source_url(cycle,24))


if __name__ == "__main__":
    unittest.main()
