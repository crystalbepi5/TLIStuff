#!/usr/bin/env python3
"""
Scraper for the Torchlight: Infinite SS13 patch notes page
(https://torchlight.xd.com/ss13pn/).

The page is a static, server-rendered single-page article. There are no
XHR/fetch calls at runtime -- all of the underlying data is baked directly
into the HTML as <script type="application/json"> blocks:

  - i18n-data-{zh-CN,zh-TW,en,ko}  -> full text content per language,
                                       keyed by kNNNN ids referenced via
                                       data-i18n="kNNNN" attributes in the DOM
  - i18n-term-pop-data             -> MT glossary/term translation metadata

In addition, every game icon in the page is referenced via
data-icon-key="<category>:<name>" alongside its image asset path, which
this script also collects into a lookup table.

By default only the English ("en") slice of the data is written out. The
raw server-rendered DOM text is always Chinese (client-side JS swaps it to
the selected language after load), so titles/alt-text here are resolved
against the chosen language's i18n dict rather than scraped from the DOM.

Usage:
    python scrape_torchlight.py [--url URL] [--out-dir DIR] [--lang en]
    python scrape_torchlight.py --all-languages   # dump every language
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

DEFAULT_URL = "https://torchlight.xd.com/ss13pn/?lang=en"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)
LANGUAGES = ("zh-CN", "zh-TW", "en", "ko")


def fetch_html(url: str) -> str:
    resp = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=30)
    resp.raise_for_status()
    # The server doesn't send a charset in Content-Type, so requests falls
    # back to ISO-8859-1 per HTTP spec even though the page is UTF-8
    # (see its <meta charset="utf-8">). Force UTF-8 to avoid mojibake.
    resp.encoding = "utf-8"
    return resp.text


def extract_json_scripts(soup: BeautifulSoup) -> dict[str, dict]:
    """Pull every <script id="..." type="application/json"> block and parse it."""
    data = {}
    for tag in soup.find_all("script", attrs={"type": "application/json"}):
        script_id = tag.get("id")
        if not script_id or not tag.string:
            continue
        try:
            data[script_id] = json.loads(tag.string)
        except json.JSONDecodeError as exc:
            print(f"  ! skipped {script_id}: not valid JSON ({exc})", file=sys.stderr)
    return data


def filter_term_pop_data(data: dict, lang: str) -> dict:
    """Collapse the multi-language glossary down to a single language."""
    filtered_terms = {}
    for term, entry in data.get("terms", {}).items():
        filtered_terms[term] = {
            "label": entry.get("labels", {}).get(lang, entry.get("source", {}).get("label")),
            "aliases": entry.get("aliases", {}).get(lang, []),
            "body": entry.get("body", {}).get(lang, entry.get("source", {}).get("body")),
        }
    return {**{k: v for k, v in data.items() if k != "terms"}, "lang": lang, "terms": filtered_terms}


def extract_icon_map(soup: BeautifulSoup, base_url: str, i18n: dict) -> list[dict]:
    """Collect data-icon-key -> asset path for every icon image in the page."""
    icons = []
    seen = set()
    for img in soup.find_all("img", attrs={"data-icon-key": True}):
        key = img["data-icon-key"]
        category, _, name = key.partition(":")
        src = img.get("src", "")
        entry = (key, src)
        if entry in seen:
            continue
        seen.add(entry)
        alt_key = img.get("data-i18n-alt")
        icons.append(
            {
                "key": key,
                "category": category,
                "name": name,
                "asset_base": img.get("data-icon-base"),
                "src": src,
                "src_url": urljoin(base_url, src) if src else None,
                "alt": i18n.get(alt_key, img.get("alt")) if alt_key else img.get("alt"),
            }
        )
    return icons


def extract_outline(soup: BeautifulSoup, i18n: dict) -> list[dict]:
    """Build a chapter/sub-chapter outline: id, i18n key, and resolved title."""
    outline = []
    for chapter in soup.select(".chapter"):
        title_el = chapter.select_one(".section-title")
        title_key = title_el.get("data-i18n") if title_el else None
        chapter_entry = {
            "id": chapter.get("id"),
            "i18n_key": title_key,
            "title": i18n.get(title_key, title_el.get_text(strip=True) if title_el else None),
            "subchapters": [],
        }
        for sub in chapter.select(".subch"):
            sub_title_el = sub.select_one(".subch-title")
            sub_title_key = sub_title_el.get("data-i18n") if sub_title_el else None
            chapter_entry["subchapters"].append(
                {
                    "id": sub.get("id"),
                    "i18n_key": sub_title_key,
                    "title": i18n.get(
                        sub_title_key, sub_title_el.get_text(strip=True) if sub_title_el else None
                    ),
                }
            )
        outline.append(chapter_entry)
    return outline


def save_json(obj, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
    print(f"  wrote {path} ({path.stat().st_size:,} bytes)")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default=DEFAULT_URL, help="Page URL to scrape")
    parser.add_argument(
        "--out-dir", default="output", help="Directory to write JSON files into"
    )
    parser.add_argument(
        "--lang", default="en", choices=LANGUAGES, help="Language to extract (default: en)"
    )
    parser.add_argument(
        "--all-languages",
        action="store_true",
        help="Dump every language's i18n data instead of just --lang",
    )
    args = parser.parse_args()

    out_dir = Path(args.out_dir)
    raw_dir = out_dir / "raw"
    derived_dir = out_dir / "derived"

    print(f"Fetching {args.url} ...")
    html = fetch_html(args.url)
    soup = BeautifulSoup(html, "lxml")

    print("Extracting embedded JSON data-library blocks ...")
    json_blocks = extract_json_scripts(soup)

    i18n_key = f"i18n-data-{args.lang}"
    i18n = json_blocks.get(i18n_key, {})
    if not i18n:
        print(f"  ! no i18n data found for lang={args.lang!r}", file=sys.stderr)

    if args.all_languages:
        for lang in LANGUAGES:
            key = f"i18n-data-{lang}"
            if key in json_blocks:
                save_json(json_blocks[key], raw_dir / f"{key}.json")
    else:
        save_json(i18n, raw_dir / f"{i18n_key}.json")

    if "i18n-term-pop-data" in json_blocks:
        term_data = filter_term_pop_data(json_blocks["i18n-term-pop-data"], args.lang)
        save_json(term_data, raw_dir / f"i18n-term-pop-data-{args.lang}.json")

    print("Building icon lookup table ...")
    icons = extract_icon_map(soup, args.url, i18n)
    save_json(icons, derived_dir / "icon-map.json")

    print("Building chapter/sub-chapter outline ...")
    outline = extract_outline(soup, i18n)
    save_json(outline, derived_dir / "outline.json")

    print(f"\nDone. lang={args.lang!r}, {len(icons)} icons, "
          f"{len(outline)} chapters extracted into '{out_dir}/'.")


if __name__ == "__main__":
    main()
