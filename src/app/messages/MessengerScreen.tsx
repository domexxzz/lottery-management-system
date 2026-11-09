"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * หน้าสนทนาภายในองค์กร
 *
 * ไม่มี realtime จริง ใช้การดึงซ้ำทุกไม่กี่วินาทีแทน ซึ่งพอสำหรับทีมหลังบ้าน
 * ขนาดนี้และไม่ต้องเปิด websocket เพิ่ม ถ้าทีมโตจนไม่พอค่อยเปลี่ยนเป็น SSE
 *
 * ไม่มีมาสคอตผู้ช่วยในหน้านี้ตามที่ตกลง เพราะเป็นการคุยระหว่างคน ไม่ใช่กับ AI
 */

const POLL_MS = 5000;

type Contact = {
  id: string;
  login: string;
  displayName: string;
  role: "GODMODE" | "OWNER" | "ADMIN" | "AGENT";
  hasAvatar: boolean;
  online: boolean;
};

type Room = {
  id: string;
  lastMessageAt: string | null;
  unread: number;
  preview: string;
  lastFromMe: boolean;
  other: Omit<Contact, "login">;
};

type Attachment = {
  id: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  isImage: boolean;
};

type Message = {
  id: string;
  body: string | null;
  mine: boolean;
  createdAt: string;
  cancelledAt: string | null;
  readByOther: boolean;
  attachments: Attachment[];
};

const ROLE_LABEL: Record<Contact["role"], string> = {
  GODMODE: "Godmode",
  OWNER: "เจ้าของกิจการ",
  ADMIN: "ผู้ดูแลระบบ",
  AGENT: "ตัวแทน",
};

/**
 * คำแนะนำการค้นหา แยกตามบทบาทของคนที่กำลังใช้
 *
 * ขอบเขตที่แต่ละคนค้นเจอไม่เท่ากัน ตัวแทนเห็นเฉพาะเจ้าของกิจการกับผู้ดูแล
 * ถ้าบอกเหมือนกันหมด ตัวแทนจะพิมพ์ชื่อเพื่อนตัวแทนแล้วไม่เจอ โดยไม่รู้ว่า
 * พิมพ์ผิดหรือไม่มีสิทธิ์ ซึ่งเป็นคนละปัญหาและแก้คนละทาง
 */
const SEARCH_HINT: Record<Contact["role"], { placeholder: string; hint: string }> = {
  GODMODE: {
    placeholder: "ค้นหาชื่อ หรือชื่อผู้ใช้...",
    hint: "คุณคุยได้กับทุกคนในองค์กร",
  },
  OWNER: {
    placeholder: "ค้นหาชื่อ หรือชื่อผู้ใช้...",
    hint: "คุณคุยได้กับทุกคนในองค์กร พิมพ์ชื่อที่แสดง เช่น ตัวแทน กรุงเทพ หรือชื่อผู้ใช้ เช่น agent2",
  },
  ADMIN: {
    placeholder: "ค้นหาชื่อ หรือชื่อผู้ใช้...",
    hint: "คุณคุยได้กับทุกคนในองค์กร พิมพ์ชื่อที่แสดง เช่น ตัวแทน กรุงเทพ หรือชื่อผู้ใช้ เช่น agent2",
  },
  AGENT: {
    placeholder: "ค้นหาเจ้าของกิจการ หรือผู้ดูแล...",
    hint: "คุณคุยได้เฉพาะเจ้าของกิจการและผู้ดูแลระบบ พิมพ์ชื่อที่แสดง หรือชื่อผู้ใช้ เช่น owner, admin · ตัวแทนด้วยกันคุยกันไม่ได้",
  },
};

function initials(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

function clockOf(iso: string): string {
  return new Date(iso).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
}

function dayOf(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  if (sameDay) return "วันนี้";
  return date.toLocaleDateString("th-TH", { day: "numeric", month: "short" });
}

function Avatar({ person, size }: { person: { id: string; displayName: string; hasAvatar: boolean; online: boolean }; size: "sm" | "md" }) {
  return (
    <span className={`msg-avatar msg-avatar-${size}`}>
      {person.hasAvatar ? (
        <img src={`/api/messages/avatar/${person.id}`} alt="" />
      ) : (
        <span aria-hidden="true">{initials(person.displayName)}</span>
      )}
      <i className={person.online ? "msg-dot online" : "msg-dot"} aria-hidden="true" />
    </span>
  );
}

export function MessengerScreen({ myName, myRole, openWithUserId }: { myName: string; myRole: Contact["role"]; openWithUserId?: string }) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [thread, setThread] = useState<{ other: Room["other"]; messages: Message[] } | null>(null);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [cancellingMessageId, setCancellingMessageId] = useState<string | null>(null);
  const [openMessageMenu, setOpenMessageMenu] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showList, setShowList] = useState(true);

  const bodyRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // เก็บ JSON ล่าสุดไว้เทียบ ถ้าข้อมูลไม่เปลี่ยนก็ไม่ต้อง setState ทั้งรายการทุกรอบ poll
  const roomsJson = useRef("");
  const threadJson = useRef("");
  /** ห้องที่ผู้ใช้เปิดล่าสุด ใช้ทิ้งคำตอบของห้องเก่าที่มาถึงช้ากว่า */
  const requestedThread = useRef<string | null>(null);
  /** ข้อความล่าสุดจากอีกฝ่ายที่แจ้งว่าอ่านแล้ว ส่ง read เฉพาะเมื่อมีข้อความใหม่ */
  const lastMarkedRead = useRef<string | null>(null);

  const loadRooms = useCallback(async () => {
    try {
      const response = await fetch("/api/messages/conversations", { cache: "no-store" });
      if (!response.ok) return;
      const text = await response.text();
      if (text === roomsJson.current) return;
      roomsJson.current = text;
      setRooms((JSON.parse(text) as { data: Room[] }).data);
    } catch {
      // เน็ตสะดุดหรือเซิร์ฟเวอร์กำลังรีสตาร์ท รอบถัดไปของ poll จะดึงใหม่เอง
    }
  }, []);

  const loadContacts = useCallback(async (query: string) => {
    const url = query.trim() ? `/api/messages/contacts?q=${encodeURIComponent(query.trim())}` : "/api/messages/contacts";
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as { data: Contact[] };
      setContacts(payload.data);
    } catch {
      // เหมือน loadRooms ปล่อยให้รายการเดิมค้างไว้ดีกว่าทำหน้าจอพัง
    }
  }, []);

  const loadThread = useCallback(async (conversationId: string) => {
    requestedThread.current = conversationId;
    try {
      const response = await fetch(`/api/messages/conversations/${conversationId}`, { cache: "no-store" });
      if (!response.ok || requestedThread.current !== conversationId) return;
      const text = await response.text();
      if (requestedThread.current !== conversationId) return;
      const payload = JSON.parse(text) as { data: { other: Room["other"]; messages: Message[] } };
      if (text !== threadJson.current) {
        threadJson.current = text;
        setThread(payload.data);
      }
      const latestIncoming = [...payload.data.messages].reverse().find((message) => !message.mine);
      const readKey = latestIncoming ? `${conversationId}:${latestIncoming.id}` : null;
      if (readKey && readKey !== lastMarkedRead.current) {
        lastMarkedRead.current = readKey;
        await fetch(`/api/messages/conversations/${conversationId}/read`, { method: "POST" });
      }
    } catch {
      // ข้อความที่แสดงอยู่ยังอ่านได้ รอบถัดไปค่อยซิงก์ใหม่
    }
  }, []);

  // รายชื่อผู้ติดต่อโหลดจาก effect ของช่องค้นหาด้านล่างอยู่แล้ว ไม่ต้องโหลดซ้ำตอนเปิดหน้า
  useEffect(() => {
    void loadRooms();
  }, [loadRooms]);

  /*
   * มาจากปุ่ม "ส่งข้อความ" ในหน้าโปรไฟล์ Agent
   *
   * เปิดห้องให้เลยโดยไม่ต้องให้ผู้ใช้ไปไล่หาชื่อในรายการอีกรอบ
   * ถ้าคุยกับคนนั้นไม่ได้ openWith จะขึ้น error ตามกฎสิทธิ์เหมือนกดเอง
   */
  const openedFromLink = useRef(false);
  useEffect(() => {
    // กันเปิดซ้ำตอน re-render เพราะ openWith เปลี่ยน state แล้ว effect วิ่งใหม่ได้
    if (!openWithUserId || openedFromLink.current) return;
    openedFromLink.current = true;
    void openWith(openWithUserId);
  }, [openWithUserId]);

  // ดึงซ้ำเป็นช่วง ๆ แทน realtime และหยุดเมื่อแท็บถูกซ่อน กลับมาเมื่อไรดึงทันที
  useEffect(() => {
    const poll = () => {
      if (document.visibilityState !== "visible") return;
      void loadRooms();
      if (activeId) void loadThread(activeId);
    };
    const timer = setInterval(poll, POLL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") poll(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [activeId, loadRooms, loadThread]);

  useEffect(() => {
    const id = setTimeout(() => void loadContacts(search), 250);
    return () => clearTimeout(id);
  }, [search, loadContacts]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [thread?.messages.length, activeId]);

  useEffect(() => {
    if (!openMessageMenu) return;
    function closeMenu(event: PointerEvent) {
      const target = event.target;
      const menu = target instanceof Element ? target.closest<HTMLElement>("[data-message-menu]") : null;
      if (menu?.dataset.messageMenu !== openMessageMenu) setOpenMessageMenu(null);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenMessageMenu(null);
    }
    document.addEventListener("pointerdown", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [openMessageMenu]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function openWith(userId: string) {
    setError(null);
    const response = await fetch("/api/messages/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    const payload = (await response.json()) as { data?: { conversationId: string }; error?: { message?: string } };
    if (!response.ok || !payload.data) {
      setError(payload.error?.message ?? "เปิดห้องสนทนาไม่สำเร็จ");
      return;
    }
    setActiveId(payload.data.conversationId);
    setShowList(false);
    await loadThread(payload.data.conversationId);
    await loadRooms();
  }

  async function send() {
    if (!activeId || sending) return;
    if (draft.trim() === "" && pending.length === 0) return;
    setSending(true);
    setError(null);
    try {
      let response: Response;
      if (pending.length === 0) {
        response = await fetch(`/api/messages/conversations/${activeId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: draft }),
        });
      } else {
        const form = new FormData();
        form.set("body", draft);
        pending.forEach((file) => form.append("files", file));
        response = await fetch(`/api/messages/conversations/${activeId}`, { method: "POST", body: form });
      }
      if (!response.ok) {
        const payload = (await response.json()) as { error?: { message?: string } };
        throw new Error(payload.error?.message ?? "ส่งข้อความไม่สำเร็จ");
      }
      setDraft("");
      setPending([]);
      await loadThread(activeId);
      await loadRooms();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ส่งข้อความไม่สำเร็จ");
    } finally {
      setSending(false);
    }
  }

  async function copyMessage(message: Message) {
    if (!message.body || message.cancelledAt) return;
    try {
      await navigator.clipboard.writeText(message.body);
    } catch {
      const helper = document.createElement("textarea");
      helper.value = message.body;
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.appendChild(helper);
      helper.select();
      document.execCommand("copy");
      helper.remove();
    }
    setOpenMessageMenu(null);
    setNotice("คัดลอกข้อความแล้ว");
  }

  async function cancelSentMessage(message: Message) {
    if (!activeId || !message.mine || message.cancelledAt || cancellingMessageId) return;
    const confirmed = window.confirm("ยกเลิกข้อความนี้สำหรับทุกคนหรือไม่? เนื้อหาและไฟล์แนบจะไม่สามารถเปิดดูได้อีก");
    if (!confirmed) return;
    setCancellingMessageId(message.id);
    setOpenMessageMenu(null);
    setError(null);
    try {
      const response = await fetch(`/api/messages/conversations/${activeId}/messages/${message.id}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: { message?: string } };
        throw new Error(payload.error?.message ?? "ยกเลิกข้อความไม่สำเร็จ");
      }
      await Promise.all([loadThread(activeId), loadRooms()]);
      setNotice("ยกเลิกข้อความแล้ว");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ยกเลิกข้อความไม่สำเร็จ");
    } finally {
      setCancellingMessageId(null);
    }
  }


  const roomIds = useMemo(() => new Set(rooms.map((room) => room.other.id)), [rooms]);
  const newContacts = useMemo(() => contacts.filter((person) => !roomIds.has(person.id)), [contacts, roomIds]);
  const totalUnread = useMemo(() => rooms.reduce((sum, room) => sum + room.unread, 0), [rooms]);

  return (
    <div className={`msg-shell ${showList ? "show-list" : "show-thread"}`}>
      <aside className="msg-sidebar" aria-label="รายชื่อผู้ติดต่อและห้องสนทนา">
        <header className="msg-sidebar-head">
          <div>
            <strong>ข้อความ</strong>
            <small>{totalUnread > 0 ? `ยังไม่ได้อ่าน ${totalUnread} ข้อความ` : "อ่านครบแล้ว"}</small>
          </div>
        </header>

        <div className="msg-search">
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={SEARCH_HINT[myRole].placeholder}
            aria-label="ค้นหาผู้ใช้"
            aria-describedby="msg-search-hint"
          />
          {/*
            * คำแนะนำต่างกันตามบทบาท เพราะขอบเขตที่ค้นเจอก็ต่างกัน
            * ถ้าเขียนข้อความกลาง ๆ เหมือนกันหมด ตัวแทนจะพิมพ์ชื่อตัวแทนคนอื่น
            * แล้วไม่เจอ โดยไม่รู้ว่าเพราะพิมพ์ผิดหรือเพราะไม่มีสิทธิ์
            */}
          <p id="msg-search-hint" className="msg-hint">
            {SEARCH_HINT[myRole].hint}
          </p>
        </div>

        <div className="msg-list" role="list">
          {rooms.length === 0 && newContacts.length === 0 && (
            <p className="msg-empty">ยังไม่มีใครให้คุยด้วย</p>
          )}

          {rooms.length > 0 && <p className="msg-group">ห้องสนทนา</p>}
          {rooms.map((room) => (
            <button
              key={room.id}
              type="button"
              role="listitem"
              className={`msg-row ${room.id === activeId ? "is-active" : ""}`}
              onClick={() => {
                setActiveId(room.id);
                setShowList(false);
                void loadThread(room.id);
              }}
            >
              <Avatar person={room.other} size="md" />
              <span className="msg-row-text">
                <strong>{room.other.displayName}</strong>
                <small>{room.preview ? `${room.lastFromMe ? "คุณ: " : ""}${room.preview}` : ROLE_LABEL[room.other.role]}</small>
              </span>
              {room.unread > 0 && <span className="msg-badge">{room.unread}</span>}
            </button>
          ))}

          {newContacts.length > 0 && <p className="msg-group">เริ่มสนทนาใหม่</p>}
          {newContacts.map((person) => (
            <button key={person.id} type="button" role="listitem" className="msg-row" onClick={() => void openWith(person.id)}>
              <Avatar person={person} size="md" />
              <span className="msg-row-text">
                <strong>{person.displayName}</strong>
                <small>{ROLE_LABEL[person.role]}</small>
              </span>
            </button>
          ))}
        </div>
      </aside>

      <section className="msg-thread" aria-label="พื้นที่สนทนา">
        {thread === null ? (
          <div className="msg-placeholder">
            <strong>สวัสดีคุณ{myName}</strong>
            <p>เลือกคนที่ต้องการคุยจากรายการด้านซ้ายเพื่อเริ่มสนทนา</p>
          </div>
        ) : (
          <>
            <header className="msg-thread-head">
              <button type="button" className="msg-back" onClick={() => setShowList(true)} aria-label="กลับไปรายชื่อ">
                ←
              </button>
              <Avatar person={thread.other} size="sm" />
              <div>
                <strong>{thread.other.displayName}</strong>
                <small>{thread.other.online ? "ออนไลน์" : "ออฟไลน์"} · {ROLE_LABEL[thread.other.role]}</small>
              </div>
            </header>

            <div ref={bodyRef} className="msg-body" aria-live="polite">
              {thread.messages.length === 0 && <p className="msg-empty">ยังไม่มีข้อความ เริ่มทักได้เลย</p>}
              {thread.messages.map((message, index) => {
                const previous = thread.messages[index - 1];
                const newDay = !previous || dayOf(previous.createdAt) !== dayOf(message.createdAt);
                return (
                  <div key={message.id}>
                    {newDay && <div className="msg-day">{dayOf(message.createdAt)}</div>}
                    <div className={`msg-bubble-row ${message.mine ? "mine" : "theirs"}`}>
                      {!message.mine && <Avatar person={thread.other} size="sm" />}
                      <div className={`msg-bubble ${message.cancelledAt ? "is-cancelled" : ""}`}>
                        {message.cancelledAt ? (
                          <p className="msg-cancelled">ยกเลิกข้อความแล้ว</p>
                        ) : (
                          <>
                            {message.body && <p>{message.body}</p>}
                            {message.attachments.map((file) =>
                              file.isImage ? (
                                <a key={file.id} href={`/api/messages/files/${file.id}`} target="_blank" rel="noreferrer">
                                  <img className="msg-image" src={`/api/messages/files/${file.id}`} alt={file.originalName} />
                                </a>
                              ) : (
                                <a key={file.id} className="msg-file" href={`/api/messages/files/${file.id}?download=1`}>
                                  {file.originalName}
                                </a>
                              ),
                            )}
                          </>
                        )}
                        <span className="msg-meta">
                          {clockOf(message.createdAt)}
                          {message.mine && !message.cancelledAt && <em>{message.readByOther ? "อ่านแล้ว" : "ส่งแล้ว"}</em>}
                        </span>
                      </div>
                      {!message.cancelledAt && (Boolean(message.body) || message.mine) && (
                        <div className="msg-message-menu" data-message-menu={message.id}>
                          <button
                            type="button"
                            className="msg-menu-trigger"
                            aria-label="ตัวเลือกข้อความ"
                            aria-haspopup="menu"
                            aria-expanded={openMessageMenu === message.id}
                            onClick={() => setOpenMessageMenu(openMessageMenu === message.id ? null : message.id)}
                          >
                            •••
                          </button>
                          {openMessageMenu === message.id && (
                            <div className="msg-menu-popover" role="menu">
                              {message.body && <button type="button" role="menuitem" onClick={() => void copyMessage(message)}>คัดลอก</button>}
                              {message.mine && (
                                <button
                                  type="button"
                                  role="menuitem"
                                  className="is-danger"
                                  disabled={cancellingMessageId === message.id}
                                  onClick={() => void cancelSentMessage(message)}
                                >
                                  {cancellingMessageId === message.id ? "กำลังยกเลิก…" : "ยกเลิกข้อความ"}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {notice && <p className="msg-notice" role="status">{notice}</p>}

            {error && <p className="msg-error" role="alert">{error}</p>}

            {pending.length > 0 && (
              <div className="msg-pending">
                {pending.map((file, index) => (
                  <span key={`${file.name}-${index}`}>
                    {file.name}
                    <button type="button" onClick={() => setPending(pending.filter((_, i) => i !== index))} aria-label={`เอา ${file.name} ออก`}>
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}

            <form
              className="msg-compose"
              onSubmit={(event) => {
                event.preventDefault();
                void send();
              }}
            >
              <button type="button" onClick={() => fileRef.current?.click()} aria-label="แนบรูปภาพ">
                ＋
              </button>
              <input
                ref={fileRef}
                className="msg-file-input"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                hidden
                onChange={(event) => {
                  setPending([...pending, ...Array.from(event.target.files ?? [])].slice(0, 4));
                  event.target.value = "";
                }}
              />
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="พิมพ์ข้อความ..."
                aria-label="ข้อความ"
              />
              <button type="submit" disabled={sending || (draft.trim() === "" && pending.length === 0)}>
                {sending ? "กำลังส่ง" : "ส่ง"}
              </button>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
