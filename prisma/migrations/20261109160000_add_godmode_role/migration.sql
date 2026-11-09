-- Godmode เป็นผู้ดูแลระบบระดับสูงสุด แต่ Owner ยังคงเป็นเจ้าของกิจการ
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'GODMODE' BEFORE 'OWNER';
