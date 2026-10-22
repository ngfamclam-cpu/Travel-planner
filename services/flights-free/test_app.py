"""Tests for the sidecar's own logic (fast-flights' network call is mocked)."""

import json
import threading
import unittest
import urllib.request
from http.server import ThreadingHTTPServer
from types import SimpleNamespace as NS
from unittest import mock

import app

app.MIN_GAP_SECONDS = 0
app.JITTER_SECONDS = 0


def leg(frm, to, d, dep, arr, minutes):
    return NS(from_airport=NS(code=frm), to_airport=NS(code=to), departure=NS(date=d, time=dep), arrival=NS(date=d, time=arr), duration=minutes)


NONSTOP = NS(price=427, airlines=["American"], flights=[leg("BOS", "MIA", (2027, 3, 25), (8, 0), (11, 39), 219)])
ONESTOP = NS(price=389, airlines=["Delta"], flights=[leg("BOS", "ATL", (2027, 3, 25), (6, 0), (9, 0), 180), leg("ATL", "FLL", (2027, 3, 25), (10, 10), (12, 10), 120)])
BODY = {"origin": "bos", "destination": "MIA", "outbound": "2027-03-25", "return": "2027-03-29"}


class SearchTests(unittest.TestCase):
    def test_maps_offers(self):
        with mock.patch.object(app, "get_flights", return_value=[NONSTOP, ONESTOP, NS(price=0, airlines=[], flights=[])]):
            r = app.search(BODY)
        self.assertTrue(r["ok"])
        self.assertIn("google.com/travel/flights/search?tfs=", r["url"])
        self.assertEqual([o["price"] for o in r["offers"]], [427, 389])
        self.assertEqual(r["offers"][0]["stops"], 0)
        self.assertEqual(r["offers"][1], {**r["offers"][1], "origin": "BOS", "destination": "FLL", "stops": 1, "minutes": 300})
        self.assertEqual(r["offers"][0]["legs"][0]["departs"], "2027-03-25T08:00")

    def test_round_trip_query(self):
        q = app.build_query(app.validate(BODY))
        self.assertEqual(q.get_trip_type(), "round-trip")
        self.assertEqual([(f.from_airport.airport, f.to_airport.airport, f.date) for f in q.flight_data], [("BOS", "MIA", "2027-03-25"), ("MIA", "BOS", "2027-03-29")])

    def test_no_flights_is_ok_and_empty(self):
        with mock.patch.object(app, "get_flights", side_effect=app.FlightsNotFound("none")):
            self.assertEqual(app.search(BODY)["offers"], [])

    def test_unreadable_page_is_a_parse_failure(self):
        with mock.patch.object(app, "get_flights", side_effect=AttributeError("'NoneType' object has no attribute 'text'")):
            r = app.search(BODY)
        self.assertEqual((r["ok"], r["kind"]), (False, "parse"))

    def test_blocked(self):
        with mock.patch.object(app, "get_flights", side_effect=RuntimeError("HTTP status 429 Too Many Requests")):
            self.assertEqual(app.search(BODY)["kind"], "blocked")

    def test_validation(self):
        for bad in [{**BODY, "origin": "BOSTON"}, {**BODY, "return": "2027-03-20"}, {**BODY, "adults": 12}, {**BODY, "cabin": "lie-flat"}]:
            self.assertEqual(app.search(bad)["kind"], "bad_request")


class HttpTests(unittest.TestCase):
    def test_http_endpoints(self):
        srv = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{srv.server_address[1]}"
        try:
            health = json.load(urllib.request.urlopen(base + "/health"))
            self.assertTrue(health["ok"])
            self.assertIn("fast-flights", health["library"])
            req = urllib.request.Request(base + "/search", data=json.dumps(BODY).encode(), headers={"content-type": "application/json"})
            with mock.patch.object(app, "get_flights", return_value=[NONSTOP]):
                r = json.load(urllib.request.urlopen(req))
            self.assertEqual(r["offers"][0]["price"], 427)
        finally:
            srv.shutdown()


if __name__ == "__main__":
    unittest.main()
