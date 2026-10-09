#!/usr/bin/env python3
"""Extract reviewed PDF illustrations without changing the source or manifest.

Run with Python 3.9+ and pypdf/Pillow installed:
    python3 scripts/extract-book-illustrations.py
    python3 scripts/extract-book-illustrations.py --check

The committed PNG hashes were generated with pypdf 6.10.0, Pillow 12.3.0,
and zlib 1.2.12. A different encoder producing different bytes fails closed;
do not refresh manifest hashes without reviewing the resulting images.

Default mode creates only missing, verified assets. All entries are validated
before the first write, and an existing file with different bytes is never
overwritten. --check performs the same extraction entirely in memory and also
verifies that every committed output exists with the expected hash/dimensions.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any

try:
    from PIL import Image
    from pypdf import PdfReader
except ImportError as error:
    raise SystemExit("Missing PDF extraction dependency; install pypdf and Pillow.") from error


SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
ID_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = REPO_ROOT / "knowledge/reading/book-illustrations.json"


@dataclass(frozen=True)
class PreparedAsset:
    illustration_id: str
    path: Path
    relative_path: str
    sha256: str
    width: int
    height: int
    png_bytes: bytes


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as stream:
        return json.load(stream)


def positive_int(value: Any, label: str) -> int:
    require(type(value) is int and value > 0, f"{label} must be a positive integer")
    return value


def checked_sha(value: Any, label: str) -> str:
    require(isinstance(value, str) and bool(SHA256_PATTERN.fullmatch(value)), f"{label} is not SHA-256")
    return value


def checked_path(root: Path, value: Any, label: str) -> Path:
    require(isinstance(value, str) and bool(value), f"{label} must be a relative path")
    relative = PurePosixPath(value)
    require(not relative.is_absolute() and ".." not in relative.parts and "\\" not in value,
            f"{label} must remain within the repository")
    resolved = root.joinpath(*relative.parts).resolve()
    require(resolved.is_relative_to(root), f"{label} escapes the repository")
    return resolved


def reading_page_text(root: Path, catalog: dict[str, Any], book: dict[str, Any], page: int) -> str:
    source = read_json(checked_path(root, catalog["text_path"], "text_path"))
    matches = [row for row in source["pages"] if row["page"] == page]
    require(len(matches) == 1, f"{book['book_id']} reading page {page} is absent or duplicated")
    original = matches[0]["text"]
    corrections = read_json(root / "knowledge/reading/text-corrections.json")
    overlays = [row for row in corrections["books"] if row["book_id"] == book["book_id"]]
    require(len(overlays) <= 1, "Duplicate reading correction book")
    if not overlays:
        return original
    overlay = overlays[0]
    require(overlay["source_pdf_sha256"] == book["source_pdf_sha256"], "Reading correction PDF hash mismatch")
    revised = [row for row in overlay["pages"] if row["page"] == page]
    require(len(revised) <= 1, "Duplicate reading correction page")
    if not revised:
        return original
    require(revised[0]["original_text_sha256"] == sha256(original.encode("utf-8")),
            f"Stale reading correction on page {page}")
    return revised[0]["text"]


def prepare_assets(root: Path, manifest: dict[str, Any]) -> list[PreparedAsset]:
    """Verify source identity, exact figure placement, crops and output bytes."""
    root = root.resolve()
    require(type(manifest.get("schema_version")) is int and manifest["schema_version"] == 1,
            "Unsupported illustration manifest schema")
    books = manifest.get("books")
    require(isinstance(books, list) and bool(books), "Manifest books must be a nonempty list")
    library = read_json(root / "knowledge/source/library.json")
    prepared: list[PreparedAsset] = []
    seen_books: set[str] = set()
    seen_ids: set[str] = set()
    seen_paths: set[Path] = set()

    for book in books:
        require(isinstance(book, dict), "Invalid book entry")
        book_id = book.get("book_id")
        require(isinstance(book_id, str) and bool(ID_PATTERN.fullmatch(book_id)), "Invalid book_id")
        require(book_id not in seen_books, f"Duplicate book_id: {book_id}")
        seen_books.add(book_id)
        catalog_rows = [row for row in library["books"] if row["id"] == book_id]
        require(len(catalog_rows) == 1, f"Book is absent or duplicated in library: {book_id}")
        catalog = catalog_rows[0]
        source_hash = checked_sha(book.get("source_pdf_sha256"), "source_pdf_sha256")
        require(catalog["sha256"] == source_hash, f"Library PDF hash mismatch for {book_id}")
        pdf_path = checked_path(root, catalog["pdf_path"], "pdf_path")
        source_bytes = pdf_path.read_bytes()
        require(sha256(source_bytes) == source_hash, f"Source PDF hash mismatch for {book_id}")
        reader = PdfReader(io.BytesIO(source_bytes))
        require(len(reader.pages) == catalog["pdf_pages"], f"Source PDF page count mismatch for {book_id}")
        illustrations = book.get("illustrations")
        require(isinstance(illustrations, list) and bool(illustrations), f"No illustrations for {book_id}")

        for entry in illustrations:
            require(isinstance(entry, dict), "Invalid illustration entry")
            entry_id = entry.get("id")
            require(isinstance(entry_id, str) and bool(ID_PATTERN.fullmatch(entry_id)), "Invalid illustration id")
            require(entry_id not in seen_ids, f"Duplicate illustration id: {entry_id}")
            seen_ids.add(entry_id)
            image_page = positive_int(entry.get("image_pdf_page"), f"{entry_id} image_pdf_page")
            reading_page = positive_int(entry.get("reading_page"), f"{entry_id} reading_page")
            require(image_page <= len(reader.pages) and reading_page <= len(reader.pages),
                    f"{entry_id} refers to a nonexistent distilled PDF/reading page")
            original_pdf_page = positive_int(entry.get("original_pdf_page"), f"{entry_id} original_pdf_page")
            require(original_pdf_page <= catalog["source_page_count"], f"{entry_id} original PDF page out of range")
            positive_int(entry.get("original_book_page"), f"{entry_id} original_book_page")
            heading = entry.get("after_heading")
            require(isinstance(heading, str) and bool(heading.strip()), f"{entry_id} has no exact heading")
            text = reading_page_text(root, catalog, book, reading_page)
            heading_matches = [block for block in text.split("\n\n")
                               if re.sub(r"^#{1,6}\s+", "", block.strip()) == heading]
            require(len(heading_matches) == 1, f"{entry_id} exact reading heading is absent or duplicated")
            require(isinstance(entry.get("caption"), str) and bool(entry["caption"].strip()), f"{entry_id} has no caption")

            image_name = entry.get("source_image_name")
            require(isinstance(image_name, str) and bool(image_name), f"{entry_id} has no source image object")
            image_matches = [image for image in reader.pages[image_page - 1].images if image.name == image_name]
            require(len(image_matches) == 1, f"{entry_id} exact PDF image object is absent or duplicated")
            image = image_matches[0]
            image_hash = checked_sha(entry.get("source_image_sha256"), f"{entry_id} source_image_sha256")
            require(sha256(image.data) == image_hash, f"{entry_id} source image hash mismatch")
            crop = entry.get("crop")
            require(isinstance(crop, list) and len(crop) == 4 and all(type(n) is int for n in crop),
                    f"{entry_id} crop must contain four integers")
            left, top, right, bottom = crop
            require(0 <= left < right <= image.image.width and 0 <= top < bottom <= image.image.height,
                    f"{entry_id} crop exceeds the exact source image")
            width = positive_int(entry.get("width"), f"{entry_id} width")
            height = positive_int(entry.get("height"), f"{entry_id} height")
            require((width, height) == (right - left, bottom - top), f"{entry_id} crop dimensions mismatch")
            asset_hash = checked_sha(entry.get("asset_sha256"), f"{entry_id} asset_sha256")
            expected_path = f"assets/books/{book_id}/figure-p{image_page:03}.png"
            require(entry.get("asset_path") == expected_path, f"{entry_id} unexpected asset path")
            asset_path = checked_path(root, expected_path, "asset_path")
            asset_namespace = root / "assets/books" / book_id
            require(asset_path.is_relative_to(asset_namespace), f"{entry_id} asset namespace is a symlink escape")
            require(asset_path not in seen_paths, f"Duplicate asset output: {expected_path}")
            seen_paths.add(asset_path)

            # Copy only existing pixels; drop metadata and use a fixed lossless PNG encoder.
            cropped = image.image.crop(tuple(crop)).convert("RGB")
            cropped.info.clear()
            output = io.BytesIO()
            cropped.save(output, format="PNG", compress_level=9, optimize=False)
            png_bytes = output.getvalue()
            require(sha256(png_bytes) == asset_hash, f"{entry_id} generated PNG hash mismatch; no files written")
            prepared.append(PreparedAsset(entry_id, asset_path, expected_path, asset_hash, width, height, png_bytes))
    return prepared


def validate_existing_assets(assets: list[PreparedAsset], check: bool) -> None:
    """Preflight the entire output set before writing any missing file."""
    for asset in assets:
        require(not asset.path.is_symlink(), f"Refusing symlink output: {asset.relative_path}")
        if not asset.path.exists():
            require(not check, f"Missing illustration asset: {asset.relative_path}")
            continue
        require(asset.path.is_file(), f"Asset is not a file: {asset.relative_path}")
        existing = asset.path.read_bytes()
        require(sha256(existing) == asset.sha256,
                f"Existing asset differs; refusing overwrite: {asset.relative_path}")
        with Image.open(io.BytesIO(existing)) as image:
            require(image.format == "PNG" and image.size == (asset.width, asset.height),
                    f"Committed PNG dimensions/format mismatch: {asset.relative_path}")


def create_asset_once(asset: PreparedAsset) -> bool:
    """Atomically install a missing PNG without replacing any existing file."""
    if asset.path.exists():
        require(asset.path.is_file() and sha256(asset.path.read_bytes()) == asset.sha256,
                f"Existing asset changed; refusing overwrite: {asset.relative_path}")
        return False
    asset.path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(prefix=f".{asset.path.name}.", suffix=".tmp",
                                         dir=asset.path.parent, delete=False) as stream:
            temporary_path = Path(stream.name)
            stream.write(asset.png_bytes)
            stream.flush()
            os.fsync(stream.fileno())
        temporary_path.chmod(0o644)
        try:
            os.link(temporary_path, asset.path)
        except FileExistsError:
            require(asset.path.is_file() and not asset.path.is_symlink()
                    and sha256(asset.path.read_bytes()) == asset.sha256,
                    f"Asset appeared during extraction; refusing overwrite: {asset.relative_path}")
            return False
        return True
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true", help="Verify sources and all committed PNGs; write nothing")
    args = parser.parse_args()
    try:
        manifest = read_json(DEFAULT_MANIFEST)
        assets = prepare_assets(REPO_ROOT, manifest)
        validate_existing_assets(assets, check=args.check)
        created = 0
        for asset in assets:
            did_create = False if args.check else create_asset_once(asset)
            created += int(did_create)
            status = "checked" if args.check else "created" if did_create else "unchanged"
            print(f"{status}: {asset.relative_path} {asset.width}x{asset.height} "
                  f"{len(asset.png_bytes)} bytes sha256={asset.sha256}")
        print(json.dumps({"mode": "check" if args.check else "extract", "illustrations": len(assets),
                          "created": created, "total_bytes": sum(len(asset.png_bytes) for asset in assets)}))
        return 0
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(f"Illustration extraction failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
