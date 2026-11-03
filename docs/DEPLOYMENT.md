# การติดตั้งใช้งาน

เอกสารนี้ครอบคลุม [LOT-35](https://g-team-secvx9wq.atlassian.net/browse/LOT-35) (P1-8)
และเป็นวัตถุดิบของ Operating Runbook ใน [LOT-42](https://g-team-secvx9wq.atlassian.net/browse/LOT-42) (P5-7)

> **สถานะ:** ยังไม่มี staging จริง — ไฟล์และขั้นตอนพร้อมแล้ว แต่ต้องมีผู้มีสิทธิ์
> จัดหา cloud account, โดเมน และใบรับรอง TLS จึงจะ provision ได้

---

## รันบนเครื่องตัวเอง

```bash
npm install
cp .env.example .env
npm run db:up
npx prisma migrate deploy
npx prisma db seed
npm run dev
```

เปิด http://localhost:3000 · บัญชีที่ seed สร้างคือ `owner`, `admin`, `checker`, `agent1`–`agent3`
ทุกบัญชีใช้รหัสจาก `SEED_PASSWORD` และถูกบังคับเปลี่ยนรหัสผ่านตอน login ครั้งแรก

> Postgres ใน `docker-compose.yml` map ออกที่พอร์ต **5433** ไม่ใช่ 5432
> เพราะเครื่อง dev มักมี PostgreSQL ของตัวเองครอง 5432 อยู่แล้ว

---

## ตัวแปรสภาพแวดล้อม

| ตัวแปร | จำเป็น | ความหมาย |
|---|---|---|
| `DATABASE_URL` | ✅ | connection string ของ PostgreSQL |
| `NODE_ENV` | ✅ | ต้องเป็น `production` บน staging และ production เพื่อบังคับ Secure cookie |
| `SESSION_TTL_MINUTES` | | อายุ session หน่วยนาที ค่าเริ่มต้น 480 |
| `SESSION_COOKIE_NAME` | | ชื่อ cookie ค่าเริ่มต้น `lottery_session` |
| `CUTOFF_JOB_TOKEN` | | token ให้ scheduler เรียก cutoff job · **ไม่ตั้ง = ปิด endpoint** |
| `LOG_LEVEL` | | `debug` / `info` / `warn` / `error` ค่าเริ่มต้นบน production คือ `info` |
| `SEED_PASSWORD` | | ใช้ตอน seed เท่านั้น **ห้ามตั้งบน production** |

สร้าง `CUTOFF_JOB_TOKEN`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

---

## Deploy ด้วย container

```bash
docker build -t lottery-system:latest .
```

ขั้นตอนตอน deploy ต้องทำตามลำดับนี้เสมอ:

```bash
npx prisma migrate deploy
```

```bash
docker run -d --name lottery -p 3000:3000 --env-file .env.production lottery-system:latest
```

`migrate deploy` ต้องรัน**ก่อน**สตาร์ตแอปตัวใหม่ ไม่งั้นโค้ดใหม่จะวิ่งชนตารางเก่า
และ `migrate deploy` ต่างจาก `migrate dev` ตรงที่ไม่สร้าง migration ใหม่และไม่ล้างข้อมูล

Container มี `HEALTHCHECK` ยิงไปที่ `/api/health` ซึ่งเช็กว่าต่อฐานข้อมูลได้จริง
ไม่ใช่แค่ process ยังอยู่

---

## สิ่งที่ยังขาดก่อนขึ้น staging ได้จริง

| รายการ | ใครทำ | หมายเหตุ |
|---|---|---|
| Cloud account และสิทธิ์ | Business Owner | ยังไม่มีใครจัดหาให้ |
| โดเมนและใบรับรอง TLS | Operations | เอกสาร CTO บทที่ 6 ระบุว่าต้องมี TLS |
| Managed PostgreSQL + daily backup | Operations | [LOT-40](https://g-team-secvx9wq.atlassian.net/browse/LOT-40) |
| Secret manager | Operations | [LOT-60](https://g-team-secvx9wq.atlassian.net/browse/LOT-60) ตอนนี้ยังใช้ไฟล์ env |
| Scheduler เรียก cutoff job | Operations | cron ทุกนาที ดูด้านล่าง |
| Error tracking และ alert | Operations | [LOT-41](https://g-team-secvx9wq.atlassian.net/browse/LOT-41) |

---

## ตั้ง scheduler ให้ cutoff job

เลือกทางใดทางหนึ่ง

**ก. เรียกผ่าน HTTP** — เหมาะเมื่อแอปอยู่หลัง load balancer

```bash
curl -fsS -X POST -H "x-job-token: $CUTOFF_JOB_TOKEN" https://staging.example.com/api/jobs/cutoff
```

**ข. รันเป็น process แยก** — เหมาะเมื่อมีเครื่องที่ต่อฐานข้อมูลได้โดยตรง

```bash
npm run job:cutoff
```

งานนี้เป็น idempotent · รอบที่ปิดไปแล้วจะไม่ถูกเลือกซ้ำ เรียกถี่เกินไปจึงไม่เป็นอันตราย
แนะนำให้รันทุกนาที เพื่อให้ช่องว่างระหว่างเวลา Cutoff จริงกับเวลาที่บิลถูกล็อกไม่เกิน 1 นาที

---

## การป้องกัน main

**ยังไม่มีการป้องกันที่ฝั่ง GitHub**

ลองตั้งทั้ง branch protection แบบเดิมและ repository ruleset แบบใหม่แล้ว ทั้งสองทางตอบกลับว่า
`Upgrade to GitHub Pro or make this repository public to enable this feature` (HTTP 403)
เพราะ repo นี้เป็น private อยู่บนบัญชีแบบฟรี

แปลว่าตอนนี้ **push ตรงเข้า main ได้โดย CI ไม่ต้องผ่าน** — CI ที่ตั้งไว้เป็นเพียงสัญญาณเตือน
ไม่ใช่ประตูกั้น

### ทางเลือกในการแก้ เรียงตามที่แนะนำ

| ทางเลือก | ค่าใช้จ่าย | ข้อสังเกต |
|---|---|---|
| ย้าย repo ไปใต้ organization ที่มีแผน Team | ตามจำนวนสมาชิก | เหมาะที่สุดถ้าทำงานเป็นทีมอยู่แล้ว และได้เรื่องสิทธิ์เข้าถึงไปด้วย |
| อัปเกรดบัญชีเป็น GitHub Pro | ประมาณ 4 USD ต่อเดือน | ถูกและเร็วที่สุดถ้ายังเป็นคนเดียว |
| เปลี่ยน repo เป็น public | ฟรี | **ไม่แนะนำ** — เป็นระบบที่จัดการเงินและข้อมูลส่วนบุคคล |

เมื่ออัปเกรดแล้ว ตั้งค่าได้ด้วยคำสั่งเดียว โดยให้ status check ชื่อ `verify` เป็นเงื่อนไข:

```bash
gh api -X PUT repos/OWNER/REPO/branches/main/protection --input protection.json
```

### มาตรการชั่วคราวบนเครื่องตัวเอง

repo มี `.githooks/pre-push` ที่รัน type check และ unit test ก่อนยอมให้ push ขึ้น main
เปิดใช้งานด้วย:

```bash
git config core.hooksPath .githooks
```

ข้อจำกัดที่ต้องรู้ — **อันนี้ไม่ทดแทน branch protection**

- ทำงานเฉพาะบนเครื่องที่รันคำสั่งข้างบนแล้ว คนอื่นในทีมต้องรันเอง
- ข้ามได้ด้วย `git push --no-verify`
- ไม่ได้ตรวจ `next build` เพราะจะช้าเกินไปสำหรับ pre-push · CI ยังตรวจให้อยู่

---

## การตามรอยปัญหา

ทุก request มี `x-request-id` ทั้งใน response header และใน log
เมื่อผู้ใช้แจ้งปัญหา ให้ขอค่านี้แล้วค้นได้ทั้งสองที่:

```bash
grep '"requestId":"<ค่าที่ได้มา>"' /var/log/lottery/app.log
```

```sql
SELECT * FROM audit_events WHERE "requestId" = '<ค่าที่ได้มา>' ORDER BY "createdAt";
```

log เป็น JSON บรรทัดละเหตุการณ์ จึงส่งเข้าระบบรวบรวม log ได้โดยไม่ต้องเขียน regex
