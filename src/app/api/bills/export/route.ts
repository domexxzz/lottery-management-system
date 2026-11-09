import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/context";
import { exportBetBills } from "@/lib/bills/service";
import { parseHistoryFilter } from "@/lib/bills/history-filter";
import { BET_STATUS_LABEL, betStatusOf, drawDateLabel, lotteryLabel } from "@/lib/bills/betting";
import { csvFile, csvHeaders } from "@/lib/csv";
import { AppError } from "@/lib/errors";

export const dynamic = "force-dynamic";

const DATE_TIME = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" });

/** ส่งออกประวัติรายการตามตัวกรองเดียวกับหน้าเว็บ */
export async function GET(request: Request) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });

  const filter = parseHistoryFilter(Object.fromEntries(new URL(request.url).searchParams));
  try {
    const bills = await exportBetBills(actor, {
      tab: filter.tab,
      lotteryType: filter.lotteryType,
      query: filter.query,
      dateFrom: filter.dateFrom,
      dateTo: filter.dateTo,
      drawId: filter.drawId || undefined,
      agentId: filter.agentId || undefined,
    });
    const csv = csvFile(
      ["เลขบิล", "ลูกค้า", "Agent", "ประเภทหวย", "งวด", "วันที่ทำรายการ", "จำนวนเลข", "ยอดเดิมพัน", "เงินรางวัล", "สถานะ"],
      bills.map((bill) => [
        bill.billNumber ?? "",
        bill.title,
        `${bill.agent.code} ${bill.agent.name}`,
        lotteryLabel(bill.draw.lotteryType),
        drawDateLabel(bill.draw),
        DATE_TIME.format(bill.createdAt),
        String(bill._count.items),
        bill.totalStake.toFixed(2),
        bill.totalPayout.toFixed(2),
        BET_STATUS_LABEL[betStatusOf(bill)],
      ]),
    );
    return new NextResponse(csv, { headers: csvHeaders("bill-history.csv") });
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
