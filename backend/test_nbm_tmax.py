"""Offline verification tests for true 18h daytime maximum percentile fields."""
import unittest
from datetime import datetime, timezone
from nbm_tmax import select_max_index, build_period_observations, count_distinct_observed_windows

class TmaxQmdTests(unittest.TestCase):
    def test_max_fields_exact_statistical_window(self):
        rows=[
          ("d=2026102906:TMP:2 m above ground:6-24 hour max fcst:10% level",0,9),
          ("d=2026102906:TMP:2 m above ground:6-24 hour max fcst:25% level",10,19),
          ("d=2026102906:TMP:2 m above ground:6-24 hour max fcst:50% level",20,29),
          ("d=2026102906:TMP:2 m above ground:6-24 hour max fcst:75% level",30,39),
          ("d=2026102906:TMP:2 m above ground:6-24 hour max fcst:90% level",40,49),
          ("d=2026102906:TMP:2 m above ground:24 hour fcst:90% level",50,59),
          ("d=2026102906:TMP:2 m above ground:12-24 hour max fcst:90% level",60,69),
        ]
        fields=select_max_index(rows,24)
        self.assertEqual(set(fields),{10,25,50,75,90})
        self.assertEqual(fields[90][:2],(40,49))
        self.assertEqual(select_max_index(rows,48),{})

    def test_unique_observed_windows_not_double_counted_across_cycles(self):
        cases=[
            {"station":"KBTR","valid":"2026-10-29T06:00:00Z","init":"2026-10-28T06:00:00Z"},
            {"station":"KBTR","valid":"2026-10-29T06:00:00Z","init":"2026-10-27T06:00:00Z"},
            {"station":"KMSY","valid":"2026-10-29T06:00:00Z","init":"2026-10-28T06:00:00Z"},
        ]
        self.assertEqual(count_distinct_observed_windows(cases),2)
        self.assertEqual(count_distinct_observed_windows([]),0)

    def test_period_obs_requires_all_six_hour_reports(self):
        period="2026-10-29T06:00:00Z"
        forecasts=[{"station":"KBTR","valid":period,"init":"2026-10-28T06:00:00Z",
                   "element":"tmp","percentile":p}
                   for p in (10,25,50,75,90)]
        observed=[
           {"station":"KBTR","valid":"2026-10-28T17:53:00Z","max6h":78},
           {"station":"KBTR","valid":"2026-10-28T23:53:00Z","max6h":81},
           {"station":"KBTR","valid":"2026-10-29T05:53:00Z","max6h":80},
        ]
        rows,windows=build_period_observations(forecasts,observed)
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["tmp"],81)
        self.assertEqual(windows[("KBTR",period)]["periodStart"],"2026-10-28T12:00:00Z")
        rows,windows=build_period_observations(forecasts,observed[:2])
        self.assertEqual(rows,[])
        self.assertEqual(windows,{})

if __name__=="__main__":
    unittest.main()
