export type DashboardIconName =
  | "home"
  | "bill"
  | "draw"
  | "report"
  | "analytics"
  | "audit"
  | "book"
  | "agent"
  | "plus"
  | "alert"
  | "arrow";

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
    plus: <><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></>,
    alert: <><path d="M12 3 2.5 20h19z"/><path d="M12 9v5M12 17h.01"/></>,
    arrow: <><path d="M5 12h14M14 7l5 5-5 5"/></>,
  };

  return (
    <svg className="dash-icon" viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}
