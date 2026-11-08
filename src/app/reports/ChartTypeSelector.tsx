"use client";

import { CHART_TYPES, type CustomChartKind } from "./CustomChartTypes";

const CUSTOMER_DESCRIPTIONS: Partial<Record<CustomChartKind, string>> = {
  line: "ดูแนวโน้มพฤติกรรมตามลำดับ",
  area: "ดูแนวโน้มและปริมาณการซื้อ",
  stacked: "เทียบดัชนีพฤติกรรม 2 ค่า",
  combo: "เทียบยอดซื้อกับความถี่ซื้อ",
};

export function ChartTypeSelector({ value, onChange, context = "business" }: { value: CustomChartKind; onChange: (value: CustomChartKind) => void; context?: "business" | "customer" }) {
  return <section className="chart-settings-step" aria-labelledby="chart-type-step">
    <header className="chart-settings-step-heading"><span>1</span><div><h3 id="chart-type-step">เลือกรูปแบบกราฟ</h3><p>เลือกตามคำถามที่ต้องการตอบ ระบบจะจัดแกนและ Preview ที่เหมาะสมให้</p></div></header>
    <div className="chart-type-grid" role="radiogroup" aria-label="ชนิดกราฟ">
      {CHART_TYPES.map((item) => <button className="chart-type-card" type="button" role="radio" aria-checked={value === item.value} key={item.value} onClick={() => onChange(item.value)}>
        <span className="chart-type-icon" aria-hidden="true">{item.icon}</span>
        <span><strong>{item.label}</strong><small>{context === "customer" ? CUSTOMER_DESCRIPTIONS[item.value] ?? item.description : item.description}</small></span>
        <i aria-hidden="true">✓</i>
      </button>)}
    </div>
  </section>;
}
