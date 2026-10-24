"""Tests for the sidecar's own logic (fast-flights' network call is mocked)."""

import json
import threading
import unittest
import urllib.request
from http.server import ThreadingHTTPServer
from datetime import date, datetime, timedelta
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


def future(days):
    return (date.today() + timedelta(days=days)).isoformat()


CAL = {"origins": ["JFK", "EWR"], "destinations": ["HND", "NRT"], "from": future(10), "to": future(40), "trip": "round", "nights": 7}


def dp(d, price, ret=None, currency="USD"):
    dates = (datetime.fromisoformat(d),) if ret is None else (datetime.fromisoformat(d), datetime.fromisoformat(ret))
    return NS(date=dates, price=price, currency=currency)


class CalendarTests(unittest.TestCase):
    def setUp(self):
        app._dates = None

    def test_round_trip_filters(self):
        f = app.build_calendar_filters(app.validate_calendar(CAL))
        self.assertEqual(f.trip_type, app.TripType.ROUND_TRIP)
        self.assertEqual(f.stops, app.MaxStops.NON_STOP)
        self.assertEqual(f.duration, 7)
        self.assertEqual([[a[0].name for a in s.departure_airport] for s in f.flight_segments], [["JFK", "EWR"], ["HND", "NRT"]])
        self.assertEqual(f.flight_segments[1].travel_date, future(17))
        self.assertIn("GetCalendarGraph", app.SearchDates.BASE_URL)
        self.assertTrue(f.encode())  # serialises without error

    def test_one_way_filters(self):
        f = app.build_calendar_filters(app.validate_calendar({**CAL, "trip": "one-way", "nights": None}))
        self.assertEqual(f.trip_type, app.TripType.ONE_WAY)
        self.assertEqual(len(f.flight_segments), 1)

    def test_maps_prices_and_drops_bad_rows(self):
        fake = mock.Mock()
        fake.search.return_value = [
            dp(future(12), 1180.0, future(19)),
            dp(future(13), 0, future(20)),
            dp(future(14), 990.0, future(21), currency="JPY"),
            dp(future(90), 700.0, future(97)),
        ]
        with mock.patch.object(app, "SearchDates", return_value=fake):
            r = app.calendar(CAL)
        self.assertEqual(r, {"ok": True, "prices": [{"date": future(12), "return": future(19), "price": 1180.0}]})

    def test_parses_google_wire_format(self):
        inner = json.dumps([None, [[future(12), future(19), [[None, 1234], ""]], [future(13), future(20), [[None], ""]]]])
        body = ")]}'\n\n" + json.dumps([["wrb.fr", None, inner]])
        client = mock.Mock()
        client.post.return_value = NS(text=body, raise_for_status=lambda: None)
        with mock.patch("fli.search.dates.get_client", return_value=client):
            r = app.calendar(CAL)
        self.assertEqual(r["prices"], [{"date": future(12), "return": future(19), "price": 1234.0}])
        self.assertIn("f.req=", client.post.call_args.kwargs["data"])

    def test_unreadable_calendar_is_a_parse_failure(self):
        client = mock.Mock()
        client.post.return_value = NS(text="<html>consent</html>", raise_for_status=lambda: None)
        with mock.patch("fli.search.dates.get_client", return_value=client):
            self.assertEqual(app.calendar(CAL)["kind"], "parse")

    def test_empty_calendar_is_ok(self):
        fake = mock.Mock()
        fake.search.return_value = []
        with mock.patch.object(app, "SearchDates", return_value=fake):
            self.assertEqual(app.calendar(CAL), {"ok": True, "prices": []})

    def test_blocked(self):
        fake = mock.Mock()
        fake.search.side_effect = RuntimeError("HTTP 429 Too Many Requests")
        with mock.patch.object(app, "SearchDates", return_value=fake):
            self.assertEqual(app.calendar(CAL)["kind"], "blocked")

    def test_calendar_validation(self):
        for bad in [
            {**CAL, "origins": "JFK"},
            {**CAL, "origins": ["XXX"]},
            {**CAL, "to": future(80)},
            {**CAL, "nights": 0},
            {**CAL, "trip": "multi"},
        ]:
            self.assertEqual(app.calendar(bad)["kind"], "bad_request", bad)


class HttpTests(unittest.TestCase):
    def test_http_endpoints(self):
        srv = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{srv.server_address[1]}"
        try:
            health = json.load(urllib.request.urlopen(base + "/health"))
            self.assertTrue(health["ok"])
            self.assertIn("fast-flights", health["library"])
            self.assertIn("flights 0.9.0", health["library"])
            req = urllib.request.Request(base + "/search", data=json.dumps(BODY).encode(), headers={"content-type": "application/json"})
            with mock.patch.object(app, "get_flights", return_value=[NONSTOP]):
                r = json.load(urllib.request.urlopen(req))
            self.assertEqual(r["offers"][0]["price"], 427)
        finally:
            srv.shutdown()


if __name__ == "__main__":
    unittest.main()
