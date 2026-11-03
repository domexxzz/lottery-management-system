from pathlib import Path

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK, WD_LINE_SPACING
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor


OUT = Path(r"E:\weblottery\docs\Lottery_System_CTO_Development_Plan_TH.docx")

FONT = "Tahoma"
BLACK = "000000"
NAVY = "16324F"
BLUE = "1F5A7A"
TEAL = "1F7A74"
LIGHT_BLUE = "EAF3F7"
PALE_BLUE = "F4F8FA"
LIGHT_TEAL = "EAF5F3"
GRAY = "5B6570"
LIGHT_GRAY = "F2F4F5"
BORDER = "D9D9D9"
WHITE = "FFFFFF"
RED = "A63D40"
AMBER = "9A6700"
GREEN = "2F6B4F"


def set_cell_shading(cell, fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def set_cell_margins(cell, top=110, start=120, bottom=110, end=120):
    tc = cell._tc
    tc_pr = tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in("w:tcMar")
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for m, v in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = tc_mar.find(qn(f"w:{m}"))
        if node is None:
            node = OxmlElement(f"w:{m}")
            tc_mar.append(node)
        node.set(qn("w:w"), str(v))
        node.set(qn("w:type"), "dxa")


def set_cell_border(cell, color=BORDER, size="6"):
    tc_pr = cell._tc.get_or_add_tcPr()
    borders = tc_pr.first_child_found_in("w:tcBorders")
    if borders is None:
        borders = OxmlElement("w:tcBorders")
        tc_pr.append(borders)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        tag = f"w:{edge}"
        element = borders.find(qn(tag))
        if element is None:
            element = OxmlElement(tag)
            borders.append(element)
        element.set(qn("w:val"), "single")
        element.set(qn("w:sz"), size)
        element.set(qn("w:color"), color)


def set_repeat_table_header(row):
    tr_pr = row._tr.get_or_add_trPr()
    tbl_header = OxmlElement("w:tblHeader")
    tbl_header.set(qn("w:val"), "true")
    tr_pr.append(tbl_header)


def set_row_cant_split(row):
    tr_pr = row._tr.get_or_add_trPr()
    cant_split = OxmlElement("w:cantSplit")
    cant_split.set(qn("w:val"), "true")
    tr_pr.append(cant_split)


def set_cell_width(cell, inches):
    cell.width = Inches(inches)
    tc_pr = cell._tc.get_or_add_tcPr()
    tc_w = tc_pr.find(qn("w:tcW"))
    if tc_w is None:
        tc_w = OxmlElement("w:tcW")
        tc_pr.append(tc_w)
    tc_w.set(qn("w:w"), str(int(inches * 1440)))
    tc_w.set(qn("w:type"), "dxa")


def set_run_font(run, size=None, bold=None, color=None, italic=None):
    run.font.name = FONT
    run._element.get_or_add_rPr().rFonts.set(qn("w:ascii"), FONT)
    run._element.get_or_add_rPr().rFonts.set(qn("w:hAnsi"), FONT)
    run._element.get_or_add_rPr().rFonts.set(qn("w:eastAsia"), FONT)
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.bold = bold
    if color is not None:
        run.font.color.rgb = RGBColor.from_string(color)
    if italic is not None:
        run.italic = italic


def add_text(p, text, bold=False, color=BLACK, size=10.5, italic=False):
    run = p.add_run(text)
    set_run_font(run, size=size, bold=bold, color=color, italic=italic)
    return run


def keep_with_next(paragraph):
    paragraph.paragraph_format.keep_with_next = True


def set_keep_table(row):
    for cell in row.cells:
        for p in cell.paragraphs:
            p.paragraph_format.keep_together = True


def add_heading(doc, text, level=1, before=14, after=6):
    p = doc.add_paragraph(style=f"Heading {level}")
    p.paragraph_format.space_before = Pt(before)
    p.paragraph_format.space_after = Pt(after)
    keep_with_next(p)
    add_text(p, text, bold=True, color=BLACK, size={1: 16, 2: 13, 3: 11.5}.get(level, 11))
    return p


def add_body(doc, text, bold_lead=None, after=5, keep=False):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(after)
    p.paragraph_format.line_spacing = 1.12
    if keep:
        p.paragraph_format.keep_together = True
    if bold_lead and text.startswith(bold_lead):
        add_text(p, bold_lead, bold=True)
        add_text(p, text[len(bold_lead):])
    else:
        add_text(p, text)
    return p


def add_bullets(doc, items, level=0, size=10.3, after=2):
    for item in items:
        p = doc.add_paragraph(style="List Bullet" if level == 0 else "List Bullet 2")
        p.paragraph_format.left_indent = Inches(0.24 + 0.22 * level)
        p.paragraph_format.first_line_indent = Inches(-0.14)
        p.paragraph_format.space_after = Pt(after)
        p.paragraph_format.line_spacing = 1.08
        add_text(p, item, size=size)


def add_numbered(doc, items, size=10.3, after=3):
    for idx, item in enumerate(items, start=1):
        p = doc.add_paragraph()
        p.paragraph_format.left_indent = Inches(0.28)
        p.paragraph_format.first_line_indent = Inches(-0.22)
        p.paragraph_format.space_after = Pt(after)
        p.paragraph_format.line_spacing = 1.08
        add_text(p, f"{idx}. ", bold=True, size=size)
        add_text(p, item, size=size)


def add_table(doc, headers, rows, widths=None, aligns=None, font_size=9.2, header_fill=NAVY):
    table = doc.add_table(rows=1, cols=len(headers))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    if widths:
        for i, width in enumerate(widths):
            table.columns[i].width = Inches(width)
    table.rows[0]._tr.get_or_add_trPr()
    set_repeat_table_header(table.rows[0])
    set_row_cant_split(table.rows[0])
    for i, header in enumerate(headers):
        cell = table.rows[0].cells[i]
        if widths:
            set_cell_width(cell, widths[i])
        set_cell_shading(cell, header_fill)
        set_cell_border(cell)
        set_cell_margins(cell, top=125, bottom=125)
        cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        p = cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_after = Pt(0)
        add_text(p, header, bold=True, color=WHITE, size=9.2)
    for r_idx, row in enumerate(rows):
        cells = table.add_row().cells
        fill = WHITE if r_idx % 2 == 0 else PALE_BLUE
        for i, value in enumerate(row):
            cell = cells[i]
            if widths:
                set_cell_width(cell, widths[i])
            set_cell_shading(cell, fill)
            set_cell_border(cell)
            set_cell_margins(cell)
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            p = cell.paragraphs[0]
            p.paragraph_format.space_after = Pt(0)
            p.paragraph_format.line_spacing = 1.05
            p.alignment = (aligns[i] if aligns else WD_ALIGN_PARAGRAPH.LEFT)
            add_text(p, str(value), size=font_size)
        set_keep_table(table.rows[-1])
        set_row_cant_split(table.rows[-1])
    doc.add_paragraph().paragraph_format.space_after = Pt(1)
    return table


def add_flow(doc, steps):
    table = doc.add_table(rows=1, cols=len(steps))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    total_width = 6.75
    width = total_width / len(steps)
    for i, (num, title, owner) in enumerate(steps):
        cell = table.rows[0].cells[i]
        set_cell_width(cell, width)
        set_cell_shading(cell, LIGHT_BLUE if i % 2 == 0 else LIGHT_TEAL)
        set_cell_border(cell, color="B9CCD5", size="8")
        set_cell_margins(cell, top=145, start=85, bottom=145, end=85)
        cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        p = cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_after = Pt(2)
        add_text(p, num, bold=True, color=BLUE, size=9.5)
        p2 = cell.add_paragraph()
        p2.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p2.paragraph_format.space_after = Pt(2)
        add_text(p2, title, bold=True, size=9.1)
        p3 = cell.add_paragraph()
        p3.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p3.paragraph_format.space_after = Pt(0)
        add_text(p3, owner, color=GRAY, size=7.8)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    return table


def add_status_flow(doc):
    states = [
        ("DRAFT", "กำลังคีย์", LIGHT_GRAY),
        ("CONFIRMED", "ยืนยันแล้ว", LIGHT_BLUE),
        ("LOCKED", "ปิดรอบ", "FFF4D6"),
        ("SETTLED", "คำนวณผล", LIGHT_TEAL),
        ("CLOSED", "ปิดบัญชี", "E6F2EA"),
    ]
    table = doc.add_table(rows=1, cols=len(states))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    for i, (code, thai, fill) in enumerate(states):
        cell = table.rows[0].cells[i]
        set_cell_width(cell, 1.35)
        set_cell_shading(cell, fill)
        set_cell_border(cell, color=BORDER, size="7")
        set_cell_margins(cell, top=120, start=70, bottom=120, end=70)
        cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        p = cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_after = Pt(1)
        add_text(p, code, bold=True, color=NAVY, size=8.4)
        p2 = cell.add_paragraph()
        p2.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p2.paragraph_format.space_after = Pt(0)
        add_text(p2, thai, size=8.5)
    return table


def add_page_number(paragraph):
    paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    run = paragraph.add_run()
    fld_char1 = OxmlElement("w:fldChar")
    fld_char1.set(qn("w:fldCharType"), "begin")
    instr_text = OxmlElement("w:instrText")
    instr_text.set(qn("xml:space"), "preserve")
    instr_text.text = " PAGE "
    fld_char2 = OxmlElement("w:fldChar")
    fld_char2.set(qn("w:fldCharType"), "end")
    run._r.append(fld_char1)
    run._r.append(instr_text)
    run._r.append(fld_char2)
    set_run_font(run, size=8, color=GRAY)


def add_page_break(doc):
    doc.add_page_break()


def configure_document(doc):
    section = doc.sections[0]
    section.page_width = Inches(8.5)
    section.page_height = Inches(11)
    section.top_margin = Inches(0.72)
    section.bottom_margin = Inches(0.68)
    section.left_margin = Inches(0.78)
    section.right_margin = Inches(0.78)
    section.header_distance = Inches(0.32)
    section.footer_distance = Inches(0.32)

    styles = doc.styles
    normal = styles["Normal"]
    normal.font.name = FONT
    normal._element.rPr.rFonts.set(qn("w:ascii"), FONT)
    normal._element.rPr.rFonts.set(qn("w:hAnsi"), FONT)
    normal._element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
    normal.font.size = Pt(10.5)
    normal.font.color.rgb = RGBColor.from_string(BLACK)
    normal.paragraph_format.space_after = Pt(5)
    normal.paragraph_format.line_spacing = 1.12

    for name, size in (("Title", 27), ("Subtitle", 12.5), ("Heading 1", 16), ("Heading 2", 13), ("Heading 3", 11.5)):
        style = styles[name]
        style.font.name = FONT
        style._element.rPr.rFonts.set(qn("w:ascii"), FONT)
        style._element.rPr.rFonts.set(qn("w:hAnsi"), FONT)
        style._element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
        style.font.size = Pt(size)
        style.font.color.rgb = RGBColor.from_string(BLACK)
        style.font.bold = name != "Subtitle"

    header = section.header
    hp = header.paragraphs[0]
    hp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    add_text(hp, "แผนพัฒนาระบบบริหารจัดการลอตเตอรี่", bold=True, color=GRAY, size=7.8)

    footer = section.footer
    ft = footer.add_table(rows=1, cols=2, width=Inches(6.75))
    ft.alignment = WD_TABLE_ALIGNMENT.CENTER
    left, right = ft.rows[0].cells
    set_cell_width(left, 5.5)
    set_cell_width(right, 1.25)
    for cell in (left, right):
        cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        set_cell_margins(cell, top=45, bottom=25, start=0, end=0)
        p = cell.paragraphs[0]
        p.paragraph_format.space_after = Pt(0)
    add_text(left.paragraphs[0], "CTO Development Plan  |  2 พฤศจิกายน 2026", color=GRAY, size=7.5)
    add_page_number(right.paragraphs[0])


def build():
    doc = Document()
    configure_document(doc)

    # Cover
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(70)
    p.paragraph_format.space_after = Pt(13)
    p.alignment = WD_ALIGN_PARAGRAPH.LEFT
    add_text(p, "แผนพัฒนาระบบบริหารจัดการลอตเตอรี่", bold=True, size=26, color=BLACK)

    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(8)
    add_text(p, "Workflow  Architecture  Control  Demo  Pilot", bold=True, size=14, color=BLUE)

    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(20)
    p.paragraph_format.space_after = Pt(22)
    p.paragraph_format.line_spacing = 1.25
    add_text(
        p,
        "เอกสารสำหรับกำหนดขอบเขตผลิตภัณฑ์และวิธีส่งมอบระบบ ตั้งแต่ Agent สร้างบิล "
        "จนถึงการปิดรอบ คำนวณเงินรับจ่าย ตรวจสอบประวัติ และรายงานผลแยกตาม Agent",
        size=12,
        color=GRAY,
    )

    add_table(
        doc,
        ["รายการ", "รายละเอียด"],
        [
            ("เจ้าของเอกสาร", "ฝ่ายเทคโนโลยีและผลิตภัณฑ์"),
            ("เวอร์ชัน", "1.0 สำหรับอนุมัติขอบเขต Demo และ Pilot"),
            ("วันที่จัดทำ", "2 พฤศจิกายน 2026"),
            ("เป้าหมาย Demo", "7 พฤศจิกายน 2026"),
            ("เป้าหมาย Pilot", "16 พฤศจิกายน 2026"),
        ],
        widths=[1.7, 5.05],
        aligns=[WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT],
        font_size=9.7,
        header_fill=TEAL,
    )

    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(15)
    p.paragraph_format.space_after = Pt(0)
    add_text(p, "ข้อสรุประดับบริหาร", bold=True, size=12.5)
    add_body(
        doc,
        "ควรส่งมอบระบบแบบ Web Application ที่มี Role Based Access Control และ Audit Log เป็นแกนกลาง "
        "โดย Demo ใช้ข้อมูลสาธิตที่ติดป้ายชัดเจน ส่วนวันที่ 16 ใช้ Controlled Pilot จำกัดจำนวน Agent "
        "มีวงเงิน มีการปิดรอบ และมีผู้ตรวจผลสองคนก่อนคำนวณเงินจริง",
        after=0,
    )

    add_page_break(doc)

    # Contents and decisions
    add_heading(doc, "สารบัญเนื้อหา", 1, before=0)
    add_numbered(
        doc,
        [
            "เป้าหมายและหลักการออกแบบ",
            "ขอบเขตระบบและบทบาทผู้ใช้งาน",
            "Workflow หลักของระบบ",
            "Workflow การแก้ไขและ Audit Log",
            "Workflow ปิดรอบ ลงผล และคำนวณการเงิน",
            "แบบจำลองข้อมูลและสถาปัตยกรรม",
            "Security Operations และความพร้อมใช้งาน",
            "ขอบเขต Demo วันที่ 7 พฤศจิกายน",
            "แผน Controlled Pilot วันที่ 16 พฤศจิกายน",
            "เกณฑ์รับมอบ ความเสี่ยง และรายการที่ต้องตัดสินใจ",
        ],
        size=10.6,
        after=5,
    )

    add_heading(doc, "1 เป้าหมายและหลักการออกแบบ", 1)
    add_body(
        doc,
        "ระบบต้องตอบคำถามทางธุรกิจได้ทันทีว่า บิลนี้เป็นของใคร ใครเป็นผู้สร้าง ใครแก้อะไร "
        "Agent แต่ละรายขายเท่าไร รางวัลประเภท 1 ถึง 16 มียอดเท่าไร ระบบรับเงินเท่าไร "
        "ต้องจ่ายเท่าไร และผลสุทธิของแต่ละรอบเป็นเท่าไร",
    )
    add_table(
        doc,
        ["หลักการ", "ผลต่อการออกแบบ"],
        [
            ("ตรวจสอบย้อนหลังได้", "ทุกการเปลี่ยนแปลงต้องมีผู้กระทำ เวลา ค่าเดิม ค่าใหม่ และเหตุผล"),
            ("แยกความเป็นเจ้าของ", "ทุกบิลผูก Agent และองค์กร ห้ามอ่านข้อมูลข้ามสิทธิ์"),
            ("คำนวณซ้ำได้", "เก็บอัตราจ่ายที่ใช้จริงในรายการบิล เพื่อคำนวณย้อนหลังโดยไม่เปลี่ยนตามเรตใหม่"),
            ("ปิดรอบอย่างมีวินัย", "เมื่อถึง Cutoff บิลถูกล็อก การเปลี่ยนแปลงต้องผ่าน Admin และมี Audit"),
            ("ผลลัพธ์มีผู้อนุมัติ", "ใช้หลัก Maker Checker สำหรับผลรางวัลและการปิดบัญชี"),
            ("เริ่มเล็กและย้อนกลับได้", "Pilot จำกัด Agent วงเงิน และมีไฟล์สำรองสำหรับกระทบยอด"),
        ],
        widths=[1.65, 5.1],
        aligns=[WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT],
    )

    add_heading(doc, "ขอบเขตที่ต้องยืนยันก่อนพัฒนา", 2)
    add_bullets(
        doc,
        [
            "ชื่อและนิยามของรางวัลทั้ง 16 ประเภท รูปแบบเลขที่รับ และข้อจำกัดยอดเดิมพัน",
            "อัตราจ่าย อัตราคอมมิชชัน Agent และวิธีปัดเศษ",
            "เวลาปิดรับบิล เงื่อนไขแก้ไข ยกเลิก และผู้มีอำนาจอนุมัติ",
            "แหล่งผลรางวัลและขั้นตอนตรวจสอบผลก่อน Settlement",
            "ข้อกำกับ ใบอนุญาต การเก็บข้อมูลส่วนบุคคล และข้อจำกัดการใช้เงินจริง",
        ],
    )

    add_page_break(doc)

    # Scope and roles
    add_heading(doc, "2 ขอบเขตระบบและบทบาทผู้ใช้งาน", 1, before=0)
    add_heading(doc, "ขอบเขตผลิตภัณฑ์ระยะแรก", 2)
    add_table(
        doc,
        ["โมดูล", "ความสามารถหลัก", "ระยะ"],
        [
            ("Identity and Access", "Login, Session, Role, ระงับผู้ใช้, บังคับเปลี่ยนรหัสผ่าน", "Demo"),
            ("Agent Management", "สร้าง Agent, กำหนดสถานะ, อัตราคอม, วงเงิน", "Demo"),
            ("Bill Management", "สร้าง ตรวจยอด ยืนยัน พิมพ์ แก้ไข ยกเลิก", "Demo"),
            ("Draw and Cutoff", "กำหนดรอบ เวลาปิดรับ และล็อกบิล", "Demo"),
            ("Result and Settlement", "ลงผล ตรวจผล คำนวณผู้ถูกรางวัล", "Demo"),
            ("Dashboard and Report", "ยอดรวม แยก Agent แยกรางวัล 1 ถึง 16 และ Export", "Demo"),
            ("Audit and Operations", "ประวัติแก้ไข Backup Restore และ Monitoring", "Pilot"),
            ("Automation Extensions", "OCR, LINE, API ผลรางวัล, Mobile Native", "หลัง Pilot"),
        ],
        widths=[1.45, 4.25, 1.05],
        aligns=[WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.CENTER],
        font_size=8.9,
    )

    add_heading(doc, "Role and Permission Matrix", 2)
    add_table(
        doc,
        ["ความสามารถ", "Owner", "Admin", "Checker", "Agent"],
        [
            ("ดูยอดรวมทุก Agent", "ได้", "ได้", "ได้", "ไม่ได้"),
            ("ดูบิลของตนเอง", "ได้", "ได้", "ตามมอบหมาย", "ได้"),
            ("สร้างและยืนยันบิล", "ได้", "ได้", "ไม่ได้", "ได้"),
            ("แก้บิลก่อน Cutoff", "ได้", "ได้", "ไม่ได้", "ตามนโยบาย"),
            ("แก้หรือยกเลิกหลัง Cutoff", "อนุมัติ", "เสนอหรือดำเนินการ", "ตรวจสอบ", "ไม่ได้"),
            ("ลงผลรางวัล", "ได้", "Maker", "Checker", "ไม่ได้"),
            ("ปิด Settlement", "อนุมัติ", "ดำเนินการ", "ยืนยัน", "ไม่ได้"),
            ("ดู Audit Log", "ได้", "ได้", "ได้", "เฉพาะบิลตนเอง"),
        ],
        widths=[2.55, 0.8, 0.85, 0.85, 1.7],
        aligns=[WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.CENTER, WD_ALIGN_PARAGRAPH.CENTER, WD_ALIGN_PARAGRAPH.CENTER, WD_ALIGN_PARAGRAPH.CENTER],
        font_size=8.4,
    )

    add_body(
        doc,
        "ข้อกำหนดสำคัญ: ฝั่ง Server ต้องตรวจสิทธิ์ทุกคำขอ ไม่พึ่งการซ่อนปุ่มบนหน้าจอเพียงอย่างเดียว "
        "และทุก Query ที่เกี่ยวกับบิลต้องมีขอบเขตองค์กร รอบ และ Agent ตามสิทธิ์ของผู้ใช้",
        bold_lead="ข้อกำหนดสำคัญ:",
        after=0,
    )

    # Main workflow
    add_heading(doc, "3 Workflow หลักของระบบ", 1, before=0)
    add_flow(
        doc,
        [
            ("01", "Login", "ทุกบทบาท"),
            ("02", "เลือกรอบ", "Agent"),
            ("03", "สร้างบิล", "Agent"),
            ("04", "ตรวจและยืนยัน", "Agent"),
            ("05", "ปิดรอบ", "System Admin"),
        ],
    )
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_after = Pt(7)
    add_text(p, "จากนั้น", italic=True, color=GRAY, size=8.5)
    add_flow(
        doc,
        [
            ("06", "ลงผล", "Admin Maker"),
            ("07", "ตรวจผล", "Checker"),
            ("08", "คำนวณ", "System"),
            ("09", "กระทบยอด", "Admin"),
            ("10", "ปิดบัญชี", "Owner"),
        ],
    )

    add_heading(doc, "Swimlane Workflow ตั้งแต่รับบิลถึงปิดบัญชี", 2)
    add_table(
        doc,
        ["ขั้น", "Agent", "ระบบ", "Admin หรือ Checker", "ผลลัพธ์"],
        [
            ("1", "Login และเลือกรอบ", "ตรวจสิทธิ์ สถานะ Agent และ Cutoff", "-", "Session พร้อมใช้งาน"),
            ("2", "ระบุชื่อบิลและรายการ", "ตรวจรูปแบบเลข เรต วงเงิน และรายการซ้ำ", "-", "บิลสถานะ Draft"),
            ("3", "ตรวจยอดรวมและยืนยัน", "สร้างเลขบิล เก็บ Snapshot เรต และ Audit", "-", "บิล Confirmed"),
            ("4", "ดูหรือพิมพ์บิล", "แสดงเฉพาะข้อมูลตามสิทธิ์", "ติดตามข้อผิดปกติ", "หลักฐานรับรายการ"),
            ("5", "หยุดรับเมื่อถึง Cutoff", "ล็อกบิลทั้งหมดในรอบ", "ยืนยันการปิดรอบ", "รอบสถานะ Locked"),
            ("6", "-", "รับผลฉบับร่าง", "Maker ลงผล Checker ตรวจ", "ผลสถานะ Approved"),
            ("7", "-", "จับคู่รายการชนะและคำนวณเงิน", "ตรวจยอดผิดปกติ", "Settlement Draft"),
            ("8", "ดูสรุปของตน", "สรุปรับ จ่าย คอม และสุทธิ", "กระทบยอดและอนุมัติ", "รอบสถานะ Closed"),
        ],
        widths=[0.42, 1.28, 2.36, 1.58, 1.11],
        aligns=[WD_ALIGN_PARAGRAPH.CENTER, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT],
        font_size=8.0,
    )

    add_heading(doc, "Workflow สร้างบิล", 2)
    add_numbered(
        doc,
        [
            "Agent เลือกรอบที่เปิดรับและกรอกชื่อบิลหรือรหัสอ้างอิงลูกค้า",
            "เพิ่มรายการโดยเลือกประเภทรางวัล 1 ถึง 16 กรอกเลขและยอดเดิมพัน",
            "ระบบตรวจรูปแบบ เลขซ้ำ วงเงิน Agent วงเงินต่อเลข และเวลาปิดรับแบบ Real Time",
            "ระบบคำนวณยอดรวมและแสดงสรุปให้ Agent ตรวจทานก่อนยืนยัน",
            "เมื่อยืนยัน ระบบออกเลขบิล เก็บเรตที่ใช้จริง สร้าง Audit Event และเปลี่ยนเป็น Confirmed",
            "Agent พิมพ์หรือดาวน์โหลดหลักฐานบิลได้ แต่ข้อมูลต้องระบุสถานะและเวลาที่ชัดเจน",
        ],
    )

    # Bill lifecycle and audit
    add_heading(doc, "4 Workflow การแก้ไขและ Audit Log", 1, before=0)
    add_heading(doc, "Bill State Lifecycle", 2)
    add_status_flow(doc)
    add_body(
        doc,
        "เส้นทางปกติคือ DRAFT ไป CONFIRMED ไป LOCKED ไป SETTLED ไป CLOSED ส่วน CANCELLED เป็นสถานะปลายทางแยก "
        "บิลที่ยกเลิกต้องยังอยู่ในฐานข้อมูลและรายงานตรวจสอบ ไม่ใช้การลบข้อมูลจริง",
    )

    add_table(
        doc,
        ["สถานะ", "แก้ไขได้หรือไม่", "เงื่อนไขควบคุม"],
        [
            ("DRAFT", "Agent แก้ได้", "ยังไม่ถือเป็นยอดขายจนกว่าจะยืนยัน"),
            ("CONFIRMED", "ตามนโยบายก่อน Cutoff", "บันทึก Before After และเหตุผลทุกครั้ง"),
            ("LOCKED", "Admin เท่านั้น", "ต้องมีเหตุผลและการอนุมัติ ผู้แก้ห้ามเป็นผู้อนุมัติเอง"),
            ("SETTLED", "ห้ามแก้รายการโดยตรง", "ใช้ Adjustment Transaction และคำนวณ Settlement ใหม่"),
            ("CLOSED", "ห้ามแก้", "เปิดรอบใหม่หรือ Reopen โดย Owner พร้อม Audit"),
            ("CANCELLED", "ห้ามแก้", "เก็บยอดเดิม ผู้ยกเลิก เหตุผล และเวลายกเลิก"),
        ],
        widths=[1.15, 1.7, 3.9],
        aligns=[WD_ALIGN_PARAGRAPH.CENTER, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT],
        font_size=9.0,
    )

    add_heading(doc, "Edit and Cancel Workflow", 2)
    add_flow(
        doc,
        [
            ("01", "ขอแก้ไข", "Agent Admin"),
            ("02", "ตรวจสถานะ", "System"),
            ("03", "ระบุเหตุผล", "ผู้แก้ไข"),
            ("04", "อนุมัติ", "Admin Owner"),
            ("05", "บันทึก Audit", "System"),
        ],
    )
    add_bullets(
        doc,
        [
            "ก่อน Cutoff: อนุญาตตามสิทธิ์ แต่ทุก Field ที่เปลี่ยนต้องบันทึกค่าเดิมและค่าใหม่",
            "หลัง Cutoff: ระบบสร้าง Change Request แทนการแก้ทันที และบังคับผู้อนุมัติอีกคน",
            "หลัง Settlement: ใช้รายการปรับปรุง ไม่ย้อนแก้ยอดเดิม เพื่อรักษาความถูกต้องของบัญชี",
            "การยกเลิกต้องบันทึกเหตุผลและไม่คืนวงเงินจนกว่ากฎธุรกิจจะอนุมัติ",
        ],
    )

    add_heading(doc, "Audit Event ที่ต้องเก็บ", 2)
    add_table(
        doc,
        ["Field", "ตัวอย่าง", "วัตถุประสงค์"],
        [
            ("event_id", "UUID", "ระบุเหตุการณ์ไม่ซ้ำ"),
            ("actor_user_id", "usr_1042", "ระบุผู้กระทำ"),
            ("actor_role", "AGENT", "บันทึกสิทธิ์ขณะกระทำ"),
            ("action", "BILL_ITEM_UPDATED", "จำแนกเหตุการณ์"),
            ("entity_type and id", "bill_item bi_889", "ผูกกับข้อมูลที่เปลี่ยน"),
            ("before_json", "amount 500", "เก็บค่าเดิม"),
            ("after_json", "amount 700", "เก็บค่าใหม่"),
            ("reason", "ลูกค้าแก้ยอด", "อธิบายเหตุผล"),
            ("timestamp and request_id", "2026 11 02 14:35 req_x", "สืบค้นตามเวลาและคำขอ"),
            ("ip and device", "Masked IP and User Agent", "ตรวจสอบเหตุผิดปกติ"),
        ],
        widths=[1.55, 2.3, 2.9],
        aligns=[WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT],
        font_size=8.6,
    )

    # Close, result, settlement
    add_heading(doc, "5 Workflow ปิดรอบ ลงผล และคำนวณการเงิน", 1, before=0)
    add_heading(doc, "Close Round Workflow", 2)
    add_numbered(
        doc,
        [
            "Scheduler เปลี่ยนรอบเป็น Closing เมื่อถึง Cutoff และปฏิเสธบิลใหม่ทันที",
            "ระบบรอคำขอที่กำลังประมวลผลให้จบ แล้วสร้างยอดรวมและจำนวนบิล ณ เวลาปิด",
            "Admin ตรวจจำนวนบิล ยอดขาย และรายการผิดปกติ ก่อนยืนยัน Locked",
            "ระบบสร้าง Close Snapshot และ Backup เพื่อใช้เทียบหลังประกาศผล",
            "หากต้องเปิดรอบอีกครั้ง Owner ต้องระบุเหตุผล ระบบสร้าง Audit Event และ Close Snapshot ใหม่",
        ],
    )

    add_heading(doc, "Result Approval Workflow", 2)
    add_flow(
        doc,
        [
            ("01", "สร้างผลฉบับร่าง", "Maker"),
            ("02", "ตรวจรูปแบบ", "System"),
            ("03", "เทียบแหล่งผล", "Checker"),
            ("04", "อนุมัติผล", "Checker"),
            ("05", "เริ่ม Settlement", "System"),
        ],
    )
    add_body(
        doc,
        "Maker และ Checker ต้องเป็นคนละบัญชี ผลรางวัลที่ Approved แล้วห้ามแก้โดยตรง "
        "หากพบข้อผิดพลาดให้สร้าง Result Revision ที่มีเลขเวอร์ชัน และคำนวณผลกระทบใหม่ทั้งหมด",
    )

    add_heading(doc, "สูตรการเงินมาตรฐาน", 2)
    add_table(
        doc,
        ["ตัวชี้วัด", "สูตร", "หมายเหตุ"],
        [
            ("ยอดขายรวม", "ผลรวมยอดเดิมพันของบิล Confirmed", "ไม่รวม Draft และ Cancelled"),
            ("เงินจ่ายรางวัล", "ผลรวม Winning Stake คูณ Payout Rate", "ใช้เรต Snapshot ในรายการบิล"),
            ("ค่าคอม Agent", "ฐานคำนวณคูณ Commission Rate", "ฐานอาจเป็นยอดขายหรือสูตรเฉพาะ"),
            ("ผลสุทธิระบบ", "ยอดขายรวม ลบ เงินจ่ายรางวัล ลบ ค่าคอม ลบ Adjustment", "แสดงทั้งระดับ Agent และทั้งรอบ"),
            ("ยอดคงค้าง Agent", "ยอดรับชำระ ลบ ยอดที่ส่งแล้ว ลบหรือบวก Settlement", "ต้องกำหนดทิศทางเงินให้ชัด"),
        ],
        widths=[1.4, 3.1, 2.25],
        aligns=[WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT],
        font_size=8.9,
    )

    add_heading(doc, "รายงานที่ต้องตอบได้", 2)
    add_bullets(
        doc,
        [
            "ยอดขายรวมของรอบและยอดขายแยก Agent",
            "ยอดเดิมพันแยกตามรางวัลประเภท 1 ถึง 16 พร้อมจำนวนรายการและจำนวนบิล",
            "เงินรับ เงินจ่ายรางวัล ค่าคอมมิชชัน Adjustment และผลสุทธิ",
            "รายการชนะสูงสุด บิลผิดปกติ บิลที่แก้ไข บิลยกเลิก และยอดเกินวงเงิน",
            "ยอดก่อนปิดรอบเทียบยอดหลัง Settlement เพื่อยืนยันว่าไม่มีรายการตกหล่น",
        ],
    )

    # Data model and architecture
    add_heading(doc, "6 แบบจำลองข้อมูลและสถาปัตยกรรม", 1, before=0)
    add_heading(doc, "Logical Data Model", 2)
    add_table(
        doc,
        ["Entity", "ข้อมูลสำคัญ", "ความสัมพันธ์"],
        [
            ("Organization", "ชื่อ สถานะ Timezone Policy", "มี Users Agents และ Draws"),
            ("User", "ชื่อ Login Role Status", "ผูก Agent ได้หนึ่งรายตามนโยบาย"),
            ("Agent", "รหัส ชื่อ Commission Credit Limit", "เจ้าของ Bills และ Settlements"),
            ("Draw", "ชื่อรอบ เปิดรับ Cutoff สถานะ", "มี Bills Results และ Settlement"),
            ("PrizeType", "รหัส 1 ถึง 16 ชื่อ Rule Payout", "ถูกอ้างอิงจาก BillItem และ Result"),
            ("Bill", "เลขบิล ชื่อบิล Agent Draw Status Total", "มีหลาย BillItems"),
            ("BillItem", "PrizeType Number Stake PayoutSnapshot", "คำนวณผลและยอดจ่าย"),
            ("Result", "Draw PrizeType Value Version Approval", "ใช้จับคู่ BillItem"),
            ("Settlement", "Agent Draw Gross Payout Commission Net", "สรุปการเงินต่อ Agent"),
            ("AuditEvent", "Actor Action Before After Reason Time", "ผูก Entity ทุกประเภท"),
        ],
        widths=[1.3, 3.0, 2.45],
        aligns=[WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT],
        font_size=8.5,
    )

    add_heading(doc, "Recommended Architecture", 2)
    add_flow(
        doc,
        [
            ("01", "Web or PWA", "Agent Admin"),
            ("02", "API Service", "Business Rules"),
            ("03", "Relational DB", "Source of Truth"),
            ("04", "Worker Scheduler", "Cutoff Reports"),
            ("05", "Backup Monitor", "Operations"),
        ],
    )
    add_table(
        doc,
        ["Layer", "ข้อเสนอ", "เหตุผล"],
        [
            ("Frontend", "Responsive Web Application หรือ PWA", "ใช้งานได้ทั้งมือถือและคอมพิวเตอร์โดยไม่ต้องรอ App Store"),
            ("Backend", "Modular API with Transaction Boundary", "ควบคุมสิทธิ์ Validation Audit และ Settlement ใน Server"),
            ("Database", "PostgreSQL สำหรับ Pilot และ Production", "รองรับ Transaction Constraint Backup และ Reporting"),
            ("Cache or Queue", "เพิ่มเมื่อมีโหลดจริง", "Demo ไม่ควรเพิ่มความซับซ้อนก่อนมีหลักฐานโหลด"),
            ("Deployment", "Managed Cloud with TLS and Daily Backup", "ลดเวลาจัดการ Server และรองรับ Rollback"),
            ("Observability", "Structured Log Error Tracking Health Check", "ค้นหาปัญหาด้วย request_id และแจ้งเตือนทันเวลา"),
        ],
        widths=[1.25, 2.3, 3.2],
        aligns=[WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT],
        font_size=8.8,
    )

    add_heading(doc, "Transaction Boundaries ที่ห้ามแยก", 2)
    add_bullets(
        doc,
        [
            "ยืนยันบิล ต้องบันทึก Bill BillItems ยอดรวม และ Audit Event ใน Transaction เดียว",
            "ปิดรอบ ต้องล็อกสถานะ สร้าง Snapshot และ Audit Event อย่างสอดคล้องกัน",
            "อนุมัติผลและสร้าง Settlement ต้องใช้ Result Version เดียวกันตลอดการคำนวณ",
            "การแก้หลัง Settlement ต้องสร้าง Adjustment และยอดใหม่โดยไม่เขียนทับประวัติเดิม",
        ],
    )

    # Security and ops
    add_heading(doc, "7 Security Operations และความพร้อมใช้งาน", 1, before=0)
    add_table(
        doc,
        ["Control", "ข้อกำหนดขั้นต่ำ", "หลักฐานก่อน Pilot"],
        [
            ("Authentication", "รหัสผ่าน Hash, Session Timeout, Lockout, เปลี่ยนรหัสแรกเข้า", "ทดสอบ Login Logout Lockout"),
            ("Authorization", "RBAC และ Scope ตาม Organization Agent Draw", "ทดสอบ Agent อ่านข้อมูลข้ามรายไม่ได้"),
            ("Input Validation", "ตรวจเลข ยอด เรต Duplicate Cutoff และ Limit ที่ Server", "ชุดทดสอบผ่านกรณีปกติและผิดพลาด"),
            ("Audit Integrity", "Append Only และห้ามแก้ผ่านหน้าจอทั่วไป", "สุ่มแก้บิลแล้วตรวจ Before After"),
            ("Data Protection", "TLS, Secret Management, จำกัดข้อมูลส่วนบุคคล", "ตรวจ Configuration และสิทธิ์ฐานข้อมูล"),
            ("Backup Restore", "Backup ก่อนปิดรอบและรายวัน พร้อม Retention", "ทดสอบ Restore ไปฐานข้อมูลแยก"),
            ("Availability", "Health Check, Error Alert, Runbook", "จำลอง API ผิดพลาดและตรวจการแจ้งเตือน"),
            ("Financial Control", "Maker Checker, Cutoff, Idempotency, Reconciliation", "Settlement ซ้ำต้องไม่จ่ายซ้ำ"),
        ],
        widths=[1.22, 3.25, 2.28],
        aligns=[WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT],
        font_size=8.2,
    )

    add_heading(doc, "Non Functional Requirements", 2)
    add_table(
        doc,
        ["หัวข้อ", "เป้าหมาย Pilot", "วิธีตรวจ"],
        [
            ("Performance", "การบันทึกบิลทั่วไปตอบกลับภายใน 2 วินาทีที่โหลดเป้าหมาย", "Load Test ตามจำนวน Agent จริง"),
            ("Consistency", "ไม่มี BillItem ที่ไม่ผูก Bill และไม่มี Settlement ที่ใช้ผลไม่ Approved", "Database Constraint และ Test"),
            ("Recovery", "กู้ข้อมูลถึง Backup ล่าสุดได้ตาม Runbook", "Restore Drill ก่อนวันที่ 16"),
            ("Traceability", "ทุกคำขอสำคัญมี request_id และ actor", "ตรวจ Log และ Audit แบบสุ่ม"),
            ("Usability", "Agent สร้างบิลมาตรฐานได้โดยไม่ต้องอบรมเกิน 15 นาที", "UAT กับผู้ใช้จริง 2 ถึง 3 คน"),
        ],
        widths=[1.2, 3.35, 2.2],
        aligns=[WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT],
        font_size=8.7,
    )

    add_heading(doc, "Operating Runbook ขั้นต่ำ", 2)
    add_bullets(
        doc,
        [
            "ก่อนเปิดรอบ ตรวจ Health Check เวลา Server สถานะฐานข้อมูล และพื้นที่ Backup",
            "ก่อน Cutoff 30 นาที ตรวจบิลค้าง Draft รายการผิดปกติ และแจ้ง Agent",
            "หลัง Cutoff Export Close Snapshot และสำรองฐานข้อมูล",
            "ก่อน Settlement ให้ Maker และ Checker ยืนยันผลคนละบัญชี",
            "หลัง Settlement กระทบยอดยอดขาย ยอดจ่าย ค่าคอม และยอดสุทธิ แล้ว Owner จึงปิดบัญชี",
            "เมื่อระบบขัดข้อง หยุดรับรายการ ประกาศช่องทางสำรอง และบันทึกรายการนำเข้าย้อนหลังพร้อม Audit",
        ],
    )

    # Demo
    add_heading(doc, "8 ขอบเขต Demo วันที่ 7 พฤศจิกายน 2026", 1, before=0)
    add_body(
        doc,
        "Demo ต้องพิสูจน์ Workflow และการควบคุมข้อมูล ไม่จำเป็นต้องมีทุก Integration "
        "ข้อมูลที่ใช้ต้องติดป้าย ข้อมูลสาธิต บนหน้าจอและรายงาน เพื่อไม่ให้ถูกตีความว่าเป็นยอดจริง",
    )

    add_heading(doc, "Demo Storyboard 15 นาที", 2)
    add_table(
        doc,
        ["เวลา", "ผู้สาธิตทำอะไร", "สิ่งที่ลูกค้าต้องเห็น"],
        [
            ("0 ถึง 2 นาที", "Login เป็น Agent A และเลือก Draw", "Agent เห็นเฉพาะข้อมูลของตน"),
            ("2 ถึง 5 นาที", "สร้างบิล ใส่หลายประเภทรางวัล และยืนยัน", "Validation ยอดรวม เลขบิล และหลักฐาน"),
            ("5 ถึง 7 นาที", "แก้ยอดหนึ่งรายการและระบุเหตุผล", "Audit แสดงค่าเดิม ค่าใหม่ ผู้แก้ และเวลา"),
            ("7 ถึง 9 นาที", "Login เป็น Owner และเปิดรายงาน Agent", "ยอดขายแยก Agent และประเภท 1 ถึง 16"),
            ("9 ถึง 11 นาที", "ปิดรอบและลองสร้างบิลหลัง Cutoff", "ระบบปฏิเสธและบันทึกสถานะ Locked"),
            ("11 ถึง 13 นาที", "Maker ลงผล Checker อนุมัติ", "แยกหน้าที่และ Result Version"),
            ("13 ถึง 15 นาที", "คำนวณ Settlement และ Export", "เงินรับ เงินจ่าย คอม และผลสุทธิ"),
        ],
        widths=[1.05, 2.95, 2.75],
        aligns=[WD_ALIGN_PARAGRAPH.CENTER, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT],
        font_size=8.7,
    )

    add_heading(doc, "Demo Acceptance Criteria", 2)
    add_table(
        doc,
        ["รหัส", "เกณฑ์ผ่าน", "หลักฐาน"],
        [
            ("D01", "Agent A เปิดบิลของ Agent B ไม่ได้", "Permission Test"),
            ("D02", "ยืนยันบิลแล้วมีเลขบิล ยอดรวม และผู้สร้าง", "หน้ารายละเอียดบิล"),
            ("D03", "แก้บิลแล้ว Audit แสดง Before After ถูกต้อง", "Audit Timeline"),
            ("D04", "Dashboard รวมยอดเท่ากับผลรวม BillItems", "Reconciliation Query"),
            ("D05", "หลัง Cutoff ระบบไม่รับบิลใหม่", "Negative Test"),
            ("D06", "ผลรางวัลต้องผ่าน Checker ก่อน Settlement", "Workflow Test"),
            ("D07", "คำนวณเงินรับจ่ายตาม Test Case ที่ตรวจมือแล้ว", "Settlement Test"),
            ("D08", "Export แสดงรอบ Agent 16 ประเภท และยอดสุทธิ", "ไฟล์รายงาน"),
        ],
        widths=[0.65, 4.25, 1.85],
        aligns=[WD_ALIGN_PARAGRAPH.CENTER, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT],
        font_size=8.7,
    )

    add_heading(doc, "Delivery Plan ก่อน Demo", 2)
    add_table(
        doc,
        ["วันที่", "เป้าหมาย", "Exit Criteria"],
        [
            ("2 พ.ย.", "ล็อกกติกา 16 ประเภท เรต คอม Cutoff และสิทธิ์", "Business Rules ลงนามรับทราบ"),
            ("3 พ.ย.", "Identity Agent Draw และ Data Model", "สร้างผู้ใช้และแยกสิทธิ์ได้"),
            ("4 พ.ย.", "Bill Workflow Validation และ Audit", "สร้าง แก้ ยกเลิกและตรวจประวัติได้"),
            ("5 พ.ย.", "Result Settlement Dashboard และ Export", "Test Case การเงินผ่าน"),
            ("6 พ.ย.", "End to End Test และซ้อม Demo", "ผ่าน D01 ถึง D08 และมี Backup"),
            ("7 พ.ย.", "Customer Demo และเก็บข้ออนุมัติ", "สรุป Change List และ Pilot Scope"),
        ],
        widths=[0.85, 3.3, 2.6],
        aligns=[WD_ALIGN_PARAGRAPH.CENTER, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT],
        font_size=8.5,
    )

    # Pilot
    add_heading(doc, "9 แผน Controlled Pilot วันที่ 16 พฤศจิกายน 2026", 1, before=0)
    add_body(
        doc,
        "Pilot ควรเป็นการใช้งานจริงแบบจำกัดขอบเขต ไม่ใช่เปิด Production เต็มรูปแบบ "
        "เป้าหมายคือพิสูจน์ความถูกต้องของ Workflow การเงิน และการปฏิบัติงานภายใต้ข้อมูลจริงในวงจำกัด",
    )

    add_table(
        doc,
        ["หัวข้อ", "ข้อเสนอ Pilot", "เหตุผล"],
        [
            ("จำนวน Agent", "1 ถึง 3 ราย", "จำกัดผลกระทบและติดตามได้ใกล้ชิด"),
            ("วงเงิน", "กำหนดต่อ Agent ต่อบิล และต่อเลข", "จำกัดความเสี่ยงทางการเงิน"),
            ("ช่วงเวลา", "หนึ่ง Draw หรือหนึ่งรอบที่ตกลง", "ปิดขอบเขตการทดสอบ"),
            ("การแก้ไข", "หลัง Cutoff ต้องมี Admin และ Checker", "ป้องกันการแก้ย้อนหลังโดยบุคคลเดียว"),
            ("ผลรางวัล", "Maker Checker และบันทึกแหล่งอ้างอิง", "ลดความผิดพลาดก่อนจ่าย"),
            ("รายงาน", "Export ก่อนและหลัง Settlement", "ใช้กระทบยอดกับเงินและรายการจริง"),
            ("Fallback", "แบบฟอร์มหรือไฟล์สำรองที่ควบคุมเวอร์ชัน", "ดำเนินงานต่อเมื่อระบบขัดข้อง"),
            ("Support", "War Room และผู้รับผิดชอบตัดสินใจ", "แก้เหตุได้ทันเวลา"),
        ],
        widths=[1.2, 2.9, 2.65],
        aligns=[WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT],
        font_size=8.7,
    )

    add_heading(doc, "Go No Go Checklist", 2)
    add_table(
        doc,
        ["Gate", "ต้องผ่าน", "ผู้อนุมัติ"],
        [
            ("Business Rules", "นิยาม 16 ประเภท เรต คอม และ Cutoff ถูกล็อก", "Product Owner"),
            ("Legal and Compliance", "ยืนยันว่ารูปแบบ Pilot และเงินจริงดำเนินการได้", "ผู้รับผิดชอบธุรกิจหรือที่ปรึกษา"),
            ("Data Integrity", "Test การคำนวณและ Reconciliation ผ่าน", "CTO and Finance"),
            ("Security", "RBAC Negative Test และ Audit Test ผ่าน", "CTO"),
            ("Backup", "Restore Drill สำเร็จและรู้เวลาที่ใช้", "Operations"),
            ("Operations", "Runbook Contact Escalation และ Fallback พร้อม", "Pilot Lead"),
            ("User Readiness", "Agent ทดลองสร้างบิลและเข้าใจ Cutoff", "Business Owner"),
        ],
        widths=[1.25, 3.9, 1.6],
        aligns=[WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT],
        font_size=8.6,
    )

    add_heading(doc, "Pilot Day Timeline", 2)
    add_table(
        doc,
        ["ช่วง", "กิจกรรม", "หลักฐานที่เก็บ"],
        [
            ("ก่อนเปิดรอบ", "ตรวจ Health Backup User Limit และเวลา Cutoff", "Preflight Checklist"),
            ("ระหว่างรับบิล", "เฝ้า Error Rate Latency ยอดและรายการผิดปกติ", "Dashboard and Incident Log"),
            ("ก่อน Cutoff", "แจ้ง Agent ตรวจ Draft และหยุดรายการค้าง", "Agent Confirmation"),
            ("หลัง Cutoff", "สร้าง Close Snapshot Backup และยอดรวม", "Close Report"),
            ("หลังประกาศผล", "Maker ลงผล Checker ตรวจและอนุมัติ", "Approved Result Version"),
            ("Settlement", "คำนวณ ตรวจรายการชนะ และกระทบยอด", "Settlement Report"),
            ("ปิดวัน", "Owner อนุมัติ สรุป Incident และข้อแก้ไข", "Pilot Signoff"),
        ],
        widths=[1.2, 3.7, 1.85],
        aligns=[WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT],
        font_size=8.7,
    )

    # Acceptance, risk, decisions
    add_heading(doc, "10 เกณฑ์รับมอบ ความเสี่ยง และรายการที่ต้องตัดสินใจ", 1, before=0)
    add_heading(doc, "Definition of Done สำหรับ Pilot", 2)
    add_bullets(
        doc,
        [
            "Functional Test ของ Login Agent Bill Audit Draw Result Settlement และ Report ผ่านทั้งหมด",
            "Permission Test ยืนยันว่า Agent เข้าถึงข้อมูลข้ามรายไม่ได้",
            "Test Case การเงินอย่างน้อยหนึ่งกรณีต่อรางวัลทั้ง 16 ประเภทผ่านการตรวจมือ",
            "การส่งคำขอยืนยันบิลหรือ Settlement ซ้ำไม่สร้างรายการซ้ำ",
            "Backup Restore Drill สำเร็จและมี Runbook ที่ผู้ปฏิบัติงานทำตามได้",
            "หน้า Demo และข้อมูลตัวอย่างแสดงป้ายข้อมูลสาธิตอย่างชัดเจน",
            "ผู้ใช้ Pilot ผ่าน UAT และลงนามรับทราบกติกาการแก้ไข Cutoff และ Fallback",
        ],
    )

    add_heading(doc, "Risk Register", 2)
    add_table(
        doc,
        ["ความเสี่ยง", "ผลกระทบ", "วิธีลดความเสี่ยง", "เจ้าของ"],
        [
            ("กติกา 16 ประเภทยังไม่ชัด", "คำนวณผิด", "ล็อก Rulebook และ Test Case ก่อนเขียน Settlement", "Product"),
            ("แก้บิลหลัง Cutoff", "ยอดไม่ตรงและข้อพิพาท", "Change Request Maker Checker และ Audit", "Operations"),
            ("ผลรางวัลผิด", "จ่ายเงินผิด", "Result Version และผู้ตรวจคนที่สอง", "Checker"),
            ("ผู้ใช้เห็นข้อมูลข้าม Agent", "ข้อมูลรั่วไหล", "Server RBAC Tenant Scope และ Negative Test", "CTO"),
            ("ระบบล่มช่วงรับบิล", "รายการตกหล่น", "Health Alert Backup Fallback และ Incident Log", "Operations"),
            ("สูตรคอมไม่ตรงข้อตกลง", "Settlement ผิด", "Config Version และ Signoff ต่อ Agent", "Finance"),
            ("ใช้เงินจริงก่อนผ่านข้อกำกับ", "ความเสี่ยงทางกฎหมาย", "Legal Compliance Gate ก่อน Go Live", "Business Owner"),
        ],
        widths=[1.45, 1.25, 2.85, 1.2],
        aligns=[WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.CENTER],
        font_size=7.9,
    )

    add_heading(doc, "Decision Log ที่ต้องปิดภายใน 2 พฤศจิกายน", 2)
    add_table(
        doc,
        ["ลำดับ", "คำถามตัดสินใจ", "คำตอบหรือผู้รับผิดชอบ"],
        [
            ("1", "รางวัลประเภท 1 ถึง 16 คืออะไร และตรวจเลขแบบใด", "Business Owner"),
            ("2", "อัตราจ่ายและเพดานรับของแต่ละประเภทเท่าไร", "Business and Finance"),
            ("3", "ค่าคอม Agent คิดจากยอดใด และคิดเมื่อใด", "Finance"),
            ("4", "Agent แก้บิล Confirmed ได้ถึงเวลาใด", "Operations"),
            ("5", "ใครเป็น Maker Checker และ Owner ของการปิดรอบ", "Business Owner"),
            ("6", "แหล่งผลรางวัลที่ยอมรับและวิธีแนบหลักฐานคืออะไร", "Operations"),
            ("7", "Pilot วันที่ 16 ใช้เงินจริงหรือ Shadow Mode และมีวงเงินเท่าไร", "Business and Compliance"),
            ("8", "ต้องเก็บข้อมูลและ Backup นานเท่าไร", "Business and Compliance"),
        ],
        widths=[0.55, 4.25, 1.95],
        aligns=[WD_ALIGN_PARAGRAPH.CENTER, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT],
        font_size=8.6,
    )

    add_heading(doc, "ข้อเสนอการอนุมัติ", 2)
    add_body(
        doc,
        "อนุมัติให้เริ่มพัฒนา Demo ตาม Workflow ในเอกสารนี้ โดยถือว่า Settlement Engine จะเริ่มทำได้เมื่อ Rulebook "
        "ของรางวัล 1 ถึง 16 อัตราจ่าย ค่าคอม และ Cutoff ได้รับการยืนยันแล้ว สำหรับวันที่ 16 ให้ใช้ Controlled Pilot "
        "และผ่าน Go No Go Checklist ทุกข้อก่อนเปิดรับรายการจริง",
    )

    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(16)
    p.paragraph_format.space_after = Pt(5)
    add_text(p, "ช่องลงนามรับทราบ", bold=True, size=11.5)
    add_table(
        doc,
        ["บทบาท", "ชื่อ", "ลายมือชื่อ", "วันที่"],
        [
            ("Business Owner", "", "", ""),
            ("CTO or Technical Lead", "", "", ""),
            ("Operations Lead", "", "", ""),
            ("Finance or Settlement Owner", "", "", ""),
        ],
        widths=[2.0, 1.75, 1.75, 1.25],
        aligns=[WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.LEFT, WD_ALIGN_PARAGRAPH.CENTER],
        font_size=8.8,
        header_fill=TEAL,
    )

    # Metadata and save
    doc.core_properties.title = "แผนพัฒนาระบบบริหารจัดการลอตเตอรี่"
    doc.core_properties.subject = "CTO Development Plan Workflow Architecture Demo and Pilot"
    doc.core_properties.author = "Technology and Product Team"
    doc.core_properties.keywords = "Lottery System Workflow Audit Agent Settlement Demo Pilot"
    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc.save(OUT)
    print(str(OUT))


if __name__ == "__main__":
    build()
