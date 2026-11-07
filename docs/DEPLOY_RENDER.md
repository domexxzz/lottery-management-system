# Deploy ขึ้น Render

Blueprint อยู่ที่ [`render.yaml`](../render.yaml) ที่ราก repo
เอกสารนี้บอกว่าใครต้องทำอะไร และอะไรที่ยังไม่มีทางทำแทนกันได้

> **อ่านก่อน:** ไม่มีส่วนใดของระบบนี้รันบนแผนฟรีของ Render ได้
> เหตุผลอยู่ใน [ทำไมต้องเสียเงิน](#ทำไมต้องเสียเงิน) ด้านล่าง

---

## สิ่งที่ต้องมีก่อน

ทั้งสามข้อนี้ต้องเป็นคนที่มีสิทธิ์ผูกบัญชีและจ่ายเงินทำเอง

| สิ่งที่ต้องมี | ทำที่ไหน | เหตุผล |
|---|---|---|
| บัญชี Render ที่ผูกบัตรแล้ว | render.com | ทุกบริการในไฟล์นี้เป็นแผนที่ต้องจ่าย |
| ที่เก็บไฟล์แบบ S3 | Cloudflare R2 / AWS S3 / Backblaze B2 | Render ไม่มี S3 ให้ และดิสก์ของ Render ผูกกับ instance เดียว แชร์ข้ามบริการไม่ได้ |
| repo ต่อกับ Render | Dashboard → Blueprints | Render อ่าน `render.yaml` จาก branch ที่ระบุ |

ระบบเก็บสลิปและหลักฐานการสั่งซื้อเป็นไฟล์ ถ้าไม่มี S3 หน้าแนบหลักฐานจะพังทั้งหน้า
ไม่ใช่แค่เสียความสวยงาม — `STORAGE_PROVIDER=s3` ในโค้ดรองรับ endpoint ที่ไม่ใช่ AWS อยู่แล้ว
R2 กับ B2 จึงใช้ได้ ขอแค่ตั้ง `STORAGE_FORCE_PATH_STYLE=true`

---

## ขั้นตอน

### 1. merge งานเข้า main ก่อน

`render.yaml` ตั้ง `branch: main` ไว้ทั้งสามบริการ ตอนนี้งานยังอยู่บน
`ta/dashboard-and-inspection-history` ซึ่งนำหน้า `main` อยู่ 5 commit
ถ้า deploy ทั้งที่ยังไม่ merge Render จะ build โค้ดเก่า

เปิด PR เข้า `main` ให้ CI (`.github/workflows/ci.yml`) รันก่อน แล้วค่อย merge

### 2. สร้าง bucket

สร้าง bucket แบบ **private** ห้ามเปิด public read — ไฟล์ทุกไฟล์เข้าถึงผ่าน signed URL
อายุ 5 นาทีที่แอปออกให้เท่านั้น ถ้าเปิด public ใครมีลิงก์ก็เปิดสลิปของลูกค้าได้ตลอดไป

จด 5 ค่านี้ไว้ใช้ขั้นถัดไป

```
STORAGE_ENDPOINT      https://<account-id>.r2.cloudflarestorage.com
STORAGE_BUCKET        bill-private
STORAGE_REGION        auto          (R2 ใช้ auto · AWS ใช้ชื่อ region จริง)
STORAGE_ACCESS_KEY    <จาก R2 API token>
STORAGE_SECRET_KEY    <จาก R2 API token>
```

### 3. สร้าง Blueprint

Dashboard → **Blueprints** → **New Blueprint Instance** → เลือก repo → branch `main`

Render จะอ่าน `render.yaml` แล้วถามค่าที่ตั้ง `sync: false` ไว้ตอนสร้างครั้งเดียว

| ตัวแปร | ใส่อะไร |
|---|---|
| `APP_BASE_URL` | ยังไม่รู้ URL ตอนนี้ ใส่ `https://lottery-web.onrender.com` ไปก่อน แล้วแก้ในขั้นที่ 5 |
| `TYPHOON_API_KEY` | คีย์ Typhoon ของคุณ |

`CUTOFF_JOB_TOKEN` และ `NOTIFY_JOB_TOKEN` ไม่ต้องกรอก — `generateValue: true` สุ่มให้เอง

### 4. ใส่ความลับที่แชร์กันเข้า env group

กลุ่ม env ของ Render ใส่ `sync: false` ไม่ได้ ไฟล์ blueprint จึงประกาศได้แค่ค่าที่ไม่ใช่ความลับ
ความลับที่ทั้ง web และ worker ต้องใช้ ให้เพิ่มด้วยมือครั้งเดียวที่กลุ่ม แล้วทุกบริการได้ไปพร้อมกัน

Dashboard → **Env Groups** → `lottery-shared` → เพิ่ม

```
STORAGE_ENDPOINT
STORAGE_BUCKET
STORAGE_REGION
STORAGE_ACCESS_KEY
STORAGE_SECRET_KEY
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
TELEGRAM_TOPIC_DAILY_SUMMARY
TELEGRAM_TOPIC_EVIDENCE
```

ค่า Telegram สี่ตัวเอาจาก `.env` ในเครื่องที่ใช้งานได้อยู่แล้ว

> **โทเคน Telegram ที่เคยหลุดในแชทต้อง revoke ทิ้งก่อน** แล้วขอใหม่จาก BotFather
> ตัวที่หลุดถือว่าใช้ไม่ได้อีก ใครเห็นก็สั่งบอทแทนคุณได้

### 5. แก้ APP_BASE_URL ให้ตรงของจริง

หลัง deploy รอบแรก Render จะให้ URL จริงมา เอาค่านั้นไปใส่ `APP_BASE_URL`
ทั้งที่ `lottery-web` และ `lottery-notify`

ค่านี้คือลิงก์ที่แปะไปในข้อความ Telegram ถ้าผิด ปุ่มในแชทยังทำงาน
แต่ลิงก์ "เปิดดูในระบบ" จะพาไปผิดที่

### 6. สร้างบัญชีผู้ใช้ชุดแรก

`migrate deploy` สร้างแต่ตาราง ไม่สร้างผู้ใช้ ต้อง seed หนึ่งครั้ง

Dashboard → `lottery-web` → **Shell**

```bash
SEED_PASSWORD='<รหัสชั่วคราวที่ยาวและเดายาก>' SEED_MUST_CHANGE_PASSWORD=true npx prisma db seed
```

เสร็จแล้วได้บัญชี `owner`, `admin`, `checker`, `agent1`–`agent3` ทุกบัญชีถูกบังคับ
เปลี่ยนรหัสตอน login ครั้งแรก

**อย่าตั้ง `SEED_PASSWORD` เป็น env var ถาวรของบริการ** ใส่หน้าคำสั่งแบบข้างบนให้มันหายไปกับ
session ของ shell ถ้าตั้งถาวรไว้ รหัสตั้งต้นของทุกบัญชีจะค้างอยู่ใน Dashboard ให้คนอ่านได้เรื่อย ๆ

### 7. ตรวจว่าขึ้นจริง

```bash
curl -fsS https://<url-ของคุณ>/api/health
```

ต้องได้ 200 ซึ่งหมายถึงต่อฐานข้อมูลได้จริง ไม่ใช่แค่ process ยังอยู่

จากนั้นดูสามอย่างนี้ที่ Dashboard

- `lottery-notify` → Logs ต้องขึ้น `เฝ้าดูอยู่ · รับการกดปุ่มทันที`
- `lottery-cutoff` → Events ต้องมี run สำเร็จภายในหนึ่งนาที
- ลองแนบสลิปหนึ่งใบ แล้วดูว่ารูปเข้า Telegram พร้อมปุ่มยืนยัน/ตีกลับ และกดติด

---

## ทำไมต้องเสียเงิน

ลองใช้แผนฟรีแล้วมันพังด้วยเหตุผลที่แก้ด้วยการตั้งค่าไม่ได้

| ของฟรี | เกิดอะไรขึ้น |
|---|---|
| Web service ฟรี | spin down หลังไม่มี traffic 15 นาที · ปลุกใหม่ใช้เวลาราวหนึ่งนาที |
| Postgres ฟรี | **หมดอายุ 30 วันหลังสร้าง** หลังจากนั้นมี grace period 14 วัน แล้ว Render ลบทั้งฐานข้อมูลพร้อมข้อมูลทั้งหมด |
| Cron job | ไม่มี instance ฟรี |
| Background worker | ไม่มี instance ฟรี |

สองข้อแรกร้ายแรงกับระบบนี้เป็นพิเศษ web ที่หลับอยู่แปลว่า job ปิดรอบไม่ทำงาน
บิลจึงเข้ามาได้หลังเวลา Cutoff และฐานข้อมูลที่ถูกลบใน 30 วันคือเสียทั้งบิล
ทั้ง settlement และทั้ง audit trail

### ที่ตั้งไว้ในไฟล์

| บริการ | แผน | หมายเหตุ |
|---|---|---|
| `lottery-postgres` | `0.1c-256mb` disk 10GB | แผนถูกสุดที่ไม่หมดอายุ · ขยายได้ทีหลังโดยไม่ย้ายข้อมูล |
| `lottery-web` | `starter` | `preDeployCommand` ใช้ได้เฉพาะแผนที่ต้องจ่าย |
| `lottery-notify` | `starter` | worker ต้องรันค้างไว้ |
| `lottery-cutoff` | `starter` | cron ทุกนาที |

ราคาจริงดูที่หน้า pricing ของ Render เอกสารนี้ไม่ระบุตัวเลข เพราะเปลี่ยนได้
ถ้าจะลดค่าใช้จ่าย จุดที่ยอมได้ง่ายที่สุดคือ cron — เปลี่ยน `schedule` เป็น `*/5 * * * *`
แลกกับบิลอาจเข้ามาได้อีกไม่เกิน 5 นาทีหลัง Cutoff ซึ่งเป็นการตัดสินใจเรื่องเงิน ไม่ใช่เรื่องเทคนิค

---

## ทำไมไม่ใช้ Dockerfile ที่มีอยู่

`Dockerfile` ยังอยู่และใช้ได้กับปลายทางอื่น แต่ Render ใช้ `runtime: node` เพราะ

runner stage ของ Dockerfile คัดเฉพาะ `node_modules/@prisma` กับ `node_modules/.prisma`
เข้า image ส่วน CLI ของ Prisma อยู่ในแพ็กเกจ `prisma` ซึ่งเป็น devDependency และไม่ถูกคัดไป
image นั้นจึงรัน `prisma migrate deploy` ไม่ได้ ทั้งที่ migrate ต้องรันก่อนสตาร์ตแอปตัวใหม่ทุกครั้ง

`runtime: node` ได้ devDependencies มาด้วย จึงรัน migrate กับ seed ได้จริง และ worker
กับ cron ใช้ build เดียวกันได้โดยไม่ต้อง build image ซ้ำสามรอบ

> **กับดักที่ต้องรู้:** `NODE_ENV=production` ทำให้ `npm ci` ข้าม devDependencies
> แต่ `prisma` CLI กับ `tsx` เป็น devDependency และต้องใช้ตอน runtime
> (`preDeployCommand` เรียก prisma · cron กับ worker รันผ่าน tsx)
> ทุก `buildCommand` ใน blueprint จึงเขียน `npm ci --include=dev` ไว้
> ถ้ามีคนตัด `--include=dev` ออก ทั้ง cron และ worker จะตายเงียบ ๆ ด้วย `tsx: not found`

---

## ทำไม worker ไม่ใช่ cron

ปุ่ม "ยืนยัน" กับ "ตีกลับ" ใน Telegram ต้องมีคนคอยรับ callback จาก `getUpdates` อยู่ตลอด

endpoint `/api/jobs/notify` ส่งแจ้งเตือนหลักฐานกับสรุปรายวันให้ได้ แต่ **ไม่ได้อ่าน inbox**
ถ้าตั้งแค่ cron ยิง endpoint นั้น รูปกับปุ่มจะเข้าแชทปกติ แต่กดแล้วไม่มีอะไรเกิดขึ้น

`npm run job:notify:watch` ทำครบสามอย่างในลูปเดียว — รับการกดปุ่ม, ส่งแจ้งเตือนหลักฐาน,
และสรุปรายวัน (กันซ้ำด้วยวันที่อยู่แล้ว เรียกถี่แค่ไหนก็ส่งวันละครั้ง) จึงไม่ต้องตั้ง cron
สำหรับงานแจ้งเตือนเลย เหลือ cron แค่ตัวปิดรอบ

ส่วน cron ปิดรอบเรียก script ตรงเข้าฐานข้อมูล ไม่ผ่าน HTTP จึงทำงานได้แม้ web กำลัง deploy อยู่

---

## สิ่งที่ยังไม่ได้ทำในไฟล์นี้

| รายการ | หมายเหตุ |
|---|---|
| Backup ฐานข้อมูล | Render มี backup ให้ตามแผน แต่ต้องยืนยันว่าความถี่พอและเคย restore สำเร็จจริง |
| Error tracking / alert | ยังไม่มี ถ้า worker ตาย จะรู้ตอนที่ไม่มีใครได้แจ้งเตือน |
| Branch protection บน main | ยังตั้งไม่ได้เพราะ repo private บนบัญชีฟรี ดู `docs/DEPLOYMENT.md` |
| Secret manager | ตอนนี้ความลับอยู่ใน Env Group ของ Render |
