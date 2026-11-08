"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppDropdown } from "../AppDropdown";

export type OrganizationCustomerNode = {
  key: string;
  name: string;
  billCount: number;
  gross: number;
  profileHref: string;
};

export type OrganizationAgentNode = {
  id: string;
  code: string;
  name: string;
  status: "ACTIVE" | "SUSPENDED" | "CLOSED";
  commissionRate: number;
  customerCount: number;
  sales: number;
  billCount: number;
  payout: number;
  commission: number;
  net: number;
  profileHref: string;
  csvHref: string;
  customers: OrganizationCustomerNode[];
};

type LayoutMode = "horizontal" | "compact";
type DepthMode = "agents" | "customers";

const MONEY = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const COMPACT = new Intl.NumberFormat("th-TH", { notation: "compact", maximumFractionDigits: 1 });
const STATUS_LABEL = { ACTIVE: "ใช้งาน", SUSPENDED: "ระงับ", CLOSED: "ปิด" } as const;
const CUSTOMER_PREVIEW_LIMIT = 6;

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
  context.fill();
  context.stroke();
}

export function OrganizationMap({
  ownerName,
  organizationName,
  draws,
  selectedDrawId,
  selectedDrawLabel,
  csvHref: exportCsvHref,
  agents,
}: {
  ownerName: string;
  organizationName: string;
  draws: { id: string; name: string }[];
  selectedDrawId: string;
  selectedDrawLabel: string;
  csvHref: string;
  agents: OrganizationAgentNode[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const viewportRef = useRef<HTMLDivElement>(null);
  const workbenchRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const initialViewRef = useRef(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [depth, setDepth] = useState<DepthMode>("customers");
  const [layout, setLayout] = useState<LayoutMode>("horizontal");
  const [showConnectors, setShowConnectors] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [selectedId, setSelectedId] = useState<string | null>(() => agents[0]?.id ?? null);
  const [zoom, setZoom] = useState(.8);
  const [pan, setPan] = useState({ x: 28, y: 18 });
  const [fullscreen, setFullscreen] = useState(false);

  const filteredAgents = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("th-TH");
    return agents.filter((agent) => {
      if (status && agent.status !== status) return false;
      if (!term) return true;
      return `${agent.code} ${agent.name}`.toLocaleLowerCase("th-TH").includes(term)
        || agent.customers.some((customer) => customer.name.toLocaleLowerCase("th-TH").includes(term));
    });
  }, [agents, search, status]);

  const selected = agents.find((agent) => agent.id === selectedId) ?? null;
  const stageWidth = layout === "horizontal"
    ? Math.max(920, filteredAgents.length * 248 + 120)
    : Math.max(920, Math.min(4, Math.max(filteredAgents.length, 1)) * 248 + 120);
  const compactRows = Math.max(1, Math.ceil(filteredAgents.length / 4));
  const hasExpandedCustomers = depth === "customers" && filteredAgents.some((agent) => !collapsed.has(agent.id));
  const stageHeight = layout === "horizontal"
    ? (hasExpandedCustomers ? 590 : 340)
    : 250 + compactRows * (hasExpandedCustomers ? 330 : 170);

  const fitToScreen = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const inspectorSpace = workbenchRef.current?.classList.contains("has-inspector") ? 310 : 0;
    const availableWidth = Math.max(viewport.clientWidth - 48 - inspectorSpace, 240);
    const availableHeight = Math.max(viewport.clientHeight - 48, 180);
    const nextZoom = Math.max(.32, Math.min(1, availableWidth / stageWidth, availableHeight / stageHeight));
    setZoom(nextZoom);
    setPan({
      x: Math.max(24, (viewport.clientWidth - stageWidth * nextZoom) / 2),
      y: Math.max(22, (viewport.clientHeight - stageHeight * nextZoom) / 2),
    });
  }, [stageHeight, stageWidth]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const viewport = viewportRef.current;
      if (!viewport || initialViewRef.current) {
        fitToScreen();
        return;
      }
      initialViewRef.current = true;
      const readableZoom = .68;
      const selectedIndex = 0;
      const selectedCenter = 52 + selectedIndex * 248 + 110;
      const visibleWidth = Math.max(viewport.clientWidth - 310, 320);
      setZoom(readableZoom);
      setPan({ x: visibleWidth / 2 - selectedCenter * readableZoom, y: 22 });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [depth, filteredAgents, fitToScreen, layout]);

  useEffect(() => {
    if (selectedId && !filteredAgents.some((agent) => agent.id === selectedId)) {
      setSelectedId(filteredAgents[0]?.id ?? null);
    }
  }, [filteredAgents, selectedId]);

  useEffect(() => {
    function syncFullscreen() {
      setFullscreen(document.fullscreenElement === workbenchRef.current);
      window.setTimeout(fitToScreen, 0);
    }
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, [fitToScreen]);

  function changeDraw(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("page");
    if (value) params.set("drawId", value); else params.delete("drawId");
    router.replace(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false });
  }

  function resetFilters() {
    setSearch("");
    setStatus("");
    setDepth("customers");
    setLayout("horizontal");
    setShowConnectors(true);
    router.replace(pathname, { scroll: false });
  }

  function setZoomClamped(next: number) {
    setZoom(Math.max(.3, Math.min(1.6, next)));
  }

  function onWheel(event: React.WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    const viewport = viewportRef.current;
    if (!viewport) return;
    const bounds = viewport.getBoundingClientRect();
    const mouseX = event.clientX - bounds.left;
    const mouseY = event.clientY - bounds.top;
    const nextZoom = Math.max(.3, Math.min(1.6, zoom * (event.deltaY > 0 ? .9 : 1.1)));
    const ratio = nextZoom / zoom;
    setPan((current) => ({ x: mouseX - (mouseX - current.x) * ratio, y: mouseY - (mouseY - current.y) * ratio }));
    setZoom(nextZoom);
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if ((event.target as Element).closest("button,a,input,[role=combobox]")) return;
    dragRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const start = dragRef.current;
    if (!start) return;
    setPan({ x: start.panX + event.clientX - start.x, y: start.panY + event.clientY - start.y });
  }

  function endPan(event: React.PointerEvent<HTMLDivElement>) {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function toggleAgent(agentId: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(agentId)) next.delete(agentId); else next.add(agentId);
      return next;
    });
  }

  async function toggleFullscreen() {
    if (!workbenchRef.current) return;
    if (fullscreen) {
      if (document.fullscreenElement) await document.exitFullscreen();
      else setFullscreen(false);
      return;
    }
    try {
      await workbenchRef.current.requestFullscreen();
      if (!document.fullscreenElement) setFullscreen(true);
    } catch {
      // In-app browsers may disable the Fullscreen API. Keep the same UX with a fixed viewport fallback.
      setFullscreen(true);
    }
  }

  function exportPng() {
    const width = Math.max(1400, filteredAgents.length * 230 + 100);
    const height = depth === "customers" ? 760 : 470;
    const canvas = document.createElement("canvas");
    const scale = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = width * scale;
    canvas.height = height * scale;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(scale, scale);
    context.fillStyle = "#f5f9ff";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "#142747";
    context.font = "700 28px sans-serif";
    context.fillText("โครงสร้าง Agent และลูกค้า", 48, 52);
    context.fillStyle = "#71809a";
    context.font = "16px sans-serif";
    context.fillText(`${organizationName} · ${selectedDrawLabel}`, 48, 80);
    context.fillStyle = "#1677ff";
    context.strokeStyle = "#8bc5f8";
    context.lineWidth = 2;
    roundedRect(context, width / 2 - 120, 105, 240, 76, 18);
    context.fillStyle = "#fff";
    context.font = "700 20px sans-serif";
    context.textAlign = "center";
    context.fillText(ownerName, width / 2, 138);
    context.font = "14px sans-serif";
    context.fillText("เจ้าของกิจการ", width / 2, 162);
    const cardWidth = 200;
    const gap = 28;
    const totalWidth = filteredAgents.length * cardWidth + Math.max(filteredAgents.length - 1, 0) * gap;
    const startX = Math.max(48, (width - totalWidth) / 2);
    context.strokeStyle = "#368fdc";
    context.beginPath();
    context.moveTo(width / 2, 181);
    context.lineTo(width / 2, 220);
    context.moveTo(startX + cardWidth / 2, 220);
    context.lineTo(startX + totalWidth - cardWidth / 2, 220);
    context.stroke();
    filteredAgents.forEach((agent, index) => {
      const x = startX + index * (cardWidth + gap);
      context.beginPath();
      context.moveTo(x + cardWidth / 2, 220);
      context.lineTo(x + cardWidth / 2, 252);
      context.stroke();
      context.fillStyle = "#fff";
      context.strokeStyle = selectedId === agent.id ? "#1677ff" : "#cfe0ef";
      roundedRect(context, x, 252, cardWidth, 116, 14);
      context.textAlign = "left";
      context.fillStyle = "#142747";
      context.font = "700 16px sans-serif";
      context.fillText(agent.code, x + 18, 282);
      context.font = "14px sans-serif";
      context.fillText(agent.name, x + 18, 306);
      context.fillStyle = "#55708a";
      context.fillText(`ลูกค้า ${agent.customerCount} คน`, x + 18, 334);
      context.fillText(`ยอดขาย ${MONEY.format(agent.sales)} บาท`, x + 18, 356);
      if (depth === "customers" && !collapsed.has(agent.id)) {
        agent.customers.slice(0, 4).forEach((customer, customerIndex) => {
          const customerY = 392 + customerIndex * 72;
          context.strokeStyle = "#9fc9ec";
          context.beginPath();
          context.moveTo(x + cardWidth / 2, customerY - 24);
          context.lineTo(x + cardWidth / 2, customerY);
          context.stroke();
          context.fillStyle = "#fff";
          context.strokeStyle = "#d7e5f1";
          roundedRect(context, x + 6, customerY, cardWidth - 12, 54, 10);
          context.fillStyle = "#1b3f5b";
          context.font = "700 13px sans-serif";
          context.fillText(customer.name.slice(0, 22), x + 18, customerY + 22);
          context.fillStyle = "#71869a";
          context.font = "12px sans-serif";
          context.fillText(`${customer.billCount} บิล · ${MONEY.format(customer.gross)} บาท`, x + 18, customerY + 42);
        });
      }
    });
    canvas.toBlob((blob) => { if (blob) downloadBlob(blob, `โครงสร้าง-agent-${selectedDrawLabel}.png`); }, "image/png");
  }

  return <div ref={workbenchRef} className={`organization-map-workbench ${selected ? "has-inspector" : ""} ${fullscreen ? "is-fullscreen" : ""}`}>
    <div className="organization-map-main">
      <section className="organization-map-controls" aria-label="เครื่องมือกรองโครงสร้าง Agent">
        <label className="organization-search"><span aria-hidden="true">⌕</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ค้นหา Agent / ลูกค้า" aria-label="ค้นหา Agent หรือลูกค้า" /></label>
        <AppDropdown ariaLabel="เลือกงวด" value={selectedDrawId} onValueChange={changeDraw} options={[{ value: "", label: "ทุกงวด" }, ...draws.map((draw) => ({ value: draw.id, label: draw.name }))]} searchable={draws.length > 6} searchPlaceholder="ค้นหางวด" />
        <AppDropdown ariaLabel="เลือกสถานะ Agent" value={status} onValueChange={setStatus} options={[{ value: "", label: "ทุกสถานะ" }, { value: "ACTIVE", label: "ใช้งาน" }, { value: "SUSPENDED", label: "ระงับ" }, { value: "CLOSED", label: "ปิด" }]} />
        <AppDropdown ariaLabel="เลือกระดับโครงสร้าง" value={depth} onValueChange={(value) => setDepth(value as DepthMode)} options={[{ value: "customers", label: "แสดง 3 ระดับ" }, { value: "agents", label: "แสดง 2 ระดับ" }]} />
        <AppDropdown ariaLabel="เลือกรูปแบบผัง" value={layout} onValueChange={(value) => setLayout(value as LayoutMode)} options={[{ value: "horizontal", label: "แนวนอน" }, { value: "compact", label: "แบบกระชับ" }]} />
        <button type="button" className={`organization-connector-toggle ${showConnectors ? "active" : ""}`} aria-pressed={showConnectors} onClick={() => setShowConnectors((value) => !value)}><i />เส้นเชื่อม</button>
        <button type="button" className="organization-reset" onClick={resetFilters}>↻ ล้างตัวกรอง</button>
      </section>

      <section className="organization-map-canvas-shell" aria-label="ผังโครงสร้าง Agent และลูกค้า">
        <div className="organization-map-zoom" aria-label="ควบคุมการซูม">
          <button type="button" onClick={() => setZoomClamped(zoom - .1)} aria-label="ซูมออก">−</button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => setZoomClamped(zoom + .1)} aria-label="ซูมเข้า">+</button>
          <button type="button" className="fit" onClick={fitToScreen}>⛶ พอดีจอ</button>
          <button type="button" onClick={() => void toggleFullscreen()} aria-label={fullscreen ? "ออกจากเต็มจอ" : "เต็มจอ"}>{fullscreen ? "↙" : "↗"}</button>
        </div>

        <div ref={viewportRef} className={`organization-map-viewport layout-${layout} ${showConnectors ? "show-connectors" : "hide-connectors"}`} onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endPan} onPointerCancel={endPan}>
          <div className="organization-map-stage" style={{ width: stageWidth, minHeight: stageHeight, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
            <div className="organization-owner-node"><span aria-hidden="true">♛</span><div><strong>{ownerName}</strong><small>{organizationName}</small></div></div>
            {filteredAgents.length === 0 ? <div className="organization-map-empty"><strong>ไม่พบข้อมูลที่ค้นหา</strong><span>ลองเปลี่ยนคำค้นหาหรือตัวกรองสถานะ</span></div> : <div className="organization-agent-row">
              {filteredAgents.map((agent) => {
                const isCollapsed = depth === "agents" || collapsed.has(agent.id);
                const customers = search.trim()
                  ? agent.customers.filter((customer) => customer.name.toLocaleLowerCase("th-TH").includes(search.trim().toLocaleLowerCase("th-TH"))).slice(0, CUSTOMER_PREVIEW_LIMIT)
                  : agent.customers.slice(0, CUSTOMER_PREVIEW_LIMIT);
                return <article key={agent.id} className={`organization-agent-node ${selectedId === agent.id ? "selected" : ""}`}>
                  <button type="button" className="organization-agent-card" onClick={() => setSelectedId(agent.id)} aria-label={`ดูรายละเอียด ${agent.code} ${agent.name}`}>
                    <span className="organization-agent-avatar">{agent.code.slice(-2)}</span>
                    <span className="organization-agent-copy"><strong>{agent.code}</strong><small>{agent.name}</small><em className={`status-${agent.status.toLowerCase()}`}>● {STATUS_LABEL[agent.status]}</em></span>
                    <span className="organization-agent-stats"><small>ลูกค้า <b>{agent.customerCount}</b></small><small>ยอดขาย <b>{COMPACT.format(agent.sales)} ฿</b></small></span>
                  </button>
                  {depth === "customers" && <button type="button" className="organization-collapse-node" onClick={() => toggleAgent(agent.id)} aria-label={isCollapsed ? `ขยายลูกค้าของ ${agent.code}` : `ย่อลูกค้าของ ${agent.code}`}>{isCollapsed ? "+" : "−"}</button>}
                  {!isCollapsed && <div className="organization-customer-list">
                    {customers.map((customer) => <Link key={customer.key} className="organization-customer-node" href={customer.profileHref}><span>{customer.name.trim().slice(0, 1) || "ล"}</span><div><strong>{customer.name}</strong><small>{customer.billCount} บิล · {MONEY.format(customer.gross)} ฿</small></div></Link>)}
                    {agent.customerCount > customers.length && <Link className="organization-more-node" href={agent.profileHref}>+{agent.customerCount - customers.length} ลูกค้า · ดูทั้งหมด</Link>}
                    {agent.customerCount === 0 && <div className="organization-no-customer">ยังไม่มีลูกค้าในงวดนี้</div>}
                  </div>}
                </article>;
              })}
            </div>}
          </div>

          <button type="button" className="organization-minimap" onClick={fitToScreen} aria-label="จัดผังให้พอดีจอ">
            <span className="organization-minimap-owner" />
            <span className="organization-minimap-agents">{filteredAgents.slice(0, 12).map((agent) => <i key={agent.id} className={selectedId === agent.id ? "selected" : ""} />)}</span>
            <small>Minimap · {filteredAgents.length} Agent</small>
          </button>
        </div>

        <div className="organization-map-actions">
          <button type="button" onClick={() => setCollapsed(new Set(filteredAgents.map((agent) => agent.id)))}>− ย่อทั้งหมด</button>
          <button type="button" onClick={() => { setDepth("customers"); setCollapsed(new Set()); }}>＋ ขยายทั้งหมด</button>
          <button type="button" onClick={fitToScreen}>⇄ จัดเรียงอัตโนมัติ</button>
          <span />
          <button type="button" onClick={exportPng}>▧ ส่งออก PNG</button>
          <a href={exportCsvHref}>▤ CSV</a>
        </div>
      </section>
    </div>

    {selected && <aside className="organization-inspector" aria-label={`รายละเอียด Agent ${selected.code}`}>
      <header><div><span>รายละเอียด Agent</span><strong>{selected.code}</strong></div><button type="button" onClick={() => setSelectedId(null)} aria-label="ปิดรายละเอียด">×</button></header>
      <div className="organization-inspector-person"><span>{selected.code.slice(-2)}</span><div><strong>{selected.name}</strong><small className={`status-${selected.status.toLowerCase()}`}>● {STATUS_LABEL[selected.status]}</small></div></div>
      <div className="organization-inspector-kpis"><div><small>ลูกค้าทั้งหมด</small><strong>{selected.customerCount}</strong></div><div><small>ยอดขายรวม</small><strong>{MONEY.format(selected.sales)} ฿</strong></div><div><small>จำนวนบิล</small><strong>{selected.billCount}</strong></div><div><small>คอมมิชชัน</small><strong>{MONEY.format(selected.commission)} ฿</strong></div></div>
      <section><h3>ลูกค้าอันดับแรก <small>ตามยอดซื้อ</small></h3>{selected.customers.slice(0, 3).map((customer, index) => <Link key={customer.key} href={customer.profileHref}><b>{index + 1}</b><span><strong>{customer.name}</strong><small>{customer.billCount} บิล</small></span><em>{MONEY.format(customer.gross)} ฿</em></Link>)}</section>
      <dl><div><dt>อัตราคอมมิชชัน</dt><dd>{selected.commissionRate.toFixed(2)}%</dd></div><div><dt>จ่ายรางวัล</dt><dd>{MONEY.format(selected.payout)} ฿</dd></div><div><dt>สุทธิ</dt><dd className={selected.net < 0 ? "negative" : ""}>{MONEY.format(selected.net)} ฿</dd></div></dl>
      <footer><Link href={selected.profileHref}>ดูโปรไฟล์</Link><a href={selected.csvHref}>ดูลูกค้าทั้งหมด</a></footer>
    </aside>}
  </div>;
}
