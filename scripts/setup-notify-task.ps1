# ตั้งให้ Windows เปิดตัวเฝ้าดู Telegram ไว้ตลอด
#
#   ติดตั้ง   powershell -ExecutionPolicy Bypass -File scripts\setup-notify-task.ps1
#   ถอนออก   powershell -ExecutionPolicy Bypass -File scripts\setup-notify-task.ps1 -Remove
#   ดูสถานะ  powershell -ExecutionPolicy Bypass -File scripts\setup-notify-task.ps1 -Status
#
# ทำไมเปิดตัวเฝ้าดูค้างไว้ แทนที่จะเรียกงานทุกนาที
#   เพราะปุ่มยืนยัน/ตีกลับต้องตอบสนองทันที ถ้าเรียกทุกนาที คนกดต้องรอถึง 60 วินาที
#   ตัวเฝ้าดูใช้ long polling คือค้างสายรอฟังจาก Telegram จึงรับการกดได้ในเสี้ยววินาที
#   โดยไม่ต้องยิงถี่ ๆ ให้เปลือง
#
# ทำไมใช้ Task Scheduler ไม่ใช่เปิดเทอร์มินัลเอง
#   เพราะ Task Scheduler เปิดให้เองหลังเครื่องรีสตาร์ต และเปิดใหม่ถ้ากระบวนการตาย
#   ส่วนหน้าต่างที่เปิดค้างไว้ตายไปพร้อมกับการปิดเครื่องหรือเผลอปิดหน้าต่าง
#
# ห้ามเปิด npm run job:notify:watch ในเทอร์มินัลคู่กับงานนี้
#   ทั้งคู่ดึงเหตุการณ์จาก Telegram คิวเดียวกัน ถ้ารันพร้อมกันจะแย่งกันอ่าน
#   แล้วบางการกดปุ่มจะหายไปเฉย ๆ

param(
    [switch]$Remove,
    [switch]$Status
)

$ErrorActionPreference = "Stop"
$TaskName = "LotteryEvidenceNotify"
$ProjectPath = Split-Path -Parent $PSScriptRoot

if ($Status) {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if (-not $task) {
        Write-Host "ยังไม่ได้ติดตั้งงาน '$TaskName'"
        exit 0
    }
    $info = Get-ScheduledTaskInfo -TaskName $TaskName
    Write-Host "งาน:        $TaskName"
    Write-Host "สถานะ:      $($task.State)"
    Write-Host "รันล่าสุด:   $($info.LastRunTime)  ผลลัพธ์ $($info.LastTaskResult)"
    Write-Host "รันถัดไป:    $($info.NextRunTime)"
    exit 0
}

if ($Remove) {
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "ถอนงาน '$TaskName' ออกแล้ว"
    } else {
        Write-Host "ไม่พบงาน '$TaskName' ไม่มีอะไรต้องถอน"
    }
    exit 0
}

$npm = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npm) {
    Write-Error "หา npm ไม่เจอใน PATH ติดตั้ง Node.js ก่อนแล้วลองใหม่"
}

# รันผ่าน cmd เพื่อให้ npm script ทำงานได้เหมือนพิมพ์เองในเทอร์มินัล
$action = New-ScheduledTaskAction `
    -Execute "cmd.exe" `
    -Argument "/c `"$npm`" run job:notify:watch" `
    -WorkingDirectory $ProjectPath

# เปิดตอนล็อกอิน และเปิดเดี๋ยวนี้ด้วยถ้ายังไม่ได้เปิด
$trigger = New-ScheduledTaskTrigger -AtLogOn

# ไม่จำกัดเวลาทำงานเพราะเป็นงานที่ต้องอยู่ตลอด
# และให้เปิดใหม่เองถ้ากระบวนการตาย เช่นเน็ตหลุดยาวจนล้ม
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -RestartCount 999 `
    -ExecutionTimeLimit (New-TimeSpan -Days 0)

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "แจ้งเตือนหลักฐานรอตรวจไปยัง Telegram และรับการกดปุ่มกลับมา" `
    -Force | Out-Null

Start-ScheduledTask -TaskName $TaskName

Write-Host "ติดตั้งและเปิดงาน '$TaskName' แล้ว — เฝ้าดูตลอดเวลา เปิดเองหลังรีสตาร์ต"
Write-Host "โฟลเดอร์โครงการ: $ProjectPath"
Write-Host ""
Write-Host "ดูสถานะ:  powershell -ExecutionPolicy Bypass -File scripts\setup-notify-task.ps1 -Status"
Write-Host "ถอนออก:   powershell -ExecutionPolicy Bypass -File scripts\setup-notify-task.ps1 -Remove"
Write-Host ""
Write-Host "อย่าเปิด npm run job:notify:watch ในเทอร์มินัลคู่กัน เพราะจะแย่งกันอ่านเหตุการณ์จาก Telegram"
