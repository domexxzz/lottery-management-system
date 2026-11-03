# ระบบบริหารจัดการลอตเตอรี่

ระบบรับบิลจาก Agent ปิดรอบ ลงผลรางวัล และสรุปการเงินแยกตาม Agent
พร้อมร่องรอยตรวจสอบย้อนหลังทุกการเปลี่ยนแปลง

อ้างอิงขอบเขตจาก [แผนพัฒนาระบบ (CTO Development Plan)](docs/Lottery_System_CTO_Development_Plan_TH.docx)
และแผนงานรายเฟสใน [docs/PHASE_PLAN.md](docs/PHASE_PLAN.md)

---

## ⚠️ สถานะปัจจุบัน

**ยังไม่พร้อมใช้งานจริง** — ระบบทำงานได้ถึงขั้นรับบิลและปิดรอบ แต่ยังคำนวณเงินไม่ได้

| เฟส | สถานะ | หมายเหตุ |
|---|---|---|
| P0 Rulebook และข้อตัดสินใจ | 🔴 รอลงนาม | อัตราจ่ายในระบบยังเป็นค่าสมมติ |
| P1 รากฐานและสิทธิ์ | 🟢 8/9 | เหลือ staging ที่รอ cloud account |
| P2 บิลและรอบ | 🟢 ครบ | |
| P3 ลงผลและคำนวณเงิน | 🟡 ครบแต่ใช้ค่าสมมติ | เครื่องยนต์ทำงานจริง แต่อัตราจ่ายและกฎปัดเศษยังไม่ได้รับการยืนยัน |
| P4 รายงาน | ⚪ ยังไม่เริ่ม | |
| P5 Audit และ Ops | 🟡 บางส่วน | audit log ทำแล้ว ที่เหลือยังไม่ทำ |

> **อัตราจ่ายรางวัลทั้ง 16 ประเภทที่อยู่ในระบบตอนนี้เป็นค่าที่ทีมพัฒนาใส่ไว้เพื่อให้ระบบรันได้
> ไม่ได้มาจากฝ่ายธุรกิจ ห้ามนำขึ้น production ก่อนปิด**
> [RULEBOOK_WORKSHEET.md](docs/RULEBOOK_WORKSHEET.md)

ติดตามงานที่ [Jira · โปรเจกต์ LOT](https://g-team-secvx9wq.atlassian.net/jira/software/projects/LOT/boards/108/backlog)

---

## เริ่มต้นใช้งาน

ต้องมี Node.js 24 ขึ้นไป และ Docker

```bash
npm install
```

```bash
cp .env.example .env
```

```bash
npm run db:up && npx prisma migrate deploy && npx prisma db seed
```

```bash
npm run dev
```

เปิด http://localhost:3000

### บัญชีทดสอบ

seed สร้างบัญชีครบทั้ง 4 บทบาท: `owner`, `admin`, `checker`, `agent1`, `agent2`, `agent3`
ทุกบัญชีใช้รหัสผ่านจาก `SEED_PASSWORD` ใน `.env` และถูกบังคับเปลี่ยนรหัสผ่านตอน login ครั้งแรก

> Postgres ใน `docker-compose.yml` map ออกที่พอร์ต **5433** ไม่ใช่ 5432
> เพราะเครื่องพัฒนามักมี PostgreSQL ของตัวเองครอง 5432 อยู่แล้ว

---

## คำสั่งที่ใช้บ่อย

| คำสั่ง | ทำอะไร |
|---|---|
| `npm run dev` | รัน dev server |
| `npm test` | รัน unit test |
| `npm run verify` | type check + test + build (ชุดเดียวกับ CI) |
| `npm run db:up` | สตาร์ต Postgres ใน Docker |
| `npm run db:migrate` | สร้างและรัน migration ใหม่ |
| `npm run db:seed` | ใส่ข้อมูลตั้งต้น |
| `npm run db:studio` | เปิด Prisma Studio ดูข้อมูล |
| `npm run job:cutoff` | ปิดรอบที่ถึงเวลา Cutoff ด้วยมือ |

---

## สิ่งที่ทำได้แล้ว

- เข้าสู่ระบบ บังคับเปลี่ยนรหัสผ่านครั้งแรก session เก็บเป็น hash และเพิกถอนได้
- สิทธิ์ 4 บทบาทตาม Permission Matrix บังคับที่ฝั่ง server ทุกคำขอ
- จัดการ Agent — วงเงิน อัตราคอม ระงับแล้วตัด session ทันที
- จัดการรอบ สร้าง ปิดด้วยมือ และปิดอัตโนมัติเมื่อถึง Cutoff
- สร้างบิล ตรวจกฎครบ ยืนยันบิลพร้อมออกเลขบิลและล็อกอัตราจ่าย
- ยกเลิกบิลหลังปิดรับแบบ Admin เสนอ Owner อนุมัติ
- พิมพ์บิลแบบ A4 และแบบสลิป
- แก้ Rulebook รางวัล 16 ประเภทในระบบ ไม่ต้อง deploy ใหม่
- ลงผลรางวัลแบบ Maker-Checker และคำนวณเงินต่อ Agent
- กระทบยอดและปิดบัญชีรอบ พร้อมไฟล์กระทบยอด CSV
- Audit Log ทุกการเปลี่ยนแปลงพร้อม before/after เหตุผล และ request_id

## สิ่งที่ยังไม่มี

- รายงานและ Dashboard (P4)
- หน้าดู Audit Log, rate limit, CSRF, backup/restore, monitoring (P5)
- staging และ production

---

## สถาปัตยกรรม

Next.js 16 (App Router) + TypeScript + Prisma 7 + PostgreSQL
ใช้โค้ดเบสเดียวครอบทั้งหน้าเว็บและ API ตามที่เอกสาร CTO บทที่ 6 เสนอไว้

```
src/
├── app/              หน้าเว็บและ server action
│   ├── bills/        สร้าง ดู ยืนยัน พิมพ์บิล
│   ├── draws/        จัดการรอบ
│   ├── agents/       จัดการ Agent
│   ├── prize-types/  Rulebook รางวัล 1-16
│   └── api/          health check และ cutoff job
├── lib/              ตรรกะธุรกิจ ไม่พึ่ง React
│   ├── auth/         session, RBAC, ขอบเขตการมองเห็น
│   ├── bills/        validation, state machine, service
│   ├── draws/        รอบและ cutoff job
│   ├── agents/       Agent
│   ├── prizeTypes/   Rulebook
│   ├── audit.ts      ตัวเขียน Audit Log
│   └── logger.ts     structured logging
└── middleware.ts     ออก request_id ให้ทุก request
```

### หลักการที่โค้ดบังคับไว้

**คำนวณซ้ำได้** — `BillItem.payoutRateSnapshot` เก็บอัตราจ่าย ณ เวลายืนยันบิล
การคำนวณทุกครั้งอ่านจากค่านี้ ไม่ใช่จาก Rulebook ปัจจุบัน
แก้อัตราจ่ายวันนี้ บิลเมื่อวานจึงไม่เปลี่ยนตาม

**Audit เชื่อถือได้** — `writeAudit` รับ transaction client เสมอ
audit กับข้อมูลจึงลงหรือ rollback พร้อมกัน ไม่มีสถานะที่ audit ไม่ตรงกับข้อมูล

**แยกข้อมูลตาม Agent** — ทุก query ที่แตะบิลต้องผ่าน `billScope(actor)`
Agent เห็นเฉพาะบิลของตนเอง และเปิดบิลของคนอื่นได้ 404 ไม่ใช่ 403
เพราะ 403 เท่ากับยืนยันว่าบิลเลขนั้นมีอยู่จริง

**เงินเป็น Decimal** — ไม่มี float ในเส้นทางคำนวณเงินเลย

**ตามรอยข้ามชั้นได้** — ทุก request มี `request_id` ที่ปรากฏทั้งใน response header
structured log และ `AuditEvent.requestId`

### Transaction boundary ที่ห้ามแยก

| การกระทำ | ต้องอยู่ในทรานแซกชันเดียวกัน |
|---|---|
| ยืนยันบิล | ออกเลขบิล + เขียน payout snapshot + เปลี่ยนสถานะ + AuditEvent |
| ปิดรอบ | ล็อกบิลที่ยืนยันแล้ว + ยกเลิกบิลร่างค้าง + เปลี่ยนสถานะรอบ + AuditEvent |

---

## การทดสอบ

```bash
npm test
```

ครอบกฎที่ผิดแล้วเสียหายเป็นเงิน: รูปแบบเลข เลขซ้ำ (รวมกรณีรางวัลโต๊ดที่ `123` กับ `321`
ถือเป็นเลขเดียวกัน) วงเงินทุกระดับ เวลา Cutoff รวมเคสขอบ state machine ของบิล
และขอบเขตการมองเห็นข้อมูลของแต่ละบทบาท

ยังไม่ถึงเป้า coverage 80% ตามมาตรฐานทีม — ติดตามที่
[LOT-43](https://g-team-secvx9wq.atlassian.net/browse/LOT-43)

CI รันชุดเดียวกันทุก push รวมถึง `prisma migrate deploy` บน Postgres เปล่า
เพื่อจับ migration ที่พังตั้งแต่ CI ไม่ใช่ไปพังตอน deploy

> ⚠️ `main` **ยังไม่มี branch protection** — push ตรงได้โดย CI ไม่ต้องผ่าน
> เพราะ repo เป็น private บนบัญชี GitHub แบบฟรี
> ดูทางเลือกใน [DEPLOYMENT.md](docs/DEPLOYMENT.md#การป้องกัน-main)
>
> ระหว่างนี้เปิด hook ฝั่งเครื่องได้ด้วย `git config core.hooksPath .githooks`

---

## เอกสาร

| ไฟล์ | เนื้อหา |
|---|---|
| [PHASE_PLAN.md](docs/PHASE_PLAN.md) | แผนงาน 7 เฟส พร้อม Definition of Done และ risk register |
| [RULEBOOK_WORKSHEET.md](docs/RULEBOOK_WORKSHEET.md) | เอกสารกรอกและลงนามเพื่อปิด P0 |
| [DECISION_LOG.md](docs/DECISION_LOG.md) | ข้อตัดสินใจ แยกที่รอธุรกิจออกจากที่ทีมตัดสินเอง |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | ตัวแปรสภาพแวดล้อม ขั้นตอน deploy และการตามรอยปัญหา |

---

## ข้อควรรู้สำหรับคนที่เพิ่งเข้าโปรเจกต์

**อย่ารัน `npm update` โดยไม่ตรวจ** — `prisma@latest` จะดึง CLI ยุค Prisma 8 ซึ่งเข้ากันไม่ได้
กับ `@prisma/client` 7 ตอนนี้ปักหมุดไว้ที่ `7.10.1` แล้ว

**แก้ schema แล้วต้อง restart dev server** — `prisma generate` เขียน client ใหม่ลงดิสก์
แต่ dev server ที่รันอยู่ยังถือตัวเก่าไว้ จะเห็นอาการ type ผ่านแต่หน้าเว็บ 500

**ห้ามเรียก `prisma.bill` ตรง ๆ** นอกชั้น service — ต้องผ่าน `billScope(actor)` เสมอ
ไม่งั้นข้อมูล Agent รั่วข้ามกัน
