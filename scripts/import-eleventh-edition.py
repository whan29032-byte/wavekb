#!/usr/bin/env python3
"""Import the exact user-provided eleventh edition without rewriting its PDF.

Python 3.9+, pypdf 6.10.0, Pillow and pdftoppm are required. Default mode
creates only the missing original-page scans, exact PDF copy and source JSON.
All existing outputs must already match; different files are never overwritten.
--check reads all 321 pages/assets and regenerates JSON in memory, with no writes.
The text layer is an extraction, not a claim of complete OCR/human verification.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import os
import re
import shutil
import struct
import subprocess
import sys
import tempfile
from collections import Counter
from pathlib import Path

import pypdf
from PIL import Image
from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
BOOK_ID = "elliott-wave-principle-eleventh-edition"
SOURCE_ID = "ewp-11-zh-2021"
SOURCE_SHA256 = "ecd3904b0ebd8b37dc57844b2cb8ef5365e84465874f922a7ad8cc5a73c91073"
PAGE_COUNT = 321
DPI = 160
PDF_PATH = f"assets/books/{BOOK_ID}.pdf"
TEXT_PATH = f"knowledge/source/book-text/{BOOK_ID}.json"
DESKTOP_SOURCE = Path("/Users/youyou/Desktop/艾略特波浪理论市场行为的关键（原书第11版） (普莱切特) (Z-Library).pdf")
# These 32 scans were absent at the reviewed baseline. No other missing scan may
# be silently regenerated, and the 289 existing scans are never overwritten.
CREATABLE_SCAN_PAGES = frozenset([
    *range(1, 15), 19, *range(23, 30), 46, 50, 53, 55, 58, 59, 66, 67, 80, 321,
])
RUNNING_HEADERS = frozenset([
    "艾略特波浪理论", "第一章 总体概念", "第二章 波浪构造准则",
    "第三章 波浪理论的历史背景与数学背景", "第四章 比率分析与斐波那契时间数列",
    "第五章 长期浪及最新的合成走势图", "第六章 股票与商品",
    "第七章 股市的其他分析手段及其与波浪理论的关系", "第八章 艾略特演说",
    "附录", "词汇表", "原出版者后记",
])
PRINTED_PAGE = re.compile(r"^(?:—\s*\d+\s*—|[IVXLCDM]+)$")
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
# Source-font recovery is scoped to the pinned PDF and these exact text layers.
# The unembedded AdobeMyungjoStd-Medium Type0 font uses Adobe/Korea1 Supplement2
# and Identity-H, without ToUnicode. CID 0x000E (14) is U+002D in Adobe-Korea1.
# pypdf therefore emits SO for the minus sign. Rendering without that language
# pack leaves a gap; deleting it would concatenate operands and corrupt formulas.
MATH_MINUS_PAGES = {
    134: ("67ed4b3df687eb81e0f4216feae2bf1ec8d35996967c1327ce5b0ea62bcecb4a", 4),
    139: ("788ce1a08272626d3a0effdcf86677838b2a3cde00d8c8c89084861b81f18993", 1),
    179: ("7d3ded78eea28abeb840535e8cbe526f0fece08aa3c6f1576bb3e3489d85a83c", 6),
    188: ("ed7c4914d875c4d86a94107813a31aca6d551fd5ecbbd1bc2e3f9c532c695460", 5),
    189: ("4e0fe55fb6e95ab50892bcf87042a5e8812758ba266548a1f88be3b30686a903", 4),
}
REVIEWED_PRE_MINUS_JSON_SHA256 = "8fa2d3c35e74961b7ac059232428d4d7e0436cb2d1c0f4bae16f51461f6176e8"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def repo_path(relative: str) -> Path:
    path = ROOT.joinpath(relative).resolve()
    require(path.is_relative_to(ROOT), f"Repository path escapes through a symlink: {relative}")
    return path


def png_dimensions(data: bytes, label: str) -> tuple[int, int]:
    require(data[:8] == PNG_SIGNATURE and data[12:16] == b"IHDR", f"Invalid PNG: {label}")
    require(len(data) > 24, f"Truncated PNG: {label}")
    width, height = struct.unpack(">II", data[16:24])
    require(width > 0 and height > 0, f"Empty PNG: {label}")
    with Image.open(io.BytesIO(data)) as image:
        require(image.format == "PNG" and image.size == (width, height), f"PNG dimensions disagree: {label}")
        image.verify()
    return width, height


def cleaned_text(raw: str, page_number: int) -> tuple[str, dict]:
    raw_controls = Counter(f"U+{ord(char):04X}" for char in raw
                           if (ord(char) < 32 and char not in "\n\r\t") or 127 <= ord(char) <= 159)
    require(set(raw_controls).issubset({"U+0007", "U+000E"}),
            f"Unreviewed control character on PDF page {page_number}")
    text = raw
    mapped_math = []
    if page_number in MATH_MINUS_PAGES:
        expected_hash, expected_count = MATH_MINUS_PAGES[page_number]
        require(digest(raw.encode("utf-8")) == expected_hash and raw.count("\x0e") == expected_count,
                f"Reviewed mathematical font mapping changed on PDF page {page_number}")
        text = text.replace("\x0e", "-")
        mapped_math.append({
            "source_codepoint": "U+000E",
            "replacement": "-",
            "count": expected_count,
            "evidence": "AdobeMyungjoStd-Medium Identity-H / Adobe-Korea1 Supplement2 CID 14 -> U+002D; exact PDF and raw-text hashes checked",
        })
    require("\x0e" not in text, f"Unreviewed mathematical font code on PDF page {page_number}")
    # BEL occurs only at the start of the 79 reviewed list items in pages110-117.
    # Unknown/inline BEL is rejected, not silently stripped as a generic control.
    if "\x07" in text:
        require(110 <= page_number <= 117 and all(
            not line.count("\x07") or (line.lstrip().startswith("\x07") and line.count("\x07") == 1)
            for line in text.splitlines()
        ), f"Unreviewed list marker position on PDF page {page_number}")
    removed = Counter({"U+0007": text.count("\x07")}) if "\x07" in text else Counter()
    text = text.replace("\x07", "")
    lines = [line.rstrip() for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n")]
    while lines and not lines[0].strip():
        lines.pop(0)
    removed_headers: list[str] = []
    # A running header is removed ONLY when immediately paired with a standalone
    # printed page-number line. Actual chapter opening titles are kept.
    if len(lines) >= 2:
        header = re.sub(r"\s+", " ", lines[0].strip())
        if header in RUNNING_HEADERS and PRINTED_PAGE.fullmatch(lines[1].strip()):
            removed_headers = lines[:2]
            lines = lines[2:]
    text = "\n".join(lines).strip()
    status = "text_layer_extracted" if text else "image_only"
    if not text:
        text = "[本页无可提取文字，请查看原页。]"
    return text, {
        "status": status,
        "raw_text_sha256": digest(raw.encode("utf-8")),
        "raw_control_characters": dict(sorted(raw_controls.items())),
        "removed_control_characters": dict(sorted(removed.items())),
        "mapped_math_characters": mapped_math,
        "removed_running_header_lines": removed_headers,
        "human_review": "not_complete",
    }


def make_document(reader: PdfReader, scans: dict[int, bytes]) -> dict:
    pages = []
    for number, page in enumerate(reader.pages, start=1):
        scan_path = f"assets/source-pages/page-{number:03}.png"
        scan = scans[number]
        width, height = png_dimensions(scan, scan_path)
        source_width, source_height = float(page.mediabox.width), float(page.mediabox.height)
        require(page.rotation == 0, f"Unexpected PDF page rotation: {number}")
        expected = (math.ceil(source_width * DPI / 72), math.ceil(source_height * DPI / 72))
        require((width, height) == expected, f"Original-page scan dimensions mismatch at PDF page {number}")
        text, extraction = cleaned_text(page.extract_text() or "", number)
        pages.append({
            "page": number,
            "text": text,
            "extraction": extraction,
            "source_page_size_points": [source_width, source_height],
            "source_image": {
                "id": f"image-ewp-11-source-page-{number:03}",
                "asset_path": scan_path,
                "asset_sha256": digest(scan),
                "source_id": SOURCE_ID,
                "edition": 11,
                "authority": "primary",
                "figure_type": "source_page_scan",
                "pdf_page": number,
                "caption": f"第11版原书 PDF 第 {number} 页原页扫描（非重绘）",
                "width": width,
                "height": height,
            },
        })
    require(len(pages) == PAGE_COUNT, "Source page count changed")
    return {
        "schema_version": 1,
        "book_id": BOOK_ID,
        "source_id": SOURCE_ID,
        "edition": 11,
        "source_pdf": PDF_PATH,
        "source_pdf_sha256": SOURCE_SHA256,
        "text_extraction": {
            "tool": "pypdf",
            "version": "6.10.0",
            "page_count": PAGE_COUNT,
            "human_review": "not_complete",
            "policy": "保留逐页全文与原页顺序；仅删除已核对的行首BEL列表标记及明确页眉与紧随其后的独立印刷页码。5个指定PDF页的20个SO由原字体Adobe-Korea1 CID14映射为ASCII减号，受源PDF和原text哈希门禁保护；其他控制码或页上数学码拒绝处理。不摘要、不推断换行、不改理论或数字。无可提取文字的页使用明确占位并保留原页。",
            "source_image_dpi": DPI,
        },
        "pages": pages,
    }


def assert_existing_matches(path: Path, data: bytes) -> None:
    if path.exists():
        require(path.is_file() and path.read_bytes() == data, f"Refusing to overwrite a different existing file: {path.relative_to(ROOT)}")


def create_only(path: Path, data: bytes, scratch: Path) -> bool:
    if path.exists():
        assert_existing_matches(path, data)
        return False
    require(path.parent.exists(), f"Output directory is missing: {path.parent}")
    with tempfile.NamedTemporaryFile(dir=scratch, prefix="verified-eleventh-", delete=False) as stream:
        temporary = Path(stream.name)
        try:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
            os.chmod(temporary, 0o644)
        except BaseException:
            temporary.unlink(missing_ok=True)
            raise
    try:
        # Same-filesystem hard link creates an output atomically, with no replace.
        try:
            os.link(temporary, path)
            return True
        except FileExistsError:
            assert_existing_matches(path, data)
            return False
    finally:
        temporary.unlink(missing_ok=True)


def refresh_reviewed_derived_text(path: Path, data: bytes, scratch: Path, expected_old_sha: str) -> bool:
    """Replace only this self-generated JSON, once, after an exact old-byte gate."""
    require(path == repo_path(TEXT_PATH) and expected_old_sha == REVIEWED_PRE_MINUS_JSON_SHA256,
            "Derived-text refresh is not the reviewed one-time correction")
    require(path.is_file() and digest(path.read_bytes()) == expected_old_sha,
            "Derived-text refresh old SHA-256 mismatch; no file replaced")
    with tempfile.NamedTemporaryFile(dir=scratch, prefix="reviewed-minus-text-", delete=False) as stream:
        temporary = Path(stream.name)
        try:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
            os.chmod(temporary, 0o644)
        except BaseException:
            temporary.unlink(missing_ok=True)
            raise
    try:
        require(digest(path.read_bytes()) == expected_old_sha, "Derived JSON changed during refresh; no file replaced")
        os.replace(temporary, path)
        return True
    finally:
        temporary.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Verify the complete import without writing any file")
    parser.add_argument("--source-pdf", type=Path, help="Exact original PDF; the pinned SHA-256 remains mandatory")
    parser.add_argument("--refresh-derived-text-with-sha", metavar="OLD_SHA256",
                        help="One-time mathematical font correction of only the reviewed self-generated JSON")
    args = parser.parse_args()
    require(not (args.check and args.refresh_derived_text_with_sha), "--check never allows refresh/write options")
    require(pypdf.__version__ == "6.10.0", "Text extraction is pinned to pypdf 6.10.0; do not silently change the extractor")
    destination_pdf = repo_path(PDF_PATH)
    destination_text = repo_path(TEXT_PATH)
    source_path = args.source_pdf or (DESKTOP_SOURCE if DESKTOP_SOURCE.exists() else destination_pdf)
    require(source_path.is_file(), "The original eleventh-edition PDF is unavailable")
    source_bytes = source_path.read_bytes()
    require(digest(source_bytes) == SOURCE_SHA256, "Original PDF SHA-256 mismatch; no output was written")
    reader = PdfReader(io.BytesIO(source_bytes))
    require(len(reader.pages) == PAGE_COUNT, "Original PDF must have exactly 321 pages")
    assert_existing_matches(destination_pdf, source_bytes)
    scans: dict[int, bytes] = {}
    missing = []
    for number in range(1, PAGE_COUNT + 1):
        scan = repo_path(f"assets/source-pages/page-{number:03}.png")
        if scan.is_file():
            scans[number] = scan.read_bytes()
        else:
            require(number in CREATABLE_SCAN_PAGES, f"An existing protected scan is missing: PDF page {number}")
            missing.append(number)
    if args.check:
        require(not missing, f"Original-page scans are incomplete: {missing}")
        require(destination_pdf.is_file() and destination_text.is_file(), "Import outputs are missing")
        document = make_document(reader, scans)
        expected_json = (json.dumps(document, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        require(destination_text.read_bytes() == expected_json, "Source JSON is stale or its extraction/scan hashes changed")
        print(json.dumps({"mode": "check", "created": 0, "pages": PAGE_COUNT,
                          "source_pdf_sha256": SOURCE_SHA256,
                          "status_counts": dict(Counter(page["extraction"]["status"] for page in document["pages"]))}, ensure_ascii=False))
        return
    renderer = shutil.which("pdftoppm")
    require(bool(renderer) or not missing, "pdftoppm is required for missing original-page scans")
    scratch_root = repo_path("tmp/pdfs")
    scratch_root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="eleventh-import-", dir=scratch_root) as temporary:
        scratch = Path(temporary)
        # Render only authorized missing pages, always from the pinned PDF.
        for number in missing:
            prefix = scratch / f"page-{number:03}"
            subprocess.run([renderer, "-r", str(DPI), "-png", "-f", str(number), "-l", str(number),
                            "-singlefile", str(source_path), str(prefix)], check=True, capture_output=True)
            scans[number] = prefix.with_suffix(".png").read_bytes()
        document = make_document(reader, scans)
        expected_json = (json.dumps(document, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        # Validate every asset and every already-existing destination before the
        # first durable output. Existing 289 scans are only read.
        if args.refresh_derived_text_with_sha:
            require(not missing and destination_pdf.is_file(), "Derived-text refresh requires all original assets already present")
            require(args.refresh_derived_text_with_sha == REVIEWED_PRE_MINUS_JSON_SHA256
                    and destination_text.is_file()
                    and digest(destination_text.read_bytes()) == REVIEWED_PRE_MINUS_JSON_SHA256,
                    "Derived-text refresh is limited to the exact reviewed old JSON; no output was written")
            # Every scan remains the exact one bound in the old JSON, not merely
            # an arbitrary PNG with valid dimensions; refresh never rewrites it.
            previous = json.loads(destination_text.read_bytes())
            require(previous.get("source_pdf_sha256") == SOURCE_SHA256
                    and len(previous.get("pages", [])) == PAGE_COUNT
                    and all(old["source_image"] == new["source_image"]
                            for old, new in zip(previous["pages"], document["pages"])),
                    "Derived-text refresh original-asset bindings changed")
        else:
            assert_existing_matches(destination_text, expected_json)
        outputs = [(destination_pdf, source_bytes), (destination_text, expected_json)] + [
            (repo_path(f"assets/source-pages/page-{number:03}.png"), scans[number]) for number in missing
        ]
        for path, data in outputs:
            require(path.parent.is_dir(), f"Output directory is missing: {path.parent}")
            if path != destination_text or not args.refresh_derived_text_with_sha:
                assert_existing_matches(path, data)
        created = sum(
            refresh_reviewed_derived_text(path, data, scratch, args.refresh_derived_text_with_sha)
            if path == destination_text and args.refresh_derived_text_with_sha
            else create_only(path, data, scratch)
            for path, data in outputs
        )
        print(json.dumps({"mode": "import", "created": created, "new_scans": missing,
                          "pages": PAGE_COUNT, "source_pdf_sha256": SOURCE_SHA256,
                          "status_counts": dict(Counter(page["extraction"]["status"] for page in document["pages"]))}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print(f"Eleventh-edition import refused: {error}", file=sys.stderr)
        sys.exit(1)
