#!/usr/bin/env python3
"""
Scraper for tlidb.com, a fan-run Torchlight: Infinite game-data wiki
(same family as poedb.tw -- server-rendered PHP, no public JSON API).

Unlike torchlight.xd.com's patch-notes page, there's no embedded JSON here:
every category listing and item detail page is plain HTML, so this script
parses the DOM directly with BeautifulSoup.

Two content shapes recur across the whole site:
  - "card" listings: <div class="row row-cols..."><div class="col">...
    a linked icon + title + one-line description per entry
  - "table" listings: <table class="... DataTable"><thead>...<tbody>...
    plain rows, columns named by the <th> headers

Detail pages (e.g. /en/Anger, /en/Sparks_of_Moth_Fire) additionally have:
  - one or more named "card" sections (Info, Drop Source, ...)
  - "popupItem" tier blocks: per-level mod/affix text, with in-line
    hyperlinked glossary terms (<e id="NNN" data-bs-title="...">) that are
    collected separately into a site-wide glossary.

Usage:
    # Fast: just crawl category listing pages -> one JSON index per category
    python scrape_tlidb.py --mode listing --out-dir output

    # Full: also follow every entry link and scrape its detail page
    python scrape_tlidb.py --mode full --out-dir output --delay 0.3 --workers 4

    # Limit scope while testing
    python scrape_tlidb.py --mode full --categories Hero,Legendary_Gear --max-detail-pages 50
"""
from __future__ import annotations

import argparse
import concurrent.futures
import json
import re
import sys
import threading
import time
from pathlib import Path
from urllib.parse import unquote, urljoin

import requests
from bs4 import BeautifulSoup

BASE = "https://tlidb.com"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 tlidb-scraper/1.0"
)

# Full category list, scraped from the site nav (/en/... links under each dropdown).
CATEGORIES = [
    "Hero", "Talent", "Inventory", "Legendary_Gear", "Ethereal_Prism", "Recipe",
    "Pactspirit", "Black_Market", "Drop_Source", "Destiny", "Active_Skill",
    "Support_Skill", "Passive_Skill", "Triggered_Skill", "Activation_Medium_Skill",
    "Magnificent_Support_Skill", "Noble_Support_Skill", "Modularization_Skill",
    "Craft", "Corrosion", "Gear_Empowerment", "Dream_Talking", "Blending_Rituals",
    "TOWER_Sequence", "Graft", "Memory_Revival", "Enchant", "Path_of_Achievements",
    "Path_of_Progression", "Dark_Surge_Season", "Season_Pass", "Event", "Codex",
    "Tip", "Hyperlink", "Netherrealm", "Trait_Decks", "Confusion_Card_Library",
    "Void_Chart", "Compass", "Probe", "Season_Compass", "Path_of_the_Brave",
    "Shop", "Outfit", "Commodity", "Boon",
]


class RateLimitedSession:
    """requests.Session wrapper that enforces a minimum delay between requests
    (shared across threads) and caches raw HTML on disk so re-runs resume."""

    def __init__(self, delay: float, cache_dir: Path):
        self.delay = delay
        self.cache_dir = cache_dir
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._last_request = 0.0
        self._session = requests.Session()
        self._session.headers.update({"User-Agent": USER_AGENT})

    def _cache_path(self, url: str) -> Path:
        safe = re.sub(r"[^A-Za-z0-9._-]", "_", url.replace(BASE, ""))[:200]
        return self.cache_dir / f"{safe}.html"

    def get_html(self, url: str, retries: int = 3) -> str:
        cache_path = self._cache_path(url)
        # A 0-byte cache file means a previous run cached a transient empty
        # response instead of a real error -- treat it as missing and retry.
        if cache_path.exists() and cache_path.stat().st_size > 0:
            return cache_path.read_text(encoding="utf-8")

        last_exc = None
        for attempt in range(retries):
            with self._lock:
                wait = self.delay - (time.monotonic() - self._last_request)
                if wait > 0:
                    time.sleep(wait)
                self._last_request = time.monotonic()
            try:
                resp = self._session.get(url, timeout=30)
                resp.raise_for_status()
                resp.encoding = "utf-8"
                if not resp.text.strip():
                    raise requests.RequestException(f"empty response body for {url}")
                cache_path.write_text(resp.text, encoding="utf-8")
                return resp.text
            except requests.RequestException as exc:
                last_exc = exc
                if attempt < retries - 1:
                    time.sleep(1.0 * (attempt + 1))
        raise last_exc


def text_and_links(el, base_url: str) -> tuple[str, list[dict]]:
    links = [
        {"text": a.get_text(strip=True), "href": urljoin(base_url, a["href"])}
        for a in el.select("a[href]")
    ]
    return el.get_text(" ", strip=True), links


def parse_card_entries(pane, base_url: str) -> list[dict]:
    entries = []
    for col in pane.select(".row.row-cols-1 > .col"):
        link_el = col.select_one("a[href]")
        img_el = col.select_one("img")
        desc_el = col.select_one(".flex-grow-1")
        title = None
        if desc_el:
            title_a = desc_el.select_one("a")
            title = title_a.get_text(strip=True) if title_a else None
        text = desc_el.get_text(" ", strip=True) if desc_el else col.get_text(" ", strip=True)
        description = text[len(title):].strip(" |") if title and text.startswith(title) else text
        entries.append(
            {
                "name": title,
                "href": urljoin(base_url, link_el["href"]) if link_el else None,
                "icon": urljoin(base_url, img_el["src"]) if img_el and img_el.get("src") else None,
                "description": description or None,
            }
        )
    return entries


def parse_table_entries(pane, base_url: str) -> list[dict]:
    table = pane.select_one("table")
    if not table:
        return []
    headers = [th.get_text(strip=True) or f"col{i}" for i, th in enumerate(table.select("thead th"))]
    entries = []
    for row in table.select("tbody tr"):
        cells = row.select("td")
        record = {}
        row_links = []
        for i, cell in enumerate(cells):
            key = headers[i] if i < len(headers) else f"col{i}"
            text, links = text_and_links(cell, base_url)
            record[key] = text
            row_links.extend(links)
        if row_links:
            record["_links"] = row_links
        entries.append(record)
    return entries


def parse_tab_panes(soup: BeautifulSoup, base_url: str) -> list[dict]:
    # Pages with more than one section wrap each in <div class="tab-pane">.
    # Pages with exactly one section skip the tab machinery and render a
    # bare <div class="card"> directly, so fall back to that.
    blocks = soup.select(".tab-pane")
    if not blocks:
        blocks = [c for c in soup.select(".card") if c.select_one(".card-header")]

    panes = []
    for pane in blocks:
        header_el = pane.select_one(".card-header")
        header = header_el.get_text(strip=True) if header_el else pane.get("id")
        if pane.select_one("table"):
            entries = parse_table_entries(pane, base_url)
            kind = "table"
        else:
            entries = parse_card_entries(pane, base_url)
            kind = "cards"
        panes.append({"id": pane.get("id"), "title": header, "kind": kind, "entries": entries})
    return panes


def parse_listing_page(html: str, url: str) -> list[dict]:
    soup = BeautifulSoup(html, "lxml")
    return parse_tab_panes(soup, url)


GLOSSARY_LOCK = threading.Lock()


def parse_detail_page(html: str, url: str, glossary: dict) -> dict:
    soup = BeautifulSoup(html, "lxml")
    title_el = soup.select_one("h1")

    # Collect hyperlinked glossary terms (<e id="NNN" data-bs-title="...">Term</e>)
    # into a shared site-wide glossary, since they're a genuine data library
    # of game terminology (buffs, resources, keywords) referenced everywhere.
    with GLOSSARY_LOCK:
        for e in soup.select("e[id]"):
            term_id = e.get("id")
            if term_id in glossary:
                continue
            tooltip = BeautifulSoup(e.get("data-bs-title", ""), "lxml")
            wrapper = tooltip.select_one("div.text-start") or tooltip
            parts = [d.get_text(" ", strip=True) for d in wrapper.find_all("div", recursive=False)]
            glossary[term_id] = {
                "name": parts[0] if parts else e.get_text(strip=True),
                "description": " ".join(parts[1:]) if len(parts) > 1 else None,
            }

    # Named "card" sections (Info / Drop Source / etc.)
    sections = []
    for card in soup.select(".card"):
        header_el = card.select_one(".card-header")
        body_el = card.select_one(".card-body")
        if not header_el or not body_el:
            continue
        text, links = text_and_links(body_el, url)
        sections.append({"title": header_el.get_text(strip=True), "text": text, "links": links or None})

    # Tiered item/skill mod text ("popupItem" cards): one string per level/tier.
    tiers = []
    for item_card in soup.select(".card.ui_item"):
        for tier_row in item_card.select(".tierParent > div"):
            text, links = text_and_links(tier_row, url)
            if text:
                tiers.append({"text": text, "glossary_refs": [e.get("id") for e in tier_row.select("e[id]")] or None})

    # Any nested listings on the page (e.g. a hero page's "Skill Shop" tab).
    nested_panes = parse_tab_panes(soup, url)

    tags = [t.get_text(strip=True) for t in soup.select(".tag")]

    return {
        "url": url,
        "title": title_el.get_text(strip=True) if title_el else None,
        "tags": tags or None,
        "sections": sections or None,
        "tiers": tiers or None,
        "nested_listings": nested_panes or None,
    }


def save_json(obj, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)


def collect_detail_urls(panes: list[dict]) -> set[str]:
    urls = set()
    for pane in panes:
        for entry in pane["entries"]:
            href = entry.get("href")
            if href and href.startswith(BASE):
                urls.add(href)
            for link in entry.get("_links", []) or []:
                if link["href"].startswith(BASE):
                    urls.add(link["href"])
    return urls


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out-dir", default="output_tlidb")
    parser.add_argument("--mode", choices=["listing", "full"], default="listing")
    parser.add_argument("--categories", default="all", help="Comma-separated category slugs, or 'all'")
    parser.add_argument("--delay", type=float, default=0.3, help="Min seconds between requests")
    parser.add_argument("--workers", type=int, default=4, help="Parallel detail-page fetches")
    parser.add_argument("--max-detail-pages", type=int, default=None, help="Cap for testing")
    args = parser.parse_args()

    out_dir = Path(args.out_dir)
    cache_dir = out_dir / "_html_cache"
    session = RateLimitedSession(args.delay, cache_dir)

    categories = CATEGORIES if args.categories == "all" else args.categories.split(",")

    print(f"Crawling {len(categories)} category listing page(s) ...")
    all_detail_urls: set[str] = set()
    for i, cat in enumerate(categories, 1):
        url = f"{BASE}/en/{cat}"
        try:
            html = session.get_html(url)
        except requests.RequestException as exc:
            print(f"  ! {cat}: {exc}", file=sys.stderr)
            continue
        panes = parse_listing_page(html, url)
        save_json(panes, out_dir / "listings" / f"{cat}.json")
        n_entries = sum(len(p["entries"]) for p in panes)
        detail_urls = collect_detail_urls(panes)
        all_detail_urls |= detail_urls
        print(f"  [{i}/{len(categories)}] {cat}: {n_entries} entries, {len(detail_urls)} detail links")

    print(f"\n{len(all_detail_urls)} unique detail page URLs discovered across all categories.")
    save_json(sorted(all_detail_urls), out_dir / "all_detail_urls.json")

    if args.mode == "listing":
        print("Listing-only mode: skipping detail page crawl.")
        return

    urls = sorted(all_detail_urls)
    if args.max_detail_pages:
        urls = urls[: args.max_detail_pages]
    print(f"\nFetching {len(urls)} detail pages with {args.workers} workers ...")

    glossary: dict[str, dict] = {}
    detail_dir = out_dir / "details"
    detail_dir.mkdir(parents=True, exist_ok=True)
    done = 0
    lock = threading.Lock()

    def slug_for(url: str) -> str:
        return unquote(url.rsplit("/", 1)[-1]) or "index"

    def worker(url: str):
        nonlocal done
        out_path = detail_dir / f"{slug_for(url)}.json"
        if out_path.exists():
            with lock:
                done += 1
            return
        try:
            html = session.get_html(url)
            record = parse_detail_page(html, url, glossary)
            save_json(record, out_path)
        except requests.RequestException as exc:
            print(f"  ! {url}: {exc}", file=sys.stderr)
        with lock:
            done += 1
            if done % 25 == 0 or done == len(urls):
                print(f"  {done}/{len(urls)} detail pages done")

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        list(pool.map(worker, urls))

    save_json(glossary, out_dir / "glossary.json")
    print(f"\nDone. {len(urls)} detail pages, {len(glossary)} glossary terms extracted into '{out_dir}/'.")


if __name__ == "__main__":
    main()
