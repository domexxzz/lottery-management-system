# แผนพัฒนาระบบบริหารจัดการลอตเตอรี่ — แบ่งตาม Phase

อ้างอิง: `docs/Lottery_System_CTO_Development_Plan_TH.docx` (CTO Development Plan v1.0)
จัดทำ: 3 พฤศจิกายน 2026 · สำหรับนำเข้า Jira เป็น Epic + Story

---

## คำเตือนเรื่องไทม์ไลน์ (อ่านก่อน)

เอกสาร CTO ตั้งเป้า **Demo 7 พ.ย.** และ **Pilot 16 พ.ย. 2026** แต่วันนี้คือ **3 พ.ย.** และ
ในโฟลเดอร์โปรเจกต์ยังไม่มีซอร์สโค้ดระบบเลย — มีแค่สคริปต์สร้างเอกสาร

เหลือเวลาถึง Demo **4 วันทำการ** สำหรับขอบเขตที่เอกสารระบุว่าเป็น "Demo scope" 6 โมดูล
(Identity, Agent, Bill, Draw/Cutoff, Result/Settlement, Dashboard/Report) ซึ่งตามปกติใช้เวลา
6–10 สัปดาห์สำหรับทีม 2–3 คน

**ทางเลือกที่สมจริง — ต้องเลือก 1 ข้อก่อนเริ่ม:**

| ทางเลือก | Demo 7 พ.ย. | Pilot | ความเสี่ยง |
|---|---|---|---|
| **A. Clickable prototype** | UI เดินได้ตาม storyboard บน seed data ไม่มี settlement จริง | เลื่อนเป็น ธ.ค. | ต่ำ — แต่ไม่ได้พิสูจน์ engine |
| **B. Thin vertical slice** | Login → สร้างบิล → ปิดรอบ → ลงผล → คำนวณ ครบ flow แต่รางวัลแค่ 2–3 ประเภท | 16 พ.ย. แบบจำกัดมาก (1–2 Agent, วงเงินต่ำ) | กลาง — ต้องตัด scope หนัก |
| **C. ขอบเขตเต็มตามเอกสาร** | ไม่สำเร็จ | ไม่สำเร็จ | สูง — แนะนำให้ไม่เลือก |

แผนด้านล่างเขียนตาม **ทางเลือก B** และระบุไว้ชัดว่า Story ไหนตัดออกได้ถ้าเลือก A

---

## ภาพรวม Phase

| Phase | ชื่อ | ช่วงเวลา | Exit criteria |
|---|---|---|---|
| **P0** | Decision & Rulebook Lock | 3 พ.ย. (1 วัน) | Decision Log ปิดครบ 100% — ไม่ปิด = ห้ามเริ่ม P3 |
| **P1** | Foundation & Access Control | 3–4 พ.ย. | Deploy ขึ้น staging ได้ · Login + RBAC ทำงาน · schema migrate ผ่าน |
| **P2** | Bill & Draw Management | 4–6 พ.ย. | Agent สร้าง/ยืนยัน/แก้บิลได้ · Cutoff ล็อกบิลจริง · rate snapshot ถูกเก็บ |
| **P3** | Result & Settlement Engine | 5–7 พ.ย. | Maker-Checker ลงผลได้ · คำนวณ net ต่อ Agent ตรงกับ manual check |
| **P4** | Dashboard & Report | 6–7 พ.ย. | ยอดแยก Agent / แยกรางวัล · Export CSV |
| **P5** | Audit, Security & Ops | 7–14 พ.ย. | Audit log ครบทุก mutation · Backup/Restore ซ้อมผ่าน · Monitoring แจ้งเตือนได้ |
| **P6** | Demo & Controlled Pilot | 7 พ.ย. / 16 พ.ย. | Demo acceptance ผ่าน · Go/No-Go checklist ผ่านทุกข้อ |

Dependency: `P0 → P1 → P2 → P3 → P4`, `P5` ขนานกับ P2–P4, `P6` ต้องรอทุก Phase

---

## P0 — Decision & Rulebook Lock
**Epic:** ปิดข้อตัดสินใจและ Rulebook ก่อนเริ่มพัฒนา
**เหตุผล:** เอกสารบทที่ 1 ระบุชัดว่า Settlement Engine เริ่มทำได้เมื่อ Rulebook ยืนยันแล้ว
Story ใน P3 ทั้งหมด blocked by Epic นี้

| # | Story | DoD |
|---|---|---|
| P0-1 | ยืนยันนิยามรางวัล 16 ประเภท รูปแบบเลขที่รับ และข้อจำกัดยอดเดิมพัน | ตาราง rulebook ลงนามโดย Business Owner |
| P0-2 | ยืนยันอัตราจ่ายแต่ละประเภท อัตราคอมมิชชัน Agent และกฎการปัดเศษ | สูตรเขียนเป็น test case ได้ ≥10 เคส |
| P0-3 | ยืนยันเวลา Cutoff เงื่อนไขแก้ไข/ยกเลิก และผู้มีอำนาจอนุมัติ | Policy matrix อนุมัติแล้ว |
| P0-4 | ยืนยันแหล่งผลรางวัลและขั้นตอนตรวจผลก่อน Settlement | ระบุแหล่งข้อมูล + ผู้รับผิดชอบ Maker/Checker |
| P0-5 | ตรวจข้อกำกับ ใบอนุญาต PDPA และข้อจำกัดการใช้เงินจริงใน Pilot | ได้คำยืนยันเป็นลายลักษณ์อักษรว่า Pilot ทำได้ |
| P0-6 | ตัดสินใจเลือกทางเลือก A / B / C สำหรับ Demo 7 พ.ย. | บันทึกใน Decision Log + แจ้งผู้มีส่วนได้เสีย |

---

## P1 — Foundation & Access Control
**Epic:** วางรากฐานระบบและระบบสิทธิ์
**Stack ตามเอกสาร:** Responsive Web/PWA + Modular API + PostgreSQL + managed cloud + TLS + daily backup

| # | Story | DoD |
|---|---|---|
| P1-1 | ตั้ง repo, git, โครงสร้างโปรเจกต์ frontend/backend, lint, formatter | `git init` แล้ว · commit แรกผ่าน lint |
| P1-2 | ตั้ง CI pipeline — build + test + type check ทุก push | CI เขียวบน main |
| P1-3 | Schema migration ครบ 10 entity (Organization, User, Agent, Draw, PrizeType, Bill, BillItem, Result, Settlement, AuditEvent) | `migrate up/down` ผ่าน · FK + unique constraint ครบ |
| P1-4 | Seed data — 1 org, 4 role, 3 agent, 16 prize type, 1 draw ตัวอย่าง | รัน seed บน DB เปล่าได้ |
| P1-5 | Authentication — login, session, logout, บังคับเปลี่ยนรหัสผ่านครั้งแรก | password hash ด้วย argon2/bcrypt · session หมดอายุได้ |
| P1-6 | RBAC enforcement ฝั่ง server ตาม Permission Matrix 4 role (Owner/Admin/Checker/Agent) | ทุก endpoint มี authz check · test ครอบทุกช่องในตาราง matrix |
| P1-7 | Tenant + Agent scoping ในทุก query ที่แตะบิล | test: Agent A อ่านบิล Agent B ไม่ได้ (403/empty) |
| P1-8 | Deploy ขึ้น staging — TLS, env config, health check endpoint | เปิด URL staging ได้จากภายนอก |
| P1-9 | Structured logging พร้อม request_id ทุก request | ค้น log ด้วย request_id เจอ chain ครบ |

> **ถ้าเลือกทางเลือก A:** P1-2, P1-8, P1-9 เลื่อนไป P5 ได้

---

## P2 — Bill & Draw Management
**Epic:** จัดการรอบ บิล และการปิดรับ

| # | Story | DoD |
|---|---|---|
| P2-1 | Agent Management — สร้าง/แก้ Agent, สถานะ, อัตราคอม, วงเงิน | Admin สร้าง Agent ได้ · ระงับแล้ว Agent login ไม่ได้ |
| P2-2 | Draw Management — สร้างรอบ, เวลาเปิดรับ, Cutoff, สถานะรอบ | Draw lifecycle: Open → Locked → Closed |
| P2-3 | สร้างบิล (Draft) — ชื่อบิล/รหัสลูกค้า + เพิ่มรายการรางวัล 1–16 เลข ยอดเดิมพัน | บันทึก Draft ได้ · แก้ไข Draft ได้อิสระ |
| P2-4 | Validation real-time — รูปแบบเลข, เลขซ้ำในบิล, วงเงิน Agent, วงเงินต่อเลข, เวลา Cutoff | ทุกกฎ validate ทั้ง client และ server · test ครอบทุกกฎ |
| P2-5 | ยืนยันบิล — สร้างเลขบิล, เก็บ payout snapshot ลง BillItem, บันทึก Audit | เลขบิล unique · snapshot ไม่เปลี่ยนเมื่อแก้เรตภายหลัง |
| P2-6 | ดู/พิมพ์บิล ตามสิทธิ์ | Agent เห็นแค่บิลตัวเอง · พิมพ์ได้ A4/slip |
| P2-7 | Bill State Lifecycle — Draft → Confirmed → Locked → Settled → Cancelled | transition ที่ไม่ถูกต้องถูกปฏิเสธพร้อม error ชัดเจน |
| P2-8 | Cutoff job — ถึงเวลาแล้วล็อกบิลทุกใบในรอบอัตโนมัติ | worker/scheduler ทำงาน · ล็อกแล้วสร้างบิลใหม่ไม่ได้ |
| P2-9 | แก้/ยกเลิกบิลหลัง Cutoff — ต้องมีเหตุผล + ผู้อนุมัติ | Agent ทำไม่ได้ · Admin เสนอ Owner อนุมัติ · Audit บันทึกครบ |

> Transaction boundary (ห้ามแยก): การยืนยันบิลต้องเขียน Bill + BillItems + AuditEvent ใน transaction เดียว

---

## P3 — Result & Settlement Engine
**Epic:** ลงผลรางวัลและคำนวณการเงิน
**Blocked by:** P0-1, P0-2, P0-4 — ห้ามเริ่มโค้ด settlement ก่อน rulebook ปิด

| # | Story | DoD |
|---|---|---|
| P3-1 | ลงผลรางวัล (Maker) — กรอกผลแต่ละประเภท บันทึกเป็น Draft + version | Admin ลงผลได้ · ผล Draft ยังไม่ trigger คำนวณ |
| P3-2 | ตรวจและอนุมัติผล (Checker) — Maker-Checker แยกคน | คนเดียวกันลงผลและอนุมัติไม่ได้ · reject ได้พร้อมเหตุผล |
| P3-3 | Matching engine — จับคู่ BillItem กับ Result ตามกฎรางวัลแต่ละประเภท | unit test ≥20 เคสครอบทุกประเภทรางวัล |
| P3-4 | คำนวณการเงิน — gross, payout, commission, net ต่อ Agent ต่อรอบ | ตรงกับ manual spreadsheet check 100% · ปัดเศษตาม P0-2 |
| P3-5 | Settlement Draft → กระทบยอด → Owner อนุมัติ → รอบ Closed | รอบ Closed แล้วแก้ผล/บิลไม่ได้ |
| P3-6 | Recalculation — คำนวณซ้ำได้จาก snapshot ให้ผลเดิมทุกครั้ง | รันซ้ำ 3 ครั้งได้ผลเท่ากัน |
| P3-7 | Reconciliation export — ไฟล์สำรองสำหรับกระทบยอดด้วยมือ | CSV มีรายการบิล ผล และยอดจ่ายครบ |

> Transaction boundary: การ approve settlement ต้องเขียน Settlement + Draw status + AuditEvent ใน transaction เดียว

---

## P4 — Dashboard & Report
**Epic:** รายงานและ Dashboard

| # | Story | DoD |
|---|---|---|
| P4-1 | Dashboard ยอดรวมรอบปัจจุบัน — รับ จ่าย คอม สุทธิ | ตัวเลขตรงกับ settlement |
| P4-2 | รายงานแยกตาม Agent | Agent เห็นแค่ของตัวเอง · Admin เห็นทุกราย |
| P4-3 | รายงานแยกตามประเภทรางวัล 1–16 | ยอดขายและยอดจ่ายต่อประเภท |
| P4-4 | Export CSV/Excel ทุกรายงาน | เปิดใน Excel ได้ ภาษาไทยไม่เพี้ยน (UTF-8 BOM) |
| P4-5 | หน้าค้นหาบิล — ตามเลขบิล ชื่อบิล Agent รอบ สถานะ | ค้นเจอใน <2 วินาทีบน seed data |

---

## P5 — Audit, Security & Operations
**Epic:** Audit Log ความปลอดภัย และความพร้อมใช้งาน
**รันขนานกับ P2–P4** — เอกสารจัดโมดูลนี้เป็น Pilot scope

| # | Story | DoD |
|---|---|---|
| P5-1 | Audit Log — ทุก mutation เก็บ actor, action, before, after, reason, timestamp | ไม่มี write path ไหนเลี่ยง audit ได้ |
| P5-2 | หน้าดู Audit Log + filter ตาม entity/ผู้ใช้/ช่วงเวลา | Agent เห็นแค่บิลตัวเอง |
| P5-3 | Security hardening — rate limit, CSRF, security headers, input sanitization | OWASP Top 10 checklist ผ่าน |
| P5-4 | Secret management — ไม่มี credential ใน repo, ใช้ env/secret manager | scan repo ไม่พบ secret · startup validate ว่า env ครบ |
| P5-5 | Daily backup + ซ้อม Restore | restore ลง DB เปล่าสำเร็จ · จับเวลา RTO ได้ |
| P5-6 | Monitoring + error tracking + alert | ทำ error เทียมแล้วได้ alert จริง |
| P5-7 | Operating Runbook — ขั้นตอนรับมือเหตุขัดข้อง ติดต่อใคร rollback อย่างไร | ทีม ops อ่านแล้วทำตามได้โดยไม่ถาม dev |
| P5-8 | Test coverage ≥80% ตามมาตรฐานทีม | รายงาน coverage ใน CI |

---

## P6 — Demo & Controlled Pilot
**Epic:** ส่งมอบ Demo และ Controlled Pilot

### Demo — 7 พฤศจิกายน 2026
| # | Story | DoD |
|---|---|---|
| P6-1 | เตรียม demo environment + seed data ที่เล่า story ได้ | reset กลับสถานะเริ่มต้นได้ด้วยคำสั่งเดียว |
| P6-2 | ซ้อม Demo Storyboard 15 นาที ตามเอกสารบทที่ 8 | ซ้อมจบใน 15 นาที ไม่มี error |
| P6-3 | ตรวจ Demo Acceptance Criteria ทุกข้อ | ทุกข้อผ่าน หรือมีบันทึกว่าตัดออกพร้อมเหตุผล |

### Controlled Pilot — 16 พฤศจิกายน 2026
| # | Story | DoD |
|---|---|---|
| P6-4 | Go/No-Go Checklist ตามเอกสารบทที่ 9 | ทุกข้อผ่านก่อนเปิดรับรายการจริง |
| P6-5 | จำกัดขอบเขต Pilot — จำนวน Agent วงเงิน และรอบที่ใช้ | config จำกัดได้จริง ไม่ใช่แค่ตกลงปากเปล่า |
| P6-6 | Pilot Day Timeline + ทีม standby + ช่องทางแจ้งปัญหา | ตารางเวลาและผู้รับผิดชอบแต่ละช่วงชัดเจน |
| P6-7 | Rollback plan — หยุด pilot และกระทบยอดด้วยมือได้ | ซ้อม rollback สำเร็จก่อนวัน pilot |
| P6-8 | Definition of Done สำหรับ Pilot — ตรวจครบทุกข้อ | Owner เซ็นรับมอบ |

---

## Risk Register (สรุปจากเอกสาร + ที่พบเพิ่ม)

| ความเสี่ยง | ผลกระทบ | การรับมือ |
|---|---|---|
| **ไทม์ไลน์ 4 วันถึง Demo โดยไม่มีโค้ด** | สูงมาก | เลือกทางเลือก A หรือ B ใน P0-6 วันนี้ |
| Rulebook 16 ประเภทยังไม่ปิด | สูง | P0 เป็น blocker ของ P3 — ห้ามเริ่มโค้ด settlement ก่อน |
| คำนวณเงินผิด | สูง | snapshot เรต + recalculation test + reconciliation export |
| สิทธิ์รั่วข้าม Agent | สูง | authz test ทุกช่องใน permission matrix |
| แก้บิลหลัง Cutoff โดยไม่มีร่องรอย | สูง | audit log บังคับ + maker-checker |
| ข้อกำกับ/ใบอนุญาตไม่ชัดก่อน Pilot | สูง | P0-5 ต้องได้คำยืนยันเป็นลายลักษณ์อักษร |
| ทีมขนาดเล็ก ไม่มี backup คน | กลาง | เขียน runbook + pair ใน story สำคัญ |

---

## สรุปจำนวน Issue ที่จะสร้างใน Jira

| Phase | Epic | Story |
|---|---|---|
| P0 | 1 | 6 |
| P1 | 1 | 9 |
| P2 | 1 | 9 |
| P3 | 1 | 7 |
| P4 | 1 | 5 |
| P5 | 1 | 8 |
| P6 | 1 | 8 |
| **รวม** | **7** | **52** |
