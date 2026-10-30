"""Core checks with synthetic candles: python -m unittest discover -s strategy/tests"""
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from aurum_strategy import config, profile, setups, trades, timeutil  # noqa: E402
from aurum_strategy.data import Bar  # noqa: E402

ms = lambda *a: int(datetime(*a, tzinfo=timezone.utc).timestamp() * 1000)


class TimeTests(unittest.TestCase):
    def test_ny_offset_follows_us_daylight_time(self):
        self.assertEqual(timeutil.ny_offset_hours(ms(2026, 10, 30, 12)), -4)   # before 1 Nov 2026
        self.assertEqual(timeutil.ny_offset_hours(ms(2026, 11, 2, 12)), -5)
        self.assertEqual(timeutil.ny_offset_hours(ms(2026, 3, 9, 12)), -4)     # after 8 Mar 2026

    def test_killzones_on_new_york_clock(self):
        self.assertEqual(timeutil.killzone(ms(2026, 10, 30, 7, 0)), "london")  # 03:00 NY (EDT)
        self.assertEqual(timeutil.killzone(ms(2026, 10, 30, 12, 0)), "ny")     # 08:00 NY
        self.assertIsNone(timeutil.killzone(ms(2026, 10, 30, 16, 0)))


class ProfileTests(unittest.TestCase):
    def test_poc_value_area_and_side_split(self):
        bars = [Bar(i, 100, 101, 99.5, 101) for i in range(20)] + [Bar(99, 100, 105, 99.5, 99.5)]
        p = profile.build(bars)
        self.assertTrue(99.5 <= p.poc <= 101)
        self.assertLessEqual(p.val, p.poc)
        self.assertGreaterEqual(p.vah, p.poc)
        self.assertGreater(p.node_at(100).buy_pct, 0.9)        # closes at the high: buyers
        self.assertLess(p.node_at(104.5).buy_pct, 0.1)         # only the bearish bar reached it


class TradeTests(unittest.TestCase):
    def setUp(self):
        self.t0 = ms(2026, 10, 30, 8)  # London session, cap 30

    def bars(self, path):
        return [Bar(self.t0 + i * 300_000, p, max(p, q), min(p, q), q) for i, (p, q) in enumerate(zip(path, path[1:]))]

    def test_stop_wider_than_session_cap_is_skipped(self):
        r = trades.plan("X", "buy", self.t0, 4000, 3995.5, 4010, "x")     # 48 pips with buffer
        self.assertIsInstance(r, str)

    def test_ladder_with_partials_and_break_even(self):
        tr = trades.plan("X", "buy", self.t0, 4000, 3998.3, 4020, "x")
        self.assertNotIsInstance(tr, str)
        trades.simulate(tr, self.bars([4000, 4002.5, 4005.5, 3999.5]))  # TP1 and TP2, then back below entry
        self.assertEqual(tr.status, "tp2")
        self.assertAlmostEqual(tr.result_pips, (20 + 50 + 0) / 3, places=1)

    def test_stop_before_tp1_is_a_full_loss(self):
        tr = trades.plan("X", "sell", self.t0, 4000, 4001.2, 3990, "x")
        trades.simulate(tr, self.bars([4000, 4001, 4003]))
        self.assertEqual(tr.status, "sl")
        self.assertAlmostEqual(tr.result_pips, -tr.sl_pips, places=1)


class CrtTests(unittest.TestCase):
    def test_sweep_of_high_then_m5_break_gives_sell(self):
        # A: H4 opening 21:00 NY (01:00 UTC, EDT); B: opening 01:00 NY sweeps A's high and closes inside.
        start = ms(2026, 10, 27, 1)
        m5 = [Bar(start + i * 300_000, 4000, 4010 if i == 10 else 4005, 3995 if i == 20 else 3999, 4002) for i in range(48)]
        b0 = start + 4 * 3_600_000
        m5 += [Bar(b0 + i * 300_000, 4002, 4013 if i == 5 else 4006, 4001, 4004) for i in range(48)]
        c0 = b0 + 4 * 3_600_000
        m5 += [Bar(c0, 4004, 4005, 4003, 4004), Bar(c0 + 300_000, 4004, 4004.5, 4000, 4000.5), Bar(c0 + 600_000, 4000.5, 4001, 3999, 4000)]
        sig = list(setups.crt_signals(m5))
        self.assertEqual(len(sig), 1)
        side, t, entry, inval, target, _ = sig[0]
        self.assertEqual((side, t, entry, target), ("sell", c0 + 600_000, 4000.5, 3995))
        self.assertEqual(inval, 4006)   # highest high of the swing bars plus the breaking bar


if __name__ == "__main__":
    unittest.main()
