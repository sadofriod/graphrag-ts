"""Local stdlib-only smoke test for the free paper-status endpoint."""

import json
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import urlopen


ENDPOINT = "https://pay-hk.ashesborn.cloud/api/v1/judge/paper"


def main():
    if len(sys.argv) != 3 or sys.argv[1] not in {"doi", "paper_id"}:
        print("Usage: python verify.py doi <DOI> | paper_id <OpenAlex-ID>")
        return 2
    key, value = sys.argv[1], sys.argv[2]
    url = f"{ENDPOINT}?{urlencode({key: value})}"
    try:
        with urlopen(url, timeout=20) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        print(f"Status request failed with HTTP {error.code}.")
        return 1
    except (URLError, TimeoutError, ValueError) as error:
        print(f"Status request failed: {error}")
        return 1

    paper = payload.get("paper") or {}
    statuses = payload.get("statuses") or []
    sources = {item.get("source") for item in statuses if item.get("source")}
    asserting = {item.get("source") for item in statuses if item.get("source") and item.get("is_retracted")}
    print(f"{paper.get('title') or 'Untitled paper'} — {len(asserting)} of {len(sources)} sources assert a retraction")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
