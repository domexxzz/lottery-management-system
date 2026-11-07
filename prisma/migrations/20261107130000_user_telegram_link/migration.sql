-- ผูกบัญชี Telegram กับผู้ใช้ในระบบ
--
-- จำเป็นเพราะปุ่มยืนยัน/ตีกลับในแชทเปลี่ยนสถานะหลักฐานจริง
-- ซึ่งเป็นการกระทำที่ Audit ต้องระบุตัวผู้รับผิดชอบได้
-- ตัวตนใน Telegram ไม่ใช่ตัวตนในระบบ จึงต้องมีการจับคู่ที่ชัดเจน
--
-- unique เพื่อกันไม่ให้บัญชี Telegram เดียวผูกกับผู้ใช้หลายคน
-- ซึ่งจะทำให้ตีความไม่ได้ว่าการกดปุ่มเป็นของใคร

ALTER TABLE "users" ADD COLUMN "telegramUserId" TEXT;
CREATE UNIQUE INDEX "users_telegramUserId_key" ON "users"("telegramUserId");
