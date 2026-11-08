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
  role: "OWNER" | "ADMIN" | "AGENT";
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
  readByOther: boolean;
  attachments: Attachment[];
};

const ROLE_LABEL: Record<Contact["role"], string> = {
  OWNER: "เจ้าของกิจการ",
  ADMIN: "ผู้ดูแลระบบ",
  AGENT: "ตัวแทน",
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

export function MessengerScreen({ myName }: { myName: string }) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [thread, setThread] = useState<{ other: Room["other"]; messages: Message[] } | null>(null);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showList, setShowList] = useState(true);

  const bodyRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const avatarRef = useRef<HTMLInputElement>(null);

  const loadRooms = useCallback(async () => {
    const response = await fetch("/api/messages/conversations", { cache: "no-store" });
    if (!response.ok) return;
    const payload = (await response.json()) as { data: Room[] };
    setRooms(payload.data);
  }, []);

  const loadContacts = useCallback(async (query: string) => {
    const url = query.trim() ? `/api/messages/contacts?q=${encodeURIComponent(query.trim())}` : "/api/messages/contacts";
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return;
    const payload = (await response.json()) as { data: Contact[] };
    setContacts(payload.data);
  }, []);

  const loadThread = useCallback(async (conversationId: string) => {
    const response = await fetch(`/api/messages/conversations/${conversationId}`, { cache: "no-store" });
    if (!response.ok) return;
    const payload = (await response.json()) as { data: { other: Room["other"]; messages: Message[] } };
    setThread(payload.data);
    await fetch(`/api/messages/conversations/${conversationId}/read`, { method: "POST" });
  }, []);

  useEffect(() => {
    void loadRooms();
    void loadContacts("");
  }, [loadRooms, loadContacts]);

  // ดึงซ้ำเป็นช่วง ๆ แทน realtime
  useEffect(() => {
    const timer = setInterval(() => {
      void loadRooms();
      if (activeId) void loadThread(activeId);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [activeId, loadRooms, loadThread]);

  useEffect(() => {
    const id = setTimeout(() => void loadContacts(search), 250);
    return () => clearTimeout(id);
  }, [search, loadContacts]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [thread?.messages.length, activeId]);

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

  async function uploadAvatar(file: File) {
    const form = new FormData();
    form.set("file", file);
    const response = await fetch("/api/messages/avatar", { method: "POST", body: form });
    if (!response.ok) {
      const payload = (await response.json()) as { error?: { message?: string } };
      setError(payload.error?.message ?? "เปลี่ยนรูปโปรไฟล์ไม่สำเร็จ");
      return;
    }
    await loadRooms();
    if (activeId) await loadThread(activeId);
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
          <button type="button" className="msg-avatar-edit" onClick={() => avatarRef.current?.click()}>
            เปลี่ยนรูปของฉัน
          </button>
          <input
            ref={avatarRef}
            className="msg-file-input"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void uploadAvatar(file);
              event.target.value = "";
            }}
          />
        </header>

        <div className="msg-search">
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="ค้นหาชื่อผู้ใช้..."
            aria-label="ค้นหาผู้ใช้"
          />
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
                      <div className="msg-bubble">
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
                        <span className="msg-meta">
                          {clockOf(message.createdAt)}
                          {message.mine && <em>{message.readByOther ? "อ่านแล้ว" : "ส่งแล้ว"}</em>}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

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
