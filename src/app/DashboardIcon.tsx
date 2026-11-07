export type DashboardIconName =
  | "home"
  | "bill"
  | "draw"
  | "report"
  | "analytics"
  | "audit"
  | "book"
  | "agent"
  | "winner"
  | "plus"
  | "alert"
  | "arrow"
  | "evidence"
  | "chat"
  | "brand"
  | "menu"
  | "close"
  | "chevron"
  | "filter"
  | "reset"
  | "calendar"
  | "check"
  | "wallet"
  | "percent"
  | "lock"
  | "edit"
  | "send";

export function DashboardIcon({ name }: { name: DashboardIconName }) {
  const paths = {
    home: <><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h13V10"/><path d="M9 20v-6h6v6"/></>,
    bill: <><path d="M6 3h9l3 3v15H6z"/><path d="M14 3v4h4M9 11h6M9 15h6"/></>,
    draw: <><path d="m4 7 8-4 8 4-8 4z"/><path d="m4 12 8 4 8-4M4 17l8 4 8-4"/></>,
    report: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></>,
    analytics: <><path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/><path d="m4 7 6-4 6 6 6-5"/></>,
    audit: <><path d="M6 3h9l3 3v15H6z"/><path d="M14 3v4h4M9 11h6M9 15h4"/><path d="m14.5 18 1.5 1.5 3-3"/></>,
    book: <><path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H12v18H7.5A3.5 3.5 0 0 0 4 23z"/><path d="M20 5.5A3.5 3.5 0 0 0 16.5 2H12v18h4.5A3.5 3.5 0 0 1 20 23z"/></>,
    agent: <><circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M17 8h5M19.5 5.5v5"/></>,
    winner: <><path d="M8 4h8v4a4 4 0 0 1-8 0z"/><path d="M8 6H4v1a4 4 0 0 0 4 4M16 6h4v1a4 4 0 0 1-4 4M12 12v5M8 21h8M9 17h6"/></>,
    plus: <><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></>,
    alert: <><path d="M12 3 2.5 20h19z"/><path d="M12 9v5M12 17h.01"/></>,
    arrow: <><path d="M5 12h14M14 7l5 5-5 5"/></>,
    evidence: <><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m5 18 5-5 3 3 2-2 4 4"/></>,
    chat: <><path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/></>,
    brand: <path fill="currentColor" stroke="none" d="M12 10.2 8.1 6.3a2.8 2.8 0 0 1 3.9-4 2.8 2.8 0 0 1 3.9 4Zm1.8 1.8 3.9-3.9a2.8 2.8 0 0 1 4 3.9 2.8 2.8 0 0 1-4 3.9ZM12 13.8l3.9 3.9a2.8 2.8 0 0 1-3.9 4 2.8 2.8 0 0 1-3.9-4ZM10.2 12l-3.9 3.9a2.8 2.8 0 0 1-4-3.9 2.8 2.8 0 0 1 4-3.9Z"/>,
    menu: <path d="M4 6h16M4 12h16M4 18h16"/>,
    close: <path d="m6 6 12 12M18 6 6 18"/>,
    chevron: <path d="m6 9 6 6 6-6"/>,
    filter: <path d="M3 4h18l-7 8v7l-4 2v-9z"/>,
    reset: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 8a7 7 0 0 1 12-2l2 3M4 15l2 3a7 7 0 0 0 12-2"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18m-13 5h3"/></>,
    check: <><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/></>,
    wallet: <><path d="M20 8V5H6a3 3 0 0 0 0 6h14v9H6a3 3 0 0 1-3-3V8"/><path d="M21 12h-5a2 2 0 0 0 0 4h5z"/></>,
    percent: <><path d="m5 19 14-14"/><circle cx="7.5" cy="7.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/></>,
    edit: <><path d="m5 15 10-10a2.8 2.8 0 0 1 4 4L9 19l-5 1zM13 7l4 4"/></>,
    send: <><path d="m3 11 18-8-8 18-2.5-7.5z"/><path d="m10.5 13.5 4-4"/></>,
  };

  return (
    <svg className="dash-icon" viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}
