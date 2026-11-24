# Documentation Audit — ระบบบริหารจัดการลอตเตอรี่

วันที่ตรวจ: 24 พฤศจิกายน 2569  
Repository: `C:\Users\ACER\Desktop\lottery`

## สรุปขอบเขต

- หน้าจอ Route ที่ค้นพบ: 23
- API Route ที่ค้นพบ: 30
- เมนูหลัก: 12
- Role: 3 (OWNER, ADMIN, AGENT)
- Role ที่ทดสอบหน้าจอแบบโต้ตอบได้จริง: 1 (OWNER)
- หน้าจอสำคัญที่เก็บภาพจริงและทำ Annotation: 13
- ไม่ได้สร้างบัญชีหรือข้อมูลทดสอบใหม่
- ไม่ได้กดคำสั่งสร้าง แก้ไข ลบ อนุมัติ ปิดบัญชี ส่งข้อความ AI หรือส่ง Telegram

## แหล่งหลักฐาน

1. `prisma/schema.prisma` — Role, สถานะ, Data Model และข้อบังคับ Audit
2. `src/lib/auth/permissions.ts` — Permission Matrix ฝั่ง Server
3. `src/lib/navigation.ts` — เมนูตาม Role
4. `src/app/**/page.tsx`, Server Actions และ API Routes — พฤติกรรมหน้าจอและ Validation
5. `src/lib/reports/*`, `src/lib/bills/*` — สูตรคำนวณและกฎธุรกิจ
6. หน้าจอจริงจากระบบ Production ใน Session Owner และหน้า Login จาก Local Application

## Role และสถานะการตรวจ

| Role | พบในระบบ | ตรวจ Permission | Login ทดสอบจริง | หมายเหตุ |
|---|:---:|:---:|:---:|---|
| Owner | ✓ | ✓ | ✓ | สำรวจทุกเมนูหลักโดยไม่เปลี่ยนข้อมูล |
| Admin | ✓ | ✓ | — | ไม่มีรหัสผ่านทดสอบ; ระบุข้อจำกัดในคู่มือ |
| Agent | ✓ | ✓ | — | ไม่มีรหัสผ่านทดสอบ; ระบุข้อจำกัดในคู่มือ |

## ความต่างระหว่าง Repository กับ Deployment

หน้าจอ Production ที่สำรวจบางหน้ามีปุ่ม Export CSV ขณะที่ Repository ปัจจุบันและข้อกำหนดล่าสุดให้ใช้ Export Excel เท่านั้น จึงถือว่า Deployment ที่เปิดสำรวจยังไม่ตรงกับ Source Code ปัจจุบัน 100% เอกสารอธิบายพฤติกรรม Repository และใช้ภาพ Production เฉพาะตำแหน่งหน้าจอ โดยระบุความต่างนี้ไว้

## การปกป้องข้อมูล

ภาพต้นฉบับที่อาจมีข้อมูลจริงเก็บใน `tmp/manual-raw` ซึ่งไม่อยู่ใน Deliverables ภาพทุกภาพใต้ `docs/manual/screenshots` ถูกครอป Browser Chrome ปิดบังชื่อบัญชี ชื่อลูกค้า รายการเฉพาะบุคคล และข้อมูลตารางที่เสี่ยง พร้อม Annotation หมายเลข ไม่มี Password, Token หรือ API Key ในเอกสาร

## ส่วนที่ตรวจสอบไม่ได้

- การ Login และพฤติกรรมหน้าจอจริงของ Admin/Agent
- การส่ง/รับ Telegram จริง
- การเรียก Typhoon AI จริง
- การดาวน์โหลดไฟล์ Export จริงจากทุกหน้า เพราะหลีกเลี่ยงการดึงข้อมูล Production
- Workflow ที่มีผลเปลี่ยนข้อมูล เช่น สร้าง/ยืนยันบิล ลงผล ปิดบัญชี ลบงวด/ผู้ใช้/หลักฐาน

ส่วนดังกล่าวตรวจจาก Source Code และระบุว่าไม่ได้ทดสอบแบบ End-to-End ห้ามตีความว่าเป็นผลทดสอบ Production

## ปัญหาที่พบ

1. Deployment และ Repository ต่างกันเรื่อง Export CSV/Excel
2. ไม่มีบัญชีทดสอบ Admin และ Agent ที่ได้รับอนุญาต
3. Session Production มีข้อมูลจริง จึงไม่สามารถทดลองงาน Mutation ตามข้อกำหนดความปลอดภัย
4. Browser เติมรหัสผ่านแบบ Masked อัตโนมัติใน Local Login; ภาพสำหรับคู่มือปิดบังพื้นที่ดังกล่าวแล้ว

## Checklist

- [x] สำรวจเมนูครบจาก Navigation Source
- [x] สำรวจทุก Role จาก Schema และ Permission Matrix
- [x] ตรวจ Permission ฝั่ง Server
- [x] มีภาพหน้าจอจริงและ Annotation
- [x] อธิบายฟังก์ชันหลักและ Workflow
- [x] ตรวจสูตร Business Logic จาก Source Code
- [x] มี Troubleshooting และ FAQ
- [x] ใช้ Sarabun ที่ฝังใน PDF
- [x] มีสารบัญ, Bookmark, Header/Footer และเลขหน้า
- [x] ปิดบังข้อมูลลับ/ส่วนบุคคล
- [ ] Admin/Agent End-to-End — ขาดบัญชีทดสอบ
- [ ] Mutation Workflow บน Production — ตั้งใจไม่ทดสอบเพื่อไม่เปลี่ยนข้อมูลจริง

## Deliverables

- `docs/manual/system-user-manual.pdf`
- `docs/manual/role-manuals/owner.pdf`
- `docs/manual/role-manuals/admin.pdf`
- `docs/manual/role-manuals/agent.pdf`
- `docs/manual/screenshots/**`
- `docs/manual/source/**`

## ผลการตรวจ PDF รอบสุดท้าย

เรนเดอร์ PDF ทุกหน้าเป็น PNG ที่ 110 DPI และตรวจทั้งด้วยภาพรวมและการสกัดข้อความ:

| PDF | จำนวนหน้า | Bookmark | หน้าว่าง/ภาษาไทยผิดปกติ |
|---|---:|---:|---:|
| system-user-manual.pdf | 22 | 17 | 0 |
| owner.pdf | 8 | 11 | 0 |
| admin.pdf | 6 | 10 | 0 |
| agent.pdf | 5 | 10 | 0 |

รวม 41 หน้า ทุกไฟล์เป็น A4 มีฟอนต์ Sarabun ฝังใน PDF และไม่พบรูปแบบ API Key/Token ในข้อความที่สกัดได้ ภาพเรนเดอร์สำหรับตรวจสอบเก็บไว้ชั่วคราวใต้ `tmp/pdfs-final` และ contact sheet ใต้ `tmp/pdf-contacts`
