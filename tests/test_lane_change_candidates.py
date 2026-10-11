"""Regression checks for screen-space lane crossing decisions."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from detect_lane_change_candidates import find_crossings  # noqa: E402


def track(offsets, line_positions):
    return [
        {
            'frame': i,
            'time': i / 2,
            'box': [.4, .4, .5, .5],
            'marking': {
                'vehicle_x': offset + line,
                'vehicle_y': .5,
                'line_x': line,
                'offset': offset,
            },
        }
        for i, (offset, line) in enumerate(zip(offsets, line_positions))
    ]


class LaneCrossingTests(unittest.TestCase):
    def test_sustained_crossing_of_same_line_is_candidate(self):
        samples = track([-.10, -.08, -.05, .05, .08, .10], [.5] * 6)
        found = find_crossings({1: samples}, 2)
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]['review_status'], 'unverified')

    def test_switching_to_neighboring_line_is_not_crossing(self):
        samples = track([-.04] * 3 + [.04] * 3, [.62] * 3 + [.54] * 3)
        self.assertEqual(find_crossings({1: samples}, 2), [])

    def test_broken_track_is_not_crossing(self):
        samples = track([-.10, -.08, -.05, .05, .08, .10], [.5] * 6)
        samples[3]['frame'] = 6
        self.assertEqual(find_crossings({1: samples}, 2), [])


if __name__ == '__main__':
    unittest.main()
