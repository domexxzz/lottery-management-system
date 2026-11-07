export type CustomerBillInput = {
  title: string;
  totalStake: { toString(): string } | number;
  totalPayout: { toString(): string } | number;
  createdAt: Date;
};

export type AgentCustomerRow = {
  key: string;
  name: string;
  billCount: number;
  gross: number;
  payout: number;
  lastBillAt: Date;
};

/** รวมบิลชื่อเดียวกันเป็นลูกค้าหนึ่งคน โดยไม่เปลี่ยนข้อมูลต้นฉบับในฐานข้อมูล */
export function aggregateAgentCustomers(bills: readonly CustomerBillInput[]): AgentCustomerRow[] {
  const customers = new Map<string, AgentCustomerRow>();

  for (const bill of bills) {
    const name = bill.title.trim() || "ไม่ระบุชื่อ";
    const key = name.toLocaleLowerCase("th-TH");
    const current = customers.get(key) ?? {
      key,
      name,
      billCount: 0,
      gross: 0,
      payout: 0,
      lastBillAt: bill.createdAt,
    };
    current.billCount += 1;
    current.gross += Number(bill.totalStake);
    current.payout += Number(bill.totalPayout);
    if (bill.createdAt > current.lastBillAt) current.lastBillAt = bill.createdAt;
    customers.set(key, current);
  }

  return [...customers.values()].sort(
    (a, b) => b.gross - a.gross || b.billCount - a.billCount || a.name.localeCompare(b.name, "th-TH"),
  );
}
