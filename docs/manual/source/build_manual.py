from __future__ import annotations

import html
import re
from pathlib import Path
from typing import Iterable

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Flowable,
    Frame,
    Image,
    KeepTogether,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.platypus.tableofcontents import TableOfContents


ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "docs" / "manual" / "source"
OUT = ROOT / "docs" / "manual"
FONT_DIR = ROOT / "src" / "app" / "fonts"

BLUE = colors.HexColor("#0B5ED7")
NAVY = colors.HexColor("#0B2942")
TEAL = colors.HexColor("#0F8B8D")
LIGHT = colors.HexColor("#F4F8FC")
LINE = colors.HexColor("#CBDDEA")
TEXT = colors.HexColor("#183247")
MUTED = colors.HexColor("#526A7D")
WARNING = colors.HexColor("#FFF4D6")


def register_fonts() -> None:
    pdfmetrics.registerFont(TTFont("Sarabun", str(FONT_DIR / "Sarabun-Regular.ttf")))
    pdfmetrics.registerFont(TTFont("Sarabun-SemiBold", str(FONT_DIR / "Sarabun-SemiBold.ttf")))
    pdfmetrics.registerFont(TTFont("Sarabun-Bold", str(FONT_DIR / "Sarabun-Bold.ttf")))
    pdfmetrics.registerFontFamily("Sarabun", normal="Sarabun", bold="Sarabun-Bold", italic="Sarabun", boldItalic="Sarabun-Bold")


register_fonts()


BASE = getSampleStyleSheet()
STYLES = {
    "body": ParagraphStyle("BodyTH", parent=BASE["BodyText"], fontName="Sarabun", fontSize=10.2, leading=15.5, textColor=TEXT, spaceAfter=5),
    "small": ParagraphStyle("SmallTH", parent=BASE["BodyText"], fontName="Sarabun", fontSize=8.6, leading=12.5, textColor=MUTED),
    "h1": ParagraphStyle("H1TH", parent=BASE["Heading1"], fontName="Sarabun-Bold", fontSize=22, leading=29, textColor=NAVY, spaceBefore=8, spaceAfter=10),
    "h2": ParagraphStyle("H2TH", parent=BASE["Heading2"], fontName="Sarabun-Bold", fontSize=16, leading=22, textColor=BLUE, spaceBefore=10, spaceAfter=8),
    "h3": ParagraphStyle("H3TH", parent=BASE["Heading3"], fontName="Sarabun-SemiBold", fontSize=12.5, leading=18, textColor=NAVY, spaceBefore=8, spaceAfter=5),
    "bullet": ParagraphStyle("BulletTH", parent=BASE["BodyText"], fontName="Sarabun", fontSize=10, leading=15, leftIndent=14, firstLineIndent=-8, textColor=TEXT, spaceAfter=3),
    "caption": ParagraphStyle("CaptionTH", parent=BASE["BodyText"], fontName="Sarabun", fontSize=8.4, leading=12, alignment=TA_CENTER, textColor=MUTED, spaceBefore=3, spaceAfter=8),
    "toc_head": ParagraphStyle("TOCHead", fontName="Sarabun-Bold", fontSize=20, leading=26, textColor=NAVY, spaceAfter=12),
}


def inline(text: str) -> str:
    escaped = html.escape(text, quote=False)
    escaped = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", escaped)
    escaped = re.sub(r"`(.+?)`", r"<font color='#0B5ED7'>\1</font>", escaped)
    return escaped.replace("  ", " ")


class Cover(Flowable):
    def __init__(self, title: str, subtitle: str):
        super().__init__()
        self.title = title
        self.subtitle = subtitle
        self.width = A4[0] - 36 * mm
        self.height = A4[1] - 44 * mm

    def draw(self) -> None:
        c = self.canv
        w, h = self.width, self.height
        c.setFillColor(NAVY)
        c.roundRect(0, 0, w, h, 9 * mm, fill=1, stroke=0)
        c.setFillColor(colors.HexColor("#123F62"))
        c.circle(w * 0.90, h * 0.88, 46 * mm, fill=1, stroke=0)
        c.setFillColor(colors.HexColor("#176C8C"))
        c.circle(w * 0.83, h * 0.94, 30 * mm, fill=1, stroke=0)
        c.setFillColor(colors.white)
        c.setFont("Sarabun-Bold", 25)
        text = c.beginText(16 * mm, h * 0.66)
        text.setLeading(33)
        for line in self.title.split("\n"):
            text.textLine(line)
        c.drawText(text)
        c.setFillColor(colors.HexColor("#8DE0DC"))
        c.setFont("Sarabun-SemiBold", 13)
        c.drawString(16 * mm, h * 0.56, self.subtitle)
        c.setFillColor(colors.white)
        c.setFont("Sarabun", 10.5)
        c.drawString(16 * mm, 31 * mm, "ระบบบริหารจัดการลอตเตอรี่ · เอกสารภาษาไทย")
        c.drawString(16 * mm, 23 * mm, "เวอร์ชัน 0.1.0 · จัดทำ 24 พฤศจิกายน 2569")
        c.setStrokeColor(colors.HexColor("#8DE0DC"))
        c.setLineWidth(3)
        c.line(16 * mm, h * 0.60, 75 * mm, h * 0.60)


class ManualDocTemplate(BaseDocTemplate):
    def __init__(self, filename: str, title: str):
        super().__init__(
            filename,
            pagesize=A4,
            rightMargin=17 * mm,
            leftMargin=17 * mm,
            topMargin=20 * mm,
            bottomMargin=18 * mm,
            title=title,
            author="System Documentation Generator",
            subject="คู่มือการใช้งานระบบบริหารจัดการลอตเตอรี่",
        )
        self.manual_title = title
        frame_cover = Frame(self.leftMargin, self.bottomMargin, self.width, self.height, id="cover", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        frame_normal = Frame(self.leftMargin, self.bottomMargin, self.width, self.height, id="normal", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        self.addPageTemplates([
            PageTemplate(id="cover", frames=[frame_cover], onPage=self._cover_page),
            PageTemplate(id="normal", frames=[frame_normal], onPage=self._normal_page),
        ])

    def _cover_page(self, canvas, doc) -> None:
        canvas.setTitle(self.manual_title)

    def _normal_page(self, canvas, doc) -> None:
        canvas.saveState()
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.6)
        canvas.line(self.leftMargin, A4[1] - 13 * mm, A4[0] - self.rightMargin, A4[1] - 13 * mm)
        canvas.setFont("Sarabun", 8)
        canvas.setFillColor(MUTED)
        canvas.drawString(self.leftMargin, A4[1] - 10 * mm, self.manual_title[:70])
        canvas.drawRightString(A4[0] - self.rightMargin, 9 * mm, f"หน้า {doc.page}")
        canvas.line(self.leftMargin, 13 * mm, A4[0] - self.rightMargin, 13 * mm)
        canvas.restoreState()

    def afterFlowable(self, flowable) -> None:
        level = getattr(flowable, "_heading_level", None)
        if level is None:
            return
        text = flowable.getPlainText()
        key = f"h-{self.page}-{abs(hash((text, self.page, level)))}"
        self.canv.bookmarkPage(key)
        self.canv.addOutlineEntry(text, key, max(0, level - 1), closed=level > 1)
        self.notify("TOCEntry", (level - 1, text, self.page, key))


def heading(text: str, level: int) -> Paragraph:
    p = Paragraph(inline(text), STYLES[f"h{min(level, 3)}"])
    p._heading_level = level  # type: ignore[attr-defined]
    return p


def image_flow(path: Path, caption: str, max_width: float) -> list:
    if not path.exists():
        return [Paragraph(f"[ไม่พบภาพ: {inline(str(path))}]", STYLES["small"])]
    from PIL import Image as PILImage
    with PILImage.open(path) as im:
        iw, ih = im.size
    width = max_width
    height = width * ih / iw
    max_height = 105 * mm
    if height > max_height:
        height = max_height
        width = height * iw / ih
    img = Image(str(path), width=width, height=height)
    img.hAlign = "CENTER"
    return [img, Paragraph(inline(caption), STYLES["caption"])]


def parse_table(lines: list[str], width: float) -> Table:
    rows: list[list[str]] = []
    for line in lines:
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if all(re.fullmatch(r":?-{3,}:?", cell.replace(" ", "")) for cell in cells):
            continue
        rows.append(cells)
    columns = max(len(r) for r in rows)
    normalized = [r + [""] * (columns - len(r)) for r in rows]
    data = [[Paragraph(inline(cell), STYLES["small"]) for cell in row] for row in normalized]
    col_widths = [width / columns] * columns
    table = Table(data, colWidths=col_widths, repeatRows=1, hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#DCEBFA")),
        ("TEXTCOLOR", (0, 0), (-1, 0), NAVY),
        ("FONTNAME", (0, 0), (-1, 0), "Sarabun-Bold"),
        ("GRID", (0, 0), (-1, -1), 0.45, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
    ]))
    return table


def markdown_story(path: Path, doc_width: float) -> tuple[str, list]:
    lines = path.read_text(encoding="utf-8").splitlines()
    title = next((line[2:].strip() for line in lines if line.startswith("# ")), path.stem)
    story: list = []
    paragraph_lines: list[str] = []

    def flush_paragraph() -> None:
        if paragraph_lines:
            text = " ".join(s.strip() for s in paragraph_lines).strip()
            if text:
                story.append(Paragraph(inline(text), STYLES["body"]))
            paragraph_lines.clear()

    i = 0
    skipped_title = False
    while i < len(lines):
        line = lines[i].rstrip()
        if not skipped_title and line.startswith("# "):
            skipped_title = True
            i += 1
            continue
        if line == "<!-- PAGEBREAK -->":
            flush_paragraph()
            story.append(PageBreak())
            i += 1
            continue
        image_match = re.match(r"!\[(.*?)\]\((.*?)\)", line)
        if image_match:
            flush_paragraph()
            img_path = (path.parent / image_match.group(2)).resolve()
            story.extend(image_flow(img_path, image_match.group(1), doc_width))
            i += 1
            continue
        head_match = re.match(r"^(#{2,4})\s+(.+)$", line)
        if head_match:
            flush_paragraph()
            level = len(head_match.group(1)) - 1
            text = head_match.group(2).strip()
            if text.startswith("PART ") and story and not isinstance(story[-1], PageBreak):
                story.append(PageBreak())
            story.append(heading(text, level))
            i += 1
            continue
        if line.startswith("|") and "|" in line[1:]:
            flush_paragraph()
            table_lines = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                table_lines.append(lines[i])
                i += 1
            story.append(parse_table(table_lines, doc_width))
            story.append(Spacer(1, 5))
            continue
        if re.match(r"^[-*]\s+", line):
            flush_paragraph()
            text = re.sub(r"^[-*]\s+", "", line)
            story.append(Paragraph("• " + inline(text), STYLES["bullet"]))
            i += 1
            continue
        if re.match(r"^\d+\.\s+", line):
            flush_paragraph()
            m = re.match(r"^(\d+)\.\s+(.+)$", line)
            assert m
            story.append(Paragraph(f"{m.group(1)}. {inline(m.group(2))}", STYLES["bullet"]))
            i += 1
            continue
        if line.startswith("> "):
            flush_paragraph()
            note = Paragraph(inline(line[2:]), STYLES["body"])
            box = Table([[note]], colWidths=[doc_width - 8 * mm])
            box.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), WARNING),
                ("BOX", (0, 0), (-1, -1), 0.7, colors.HexColor("#E8B94B")),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]))
            story.append(box)
            story.append(Spacer(1, 5))
            i += 1
            continue
        if not line.strip():
            flush_paragraph()
            i += 1
            continue
        paragraph_lines.append(line)
        i += 1
    flush_paragraph()
    return title, story


def build(source_name: str, output_path: Path, subtitle: str) -> int:
    source_path = SOURCE / source_name
    title, content = markdown_story(source_path, A4[0] - 34 * mm)
    doc = ManualDocTemplate(str(output_path), title)
    toc = TableOfContents()
    toc.levelStyles = [
        ParagraphStyle("TOC1", fontName="Sarabun-SemiBold", fontSize=10.5, leading=15, leftIndent=0, textColor=NAVY, spaceBefore=4),
        ParagraphStyle("TOC2", fontName="Sarabun", fontSize=9.5, leading=14, leftIndent=9 * mm, textColor=TEXT),
        ParagraphStyle("TOC3", fontName="Sarabun", fontSize=9, leading=13, leftIndent=18 * mm, textColor=MUTED),
    ]
    story = [
        Cover(title.replace("ระบบบริหารจัดการลอตเตอรี่", "ระบบบริหารจัดการ\nลอตเตอรี่"), subtitle),
        NextPageTemplate("normal"),
        PageBreak(),
        Paragraph("สารบัญ", STYLES["toc_head"]),
        toc,
        PageBreak(),
    ] + content
    output_path.parent.mkdir(parents=True, exist_ok=True)
    doc.multiBuild(story)
    from pypdf import PdfReader
    return len(PdfReader(str(output_path)).pages)


if __name__ == "__main__":
    jobs = [
        ("system-user-manual.md", OUT / "system-user-manual.pdf", "คู่มือฉบับสมบูรณ์สำหรับทุกบทบาท"),
        ("owner.md", OUT / "role-manuals" / "owner.pdf", "คู่มือเฉพาะบทบาท Owner"),
        ("admin.md", OUT / "role-manuals" / "admin.pdf", "คู่มือเฉพาะบทบาท Admin"),
        ("agent.md", OUT / "role-manuals" / "agent.pdf", "คู่มือเฉพาะบทบาท Agent"),
    ]
    for source_name, output_path, subtitle in jobs:
        pages = build(source_name, output_path, subtitle)
        print(f"{output_path.relative_to(ROOT)}: {pages} pages")
