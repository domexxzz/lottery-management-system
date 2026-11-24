from __future__ import annotations

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter


ROOT = Path(__file__).resolve().parents[3]
RAW = ROOT / "tmp" / "manual-raw"
OUT = ROOT / "docs" / "manual" / "screenshots"
FONT_REGULAR = ROOT / "src" / "app" / "fonts" / "Sarabun-Regular.ttf"
FONT_BOLD = ROOT / "src" / "app" / "fonts" / "Sarabun-Bold.ttf"


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT_BOLD if bold else FONT_REGULAR), size)


def redact(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], label: str = "ปกปิดข้อมูลส่วนบุคคล") -> None:
    draw.rounded_rectangle(box, radius=12, fill="#E8EEF5", outline="#B7C7D9", width=2)
    x1, y1, x2, y2 = box
    if x2 - x1 > 180 and y2 - y1 > 34:
        draw.text((x1 + 14, y1 + 8), label, fill="#52657A", font=font(19, True))


def callout(draw: ImageDraw.ImageDraw, number: int, point: tuple[int, int], label_pos: tuple[int, int], text: str) -> None:
    px, py = point
    lx, ly = label_pos
    draw.line((lx + 18, ly + 18, px, py), fill="#E83E5B", width=5)
    r = 22
    draw.ellipse((px - r, py - r, px + r, py + r), fill="#E83E5B", outline="white", width=4)
    n = str(number)
    bbox = draw.textbbox((0, 0), n, font=font(24, True))
    draw.text((px - (bbox[2] - bbox[0]) / 2, py - (bbox[3] - bbox[1]) / 2 - 2), n, fill="white", font=font(24, True))
    tb = draw.textbbox((0, 0), text, font=font(20, True))
    w = tb[2] - tb[0] + 28
    h = 42
    draw.rounded_rectangle((lx, ly, lx + w, ly + h), radius=12, fill="white", outline="#E83E5B", width=3)
    draw.text((lx + 14, ly + 8), text, fill="#102A43", font=font(20, True))


PAGES = {
    "shared-login.png": {
        "folder": "shared",
        "out": "login.png",
        "redactions": [(770, 575, 1150, 627)],
        "callouts": [
            (1, (962, 508), (1130, 430), "ชื่อผู้ใช้"),
            (2, (962, 625), (1130, 600), "รหัสผ่าน"),
            (3, (962, 716), (1130, 700), "เข้าสู่ระบบ"),
        ],
    },
    "shared-change-password.png": {
        "folder": "shared",
        "out": "change-password.png",
        "redactions": [],
        "callouts": [
            (1, (970, 340), (1190, 285), "รหัสผ่านปัจจุบัน"),
            (2, (970, 455), (1190, 430), "รหัสผ่านใหม่"),
            (3, (970, 570), (1190, 555), "ยืนยันรหัสผ่าน"),
            (4, (970, 665), (1190, 655), "บันทึกรหัสผ่าน"),
        ],
    },
    "owner-dashboard.png": {
        "folder": "owner", "out": "dashboard.png",
        "redactions": [],
        "callouts": [(1, (360, 190), (520, 120), "เมนูหลัก"), (2, (920, 225), (1080, 150), "ตัวกรองงวด"), (3, (795, 510), (1040, 455), "ตัวเลขภาพรวม")],
    },
    "owner-bills.png": {
        "folder": "owner", "out": "bills.png",
        "redactions": [(260, 510, 1875, 945)],
        "callouts": [(1, (500, 205), (690, 135), "เลือกช่วงข้อมูล"), (2, (1040, 285), (1215, 230), "ค้นหาและกรอง"), (3, (1640, 205), (1425, 120), "ส่งออก Excel"), (4, (1770, 205), (1610, 250), "สร้างบิลใหม่")],
    },
    "owner-draws.png": {
        "folder": "owner", "out": "draws.png",
        "redactions": [(260, 600, 1875, 945)],
        "callouts": [(1, (490, 195), (650, 125), "ตัวกรองประเภทหวย"), (2, (1120, 275), (1280, 210), "ช่วงวันที่"), (3, (1655, 195), (1450, 120), "ส่งออก Excel"), (4, (1780, 195), (1610, 250), "สร้างงวด")],
    },
    "owner-reports.png": {
        "folder": "owner", "out": "reports.png",
        "redactions": [(260, 725, 1875, 945)],
        "callouts": [(1, (570, 205), (740, 125), "เลือกประเภทและงวด"), (2, (1000, 345), (1180, 285), "กำหนดช่วงวันที่"), (3, (1530, 385), (1320, 310), "จ่ายค่าคอม Agent"), (4, (1740, 385), (1540, 430), "สรุปบัญชี")],
    },
    "owner-evidence.png": {
        "folder": "owner", "out": "evidence.png",
        "redactions": [(260, 480, 1875, 945)],
        "callouts": [(1, (515, 205), (680, 125), "หลักฐานรอตรวจ"), (2, (805, 205), (960, 125), "ประวัติตรวจแล้ว"), (3, (1020, 320), (1195, 255), "ตัวกรองหลักฐาน"), (4, (1670, 320), (1460, 250), "ล้างตัวกรอง")],
    },
    "owner-audit.png": {
        "folder": "owner", "out": "audit.png",
        "redactions": [(260, 655, 1875, 945)],
        "callouts": [(1, (525, 205), (690, 125), "ประวัติผลรางวัล"), (2, (815, 205), (980, 125), "ประวัติบิล"), (3, (1040, 330), (1200, 270), "ช่วงเวลาที่ตรวจสอบ"), (4, (1650, 205), (1430, 125), "ส่งออก Excel")],
    },
    "owner-analytics.png": {
        "folder": "owner", "out": "analytics.png",
        "redactions": [],
        "callouts": [(1, (520, 205), (690, 125), "ขอบเขตข้อมูล"), (2, (1000, 330), (1170, 260), "ช่วงวันที่"), (3, (815, 520), (1030, 460), "ตัวชี้วัดหลัก"), (4, (1515, 610), (1320, 535), "ข้อเสนอแนะ")],
    },
    "owner-ai-assistant.png": {
        "folder": "owner", "out": "ai-assistant.png",
        "redactions": [(260, 740, 1875, 945)],
        "callouts": [(1, (500, 250), (670, 180), "คำถามแนะนำ"), (2, (840, 615), (1010, 550), "พิมพ์คำถาม"), (3, (1725, 615), (1530, 540), "ส่งข้อความ"), (4, (390, 330), (520, 360), "ประวัติการสนทนา")],
    },
    "owner-rulebook.png": {
        "folder": "owner", "out": "rulebook.png",
        "redactions": [],
        "callouts": [(1, (520, 205), (690, 125), "ประเภทหวย"), (2, (960, 285), (1130, 220), "ค้นหารางวัล"), (3, (650, 510), (820, 440), "อัตราจ่าย"), (4, (1510, 510), (1325, 440), "เงื่อนไขเลข")],
    },
    "owner-agents.png": {
        "folder": "owner", "out": "agents.png",
        "redactions": [(260, 555, 1875, 945)],
        "callouts": [(1, (555, 205), (725, 125), "เลือกขอบเขต"), (2, (1010, 330), (1180, 265), "กรอง Agent"), (3, (1650, 205), (1435, 125), "ส่งออก Excel"), (4, (930, 470), (1100, 410), "สรุปภาพรวม")],
    },
    "owner-user-management.png": {
        "folder": "owner", "out": "user-management.png",
        "redactions": [(275, 305, 1385, 930), (1405, 640, 1875, 945)],
        "callouts": [(1, (520, 210), (700, 130), "บัญชีในระบบ"), (2, (1515, 220), (1320, 135), "สร้างผู้ใช้"), (3, (1710, 735), (1500, 690), "กำหนด Role"), (4, (1700, 865), (1470, 850), "บันทึกบัญชี")],
    },
}


def process(name: str, spec: dict) -> Path:
    img = Image.open(RAW / name).convert("RGB")
    img = img.crop((0, 80, img.width, img.height))
    draw = ImageDraw.Draw(img)

    # ปกปิดชื่อผู้ใช้ในมุมหัว/ท้ายของทุกหน้าหลังเข้าสู่ระบบ
    if name.startswith("owner-") or name.startswith("shared-change"):
        redact(draw, (1690, 0, 1905, 62), "ข้อมูลบัญชี")
        redact(draw, (12, 845, 232, 945), "ข้อมูลบัญชี")

    for box in spec["redactions"]:
        redact(draw, box)
    for number, point, label_pos, text in spec["callouts"]:
        callout(draw, number, point, label_pos, text)

    target = OUT / spec["folder"] / spec["out"]
    target.parent.mkdir(parents=True, exist_ok=True)
    img.save(target, quality=92, optimize=True)
    return target


if __name__ == "__main__":
    for source_name, page_spec in PAGES.items():
        path = process(source_name, page_spec)
        print(path.relative_to(ROOT))
