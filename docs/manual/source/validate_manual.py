from __future__ import annotations

import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps
from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[3]
PDFS = [
    ROOT / "docs/manual/system-user-manual.pdf",
    ROOT / "docs/manual/role-manuals/owner.pdf",
    ROOT / "docs/manual/role-manuals/admin.pdf",
    ROOT / "docs/manual/role-manuals/agent.pdf",
]
RENDERED = ROOT / "tmp/pdfs-final"
CONTACTS = ROOT / "tmp/pdf-contacts"
FONT = ROOT / "src/app/fonts/Sarabun-Regular.ttf"

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def validate_pdf(path: Path) -> list[str]:
    reader = PdfReader(str(path))
    issues: list[str] = []
    if not reader.pages:
        issues.append("ไม่มีหน้า")
    for number, page in enumerate(reader.pages, 1):
        text = (page.extract_text() or "").strip()
        if len(text) < 20:
            issues.append(f"หน้า {number} มีข้อความน้อยผิดปกติ ({len(text)} ตัวอักษร)")
        if number > 1 and not re.search(r"[ก-๙]", text):
            issues.append(f"หน้า {number} ไม่พบข้อความภาษาไทยที่สกัดได้")
        box = page.mediabox
        if abs(float(box.width) - 595.276) > 2 or abs(float(box.height) - 841.89) > 2:
            issues.append(f"หน้า {number} ไม่ใช่ A4")
    if not reader.outline:
        issues.append("ไม่มี Bookmark")
    text_all = "\n".join((p.extract_text() or "") for p in reader.pages)
    for secret_pattern in (r"sk-[A-Za-z0-9]{12,}", r"TYPHOON_API_KEY\s*=", r"TELEGRAM_BOT_TOKEN\s*="):
        if re.search(secret_pattern, text_all):
            issues.append(f"พบรูปแบบข้อมูลลับ: {secret_pattern}")
    print(f"{path.relative_to(ROOT)} | {len(reader.pages)} หน้า | Bookmark {len(reader.outline)} รายการ | ปัญหา {len(issues)}")
    for issue in issues:
        print(f"  - {issue}")
    return issues


def contact_sheet(prefix: str) -> Path:
    files = sorted(RENDERED.glob(f"{prefix}-*.png"), key=lambda p: int(p.stem.rsplit("-", 1)[-1]))
    thumb = (330, 467)
    label_h = 28
    columns = 3
    rows = (len(files) + columns - 1) // columns
    canvas = Image.new("RGB", (thumb[0] * columns, (thumb[1] + label_h) * rows), "#D8E2EC")
    draw = ImageDraw.Draw(canvas)
    label_font = ImageFont.truetype(str(FONT), 18)
    for index, file in enumerate(files):
        image = Image.open(file).convert("RGB")
        fitted = ImageOps.contain(image, thumb)
        x = (index % columns) * thumb[0] + (thumb[0] - fitted.width) // 2
        y = (index // columns) * (thumb[1] + label_h)
        canvas.paste(fitted, (x, y))
        draw.text((x + 5, y + thumb[1] + 3), f"หน้า {index + 1}", font=label_font, fill="#102A43")
    CONTACTS.mkdir(parents=True, exist_ok=True)
    target = CONTACTS / f"{prefix}.png"
    canvas.save(target, optimize=True)
    return target


if __name__ == "__main__":
    problem_count = 0
    for pdf in PDFS:
        problem_count += len(validate_pdf(pdf))
    for prefix in ("system", "owner", "admin", "agent"):
        print(contact_sheet(prefix).relative_to(ROOT))
    raise SystemExit(1 if problem_count else 0)
