"""Free Google Flights source for Rave Run, wrapping the open-source fast-flights library.

No API key and no account. It reads Google Flights directly, so it is unofficial: it can
break when Google changes its pages, and Google may block or slow cloud servers. The worker
falls back to SerpApi when this fails.

POST /search  {"origin":"BOS","destination":"MIA","outbound":"2027-03-25","return":"2027-03-29",
               "adults":1,"cabin":"economy","currency":"USD"}
  200 {"ok":true,"offers":[...],"url":"https://www.google.com/travel/flights/search?tfs=..."}
  200 {"ok":false,"kind":"blocked|parse|network|bad_request","error":"..."}
GET  /health  {"ok":true,"library":"fast-flights 3.1.0"}
"""

from __future__ import annotations

import json
import logging
import os
import random
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib.metadata import version

from fast_flights import FlightQuery, FlightsNotFound, Passengers, create_query, get_flights

log = logging.getLogger("flights-free")

# Requests to Google are spaced out: one at a time, at least this many seconds apart (+ jitter).
MIN_GAP_SECONDS = float(os.environ.get("MIN_GAP_SECONDS", "5"))
JITTER_SECONDS = float(os.environ.get("JITTER_SECONDS", "3"))
PROXY = os.environ.get("FAST_FLIGHTS_PROXY") or None
CABINS = {"economy": "economy", "premium_economy": "premium-economy", "business": "business", "first": "first"}
IATA = re.compile(r"^[A-Z]{3}$")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

_lock = threading.Lock()
_last_request = 0.0


def _throttle() -> None:
    global _last_request
    wait = _last_request + MIN_GAP_SECONDS + random.uniform(0, JITTER_SECONDS) - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    _last_request = time.monotonic()


class BadRequest(ValueError):
    pass


def validate(body: dict) -> dict:
    origin = str(body.get("origin", "")).upper()
    dest = str(body.get("destination", "")).upper()
    out, ret = str(body.get("outbound", "")), str(body.get("return", ""))
    if not IATA.match(origin) or not IATA.match(dest):
        raise BadRequest("origin and destination must be 3-letter airport codes")
    if not DATE.match(out) or not DATE.match(ret) or ret <= out:
        raise BadRequest("outbound/return must be YYYY-MM-DD with return after outbound")
    adults = int(body.get("adults", 1))
    if not 1 <= adults <= 9:
        raise BadRequest("adults must be 1-9")
    cabin = CABINS.get(str(body.get("cabin", "economy")))
    if not cabin:
        raise BadRequest("unknown cabin")
    currency = str(body.get("currency", "USD")).upper()
    return {"origin": origin, "destination": dest, "outbound": out, "return": ret, "adults": adults, "cabin": cabin, "currency": currency}


def build_query(p: dict):
    return create_query(
        flights=[
            FlightQuery(date=p["outbound"], from_airport=p["origin"], to_airport=p["destination"]),
            FlightQuery(date=p["return"], from_airport=p["destination"], to_airport=p["origin"]),
        ],
        trip="round-trip",
        seat=p["cabin"],
        passengers=Passengers(adults=p["adults"]),
        language="en-US",
        currency=p["currency"],
    )


def to_offer(f, p: dict) -> dict | None:
    """One Google Flights result → a plain dict. Prices on the first page are round-trip totals."""
    if not isinstance(getattr(f, "price", None), (int, float)) or f.price <= 0 or not f.flights:
        return None
    legs = [
        {
            "from": leg.from_airport.code,
            "to": leg.to_airport.code,
            "departs": "%04d-%02d-%02dT%02d:%02d" % (*leg.departure.date, *leg.departure.time),
            "arrives": "%04d-%02d-%02dT%02d:%02d" % (*leg.arrival.date, *leg.arrival.time),
            "minutes": leg.duration,
        }
        for leg in f.flights
    ]
    return {
        "price": f.price,
        "currency": p["currency"],
        "origin": legs[0]["from"] or p["origin"],
        "destination": legs[-1]["to"] or p["destination"],
        "airlines": list(f.airlines or []),
        "stops": max(0, len(legs) - 1),
        "minutes": sum(int(leg["minutes"] or 0) for leg in legs),
        "legs": legs,
    }


def search(body: dict) -> dict:
    try:
        p = validate(body)
    except (BadRequest, ValueError, TypeError) as e:
        return {"ok": False, "kind": "bad_request", "error": str(e)}
    q = build_query(p)
    url = q.url()
    with _lock:
        _throttle()
        try:
            results = get_flights(q, proxy=PROXY)
        except FlightsNotFound:
            return {"ok": True, "offers": [], "url": url}
        except (AttributeError, IndexError, KeyError, TypeError, json.JSONDecodeError) as e:
            # The page had no flight data: a consent page, a bot check, or a Google layout change.
            log.warning("parse failure for %s: %r", url, e)
            return {"ok": False, "kind": "parse", "error": "Google returned a page fast-flights couldn't read (blocked, consent page, or a layout change)", "url": url}
        except Exception as e:  # network errors from primp, etc.
            msg = str(e)
            kind = "blocked" if re.search(r"\b(403|429)\b|captcha|unusual traffic", msg, re.I) else "network"
            log.warning("%s error for %s: %s", kind, url, msg[:300])
            return {"ok": False, "kind": kind, "error": msg[:300], "url": url}
    offers = [o for o in (to_offer(f, p) for f in results) if o]
    return {"ok": True, "offers": offers, "url": url}


class Handler(BaseHTTPRequestHandler):
    server_version = "flights-free/1"

    def _send(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802
        if self.path == "/health":
            self._send(200, {"ok": True, "library": f"fast-flights {version('fast-flights')}"})
        else:
            self._send(404, {"ok": False, "error": "not found"})

    def do_POST(self):  # noqa: N802
        if self.path != "/search":
            return self._send(404, {"ok": False, "error": "not found"})
        try:
            length = min(int(self.headers.get("content-length", "0")), 10_000)
            body = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError):
            return self._send(400, {"ok": False, "kind": "bad_request", "error": "invalid JSON"})
        self._send(200, search(body))

    def log_message(self, fmt, *args):
        log.info("%s %s", self.address_string(), fmt % args)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8080"))
    log.info("flights-free listening on %s:%d (min gap %.1fs)", host, port, MIN_GAP_SECONDS)
    ThreadingHTTPServer((host, port), Handler).serve_forever()


if __name__ == "__main__":
    main()
