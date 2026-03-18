#!/usr/bin/env python3
"""Sync selected QQ classic farm mirror pages into nc_local_version.

This script mirrors the active sidebar entries from https://jsq.gptvip.chat/items/05
that are not already maintained locally, downloads their static assets, rewrites
absolute links to local relative paths, and emits a navigation manifest for the
Vue sidebar so future syncs can reuse the same flow.
"""

from __future__ import annotations

import json
import os
import re
import ssl
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from html import unescape
from html.parser import HTMLParser
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
BASE_URL = os.getenv("FARM_TOOLS_MIRROR_BASE", "https://jsq.gptvip.chat").rstrip("/")
DISCOVERY_PATH = "/items/05"
LOCAL_STATIC_PAGES = {
    "/": "index.html",
    "/calculator": "calculator.html",
    "/levels": "levels.html",
    "/plants": "plants.html",
    "/lands": "lands.html",
}
RESOURCE_EXTENSIONS = (
    ".css",
    ".js",
    ".ico",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".svg",
    ".webp",
    ".avif",
)
SECTION_LABEL_DEFAULT = "快捷入口"


@dataclass
class NavItem:
    section: str
    icon: str
    title: str
    href: str
    file: str | None
    locked: bool
    count: int | None


class ResourceParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.resources: set[str] = set()

    def handle_starttag(self, tag: str, attrs) -> None:
        attrs_dict = dict(attrs)
        for attr in ("src", "href", "poster"):
            path = normalize_internal_path(attrs_dict.get(attr, ""))
            if path and should_collect_resource(path):
                self.resources.add(path)


def make_request(path: str) -> urllib.request.Request:
    encoded_path = urllib.parse.quote(path, safe="/:?=&%#")
    return urllib.request.Request(
        BASE_URL + encoded_path,
        headers={
            "User-Agent": "Mozilla/5.0",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        },
    )


def create_ssl_context() -> ssl.SSLContext:
    context = ssl.create_default_context()
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    return context


def fetch(path: str, *, is_html: bool) -> str | bytes | None:
    try:
        with urllib.request.urlopen(make_request(path), context=create_ssl_context()) as response:
            payload = response.read()
        return payload.decode("utf-8") if is_html else payload
    except (urllib.error.URLError, UnicodeDecodeError) as error:
        print(f"[mirror] failed to download {BASE_URL + path}: {error}")
        return None


def normalize_internal_path(path: str) -> str | None:
    path = str(path or "").strip()
    if not path.startswith("/") or path.startswith("//"):
        return None
    if any(token in path for token in ("${", "{%", "<%", "'", "\"", "+")):
        return None
    if re.search(r"\s", path):
        return None
    return path


def should_collect_resource(path: str) -> bool:
    lower_path = path.lower()
    if any(lower_path.endswith(ext) for ext in RESOURCE_EXTENSIONS):
        return True
    return path.startswith("/images/") or path.startswith("/static/")


def local_file_for_path(path: str) -> str:
    if path == "/":
        return "index.html"

    stripped = path.lstrip("/")
    if "." in stripped.rsplit("/", 1)[-1]:
        return stripped
    return f"{stripped}.html"


def save_payload(local_file: str, data: str | bytes, *, is_html: bool) -> None:
    output_path = BASE_DIR / local_file
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = output_path.with_name(f".{output_path.name}.{os.getpid()}.tmp")

    try:
        if is_html:
            temp_path.write_text(str(data), encoding="utf-8")
        else:
            temp_path.write_bytes(data if isinstance(data, bytes) else bytes(data, encoding="utf-8"))
        os.replace(temp_path, output_path)
    finally:
        if temp_path.exists():
            temp_path.unlink()


def rewrite_absolute_paths(html: str, current_path: str) -> str:
    depth = len([part for part in current_path.strip("/").split("/") if part]) - 1
    prefix = "../" * max(depth, 0) if current_path != "/" else "./"

    def replacer(match: re.Match[str]) -> str:
        attr = match.group("attr")
        raw_path = match.group("path")
        normalized = normalize_internal_path(raw_path)
        if not normalized:
            return match.group(0)

        rewritten = local_file_for_path(normalized) if not should_collect_resource(normalized) else normalized.lstrip("/")
        return f'{attr}="{prefix}{rewritten}"'

    html = re.sub(
        r'(?P<attr>href|src|poster|action)="(?P<path>/[^"]*)"',
        replacer,
        html,
    )

    # Remote mirror pages also embed asset paths inside JS/template strings.
    # Those need the same relative rewrite so modal/detail images resolve locally.
    return re.sub(
        r"(?P<quote>[\"'`])(?P<path>/(?:images|static)/)",
        lambda match: f"{match.group('quote')}{prefix}{match.group('path').lstrip('/')}",
        html,
    )


def apply_theme_tweaks(html: str) -> str:
    if "darkMode: 'class'" not in html:
        html = html.replace("tailwind.config = {\n      theme:", "tailwind.config = {\n      darkMode: 'class',\n      theme:", 1)

    replacements = [
        ('<body class="bg-slate-50 text-slate-800 font-sans">', '<body class="bg-transparent text-slate-800 dark:text-slate-200 font-sans">'),
        ("background: #f1f5f9;", "background: var(--glass-bg);"),
        ("background: #94a3b8;", "background: var(--text-muted);"),
        ("background: #64748b;", "background: var(--text-muted);"),
        (".nav-item.active { background: rgba(255,255,255,0.15); }", ".nav-item.active { background: var(--glass-bg); }"),
        (".nav-dot { opacity: 0; width: 4px; border-radius: 2px; background: #4ade80; }", ".nav-dot { opacity: 0; width: 4px; border-radius: 2px; background: rgb(var(--color-primary-400)); }"),
        ("background: linear-gradient(135deg, #22c55e, #16a34a);", "background: linear-gradient(135deg, rgb(var(--color-primary-500)), rgb(var(--color-primary-600)));"),
        ("background: linear-gradient(135deg, #f8fafc, #e2e8f0);", "background: linear-gradient(135deg, var(--glass-bg), var(--glass-border));"),
        (".rarity-2 { color: #22c55e; }", ".rarity-2 { color: rgb(var(--color-primary-500)); }"),
        ("background: linear-gradient(135deg, #dcfce7, #bbf7d0);", "background: linear-gradient(135deg, rgba(var(--color-primary-200), 0.3), rgba(var(--color-primary-300), 0.4));"),
        ("color: #475569 !important;", "color: var(--text-muted) !important;"),
        ("text-decoration-color: #64748b;", "text-decoration-color: var(--text-muted);"),
        ("color: #f1f5f9;", "color: var(--glass-bg);"),
        ("border: 1px solid rgba(255,255,255,0.1);", "border: 1px solid var(--glass-bg);"),
        ("color: #334155;", "color: var(--text-main);"),
        ("border: 1px solid #e2e8f0;", "border: 1px solid var(--glass-border);"),
        ("border-color: #86efac;", "border-color: rgb(var(--color-primary-300));"),
        ("border-color: #4ade80;", "border-color: rgb(var(--color-primary-400));"),
        ("color: #16a34a;", "color: rgb(var(--color-primary-600));"),
    ]

    for source, target in replacements:
        html = html.replace(source, target)

    return html


def collect_literal_resources(html: str) -> set[str]:
    resources: set[str] = set()
    for path in re.findall(r'/(?:images|static)/[^"\'\s)]+', html):
        normalized = normalize_internal_path(path)
        if normalized and should_collect_resource(normalized):
            resources.add(normalized)
    return resources


def parse_sidebar_manifest(html: str) -> list[dict]:
    nav_match = re.search(r"<!-- 导航 -->\s*<nav\b[^>]*>(.*?)</nav>", html, re.S)
    if not nav_match:
        raise RuntimeError("failed to locate sidebar navigation in discovery page")

    nav_html = nav_match.group(1)
    token_re = re.compile(
        r"(<div class=\"pt-3 pb-1 px-3\">.*?</div>\s*</div>|<a\b[^>]*href=\"[^\"]+\"[^>]*>.*?</a>)",
        re.S,
    )

    section_label = SECTION_LABEL_DEFAULT
    items: list[NavItem] = []

    for token in token_re.findall(nav_html):
        if token.startswith("<div class=\"pt-3 pb-1 px-3\">"):
            label_match = re.search(r"uppercase[^>]*>(.*?)</div>", token, re.S)
            if label_match:
                section_label = clean_text(label_match.group(1)) or SECTION_LABEL_DEFAULT
            continue

        anchor_match = re.search(r'<a\b[^>]*href="([^"]+)"[^>]*class="([^"]*)"[^>]*>(.*?)</a>', token, re.S)
        if not anchor_match:
            continue

        href, class_name, inner_html = anchor_match.groups()
        locked = href.startswith("javascript:") or "frozen-nav" in class_name or "🔒" in inner_html
        spans = re.findall(r'<span\b([^>]*)>(.*?)</span>', inner_html, re.S)

        icon = ""
        title = ""
        count = None
        for attrs, content in spans:
            text = clean_text(content)
            if not text:
                continue
            attrs_text = str(attrs)
            if not icon and ("text-lg" in attrs_text or "text-base" in attrs_text) and text != "🔒":
                icon = text
                continue
            if not title and ("truncate" in attrs_text or "font-medium" in attrs_text) and text != "🔒":
                title = text
                continue
            if count is None and text.isdigit():
                count = int(text)

        if not title:
            stripped = [clean_text(text) for _, text in spans]
            meaningful = [value for value in stripped if value and value != "🔒" and not value.isdigit()]
            title = meaningful[1] if len(meaningful) > 1 else (meaningful[0] if meaningful else "")
        if not icon:
            stripped = [clean_text(text) for _, text in spans]
            meaningful = [value for value in stripped if value and value != "🔒" and not value.isdigit()]
            icon = meaningful[0] if meaningful else ""

        file = None if locked else local_file_for_path(href)
        items.append(
            NavItem(
                section=section_label,
                icon=icon,
                title=title,
                href=href,
                file=file,
                locked=locked,
                count=count,
            ),
        )

    grouped: list[dict] = []
    for item in items:
        if not grouped or grouped[-1]["label"] != item.section:
            grouped.append({"id": slugify(item.section), "label": item.section, "items": []})
        grouped[-1]["items"].append(
            {
                "icon": item.icon,
                "title": item.title,
                "href": item.href,
                "file": item.file,
                "locked": item.locked,
                "count": item.count,
            },
        )

    return grouped


def clean_text(value: str) -> str:
    value = re.sub(r"<[^>]+>", "", value)
    value = unescape(value)
    return re.sub(r"\s+", " ", value).strip()


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    if slug:
        return slug
    checksum = sum((index + 1) * ord(char) for index, char in enumerate(value))
    return f"section-{checksum % 10000:04d}"


def write_manifest(sections: list[dict]) -> None:
    manifest = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sourceBaseUrl": BASE_URL,
        "defaultFile": "calculator.html",
        "sections": sections,
    }
    save_payload(
        "manifest.json",
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        is_html=True,
    )


def main() -> None:
    discovery_html = fetch(DISCOVERY_PATH, is_html=True)
    if not discovery_html:
        raise SystemExit("[mirror] unable to fetch discovery page")

    sections = parse_sidebar_manifest(discovery_html)
    write_manifest(sections)

    pages_to_fetch = sorted(
        {
            item["href"]
            for section in sections
            for item in section["items"]
            if item["href"].startswith("/") and not item["locked"] and item["href"] not in LOCAL_STATIC_PAGES
        }
    )

    if not pages_to_fetch:
        print("[mirror] no remote pages need syncing")
        return

    all_resources: set[str] = set()

    for page_path in pages_to_fetch:
        print(f"[mirror] downloading HTML: {page_path}")
        html = fetch(page_path, is_html=True)
        if not html:
            continue

        parser = ResourceParser()
        parser.feed(html)
        all_resources.update(parser.resources)
        all_resources.update(collect_literal_resources(html))

        rewritten = rewrite_absolute_paths(apply_theme_tweaks(html), page_path)
        save_payload(local_file_for_path(page_path), rewritten, is_html=True)

    for resource in sorted(all_resources):
        if not should_collect_resource(resource):
            continue
        local_file = resource.lstrip("/")
        print(f"[mirror] downloading resource: {resource}")
        payload = fetch(resource, is_html=False)
        if payload:
            save_payload(local_file, payload, is_html=False)

    print(f"[mirror] done. synced {len(pages_to_fetch)} pages and {len(all_resources)} resources.")


if __name__ == "__main__":
    main()
