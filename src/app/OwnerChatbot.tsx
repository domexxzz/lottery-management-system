"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import type { QuickAction } from "@/lib/chat/quick-actions";
import { DashboardIcon } from "./DashboardIcon";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  error?: boolean;
};

type ConversationSummary = {
  id: string;
  title: string;
  updatedAt: string;
};

/**
 * รูปประจำตัวของผู้ช่วย
 *
 * แยกเป็นคอมโพเนนต์เพราะใช้ซ้ำสามที่ คือหัวข้อ ทุกข้อความที่ผู้ช่วยตอบ
 * และตอนกำลังโหลด ถ้าเปลี่ยนรูปทีหลังจะได้แก้ที่เดียว
 *
 * alt ว่างและ aria-hidden เพราะเป็นของตกแต่ง ตัวตนของผู้พูดสื่อผ่าน
 * โครงสร้างข้อความอยู่แล้ว ไม่ต้องให้โปรแกรมอ่านหน้าจออ่านซ้ำทุกบรรทัด
 */
function AssistantAvatar({ className }: { className: string }) {
  return (
    <span className={className} aria-hidden="true">
      <img src="/lottery-assistant.webp" alt="" />
    </span>
  );
}

export function OwnerChatbot({
  ownerName,
  configured,
  quickActions,
  initialConversations,
}: {
  ownerName: string;
  configured: boolean;
  quickActions: QuickAction[];
  initialConversations: ConversationSummary[];
}) {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversations, setConversations] = useState(initialConversations);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const nextId = useRef(1);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isSending]);

  async function send(value: string) {
    const userMessage: ChatMessage = { id: `local-${nextId.current++}`, role: "user", content: value };
    setMessages((current) => [...current, userMessage]);
    setIsSending(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: activeConversationId ?? undefined,
          message: value,
        }),
      });
      const payload = (await response.json()) as {
        reply?: unknown;
        error?: unknown;
        conversation?: ConversationSummary;
      };
      if (!response.ok || typeof payload.reply !== "string" || !payload.conversation) {
        throw new Error(typeof payload.error === "string" ? payload.error : "ไม่สามารถรับคำตอบได้");
      }
      setActiveConversationId(payload.conversation.id);
      setConversations((current) => [
        payload.conversation!,
        ...current.filter((item) => item.id !== payload.conversation!.id),
      ]);
      setMessages((current) => [...current, {
        id: `local-${nextId.current++}`,
        role: "assistant",
        content: payload.reply as string,
      }]);
    } catch (error) {
      setMessages((current) => [...current, {
        id: `local-${nextId.current++}`, role: "assistant",
        content: error instanceof Error ? error.message : "เกิดข้อผิดพลาด กรุณาลองใหม่", error: true,
      }]);
    } finally {
      setIsSending(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = message.trim();
    if (!value || isSending || !configured) return;
    setMessage("");
    void send(value);
  }

  function runQuickAction(action: QuickAction) {
    if (isSending || !configured) return;
    void send(action.prompt);
  }

  function startNewChat() {
    if (isSending || isHistoryLoading) return;
    setActiveConversationId(null);
    setMessages([]);
    setMessage("");
  }

  async function openConversation(conversationId: string) {
    if (isSending || isHistoryLoading || conversationId === activeConversationId) return;
    setIsHistoryLoading(true);
    try {
      const response = await fetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as {
        conversation?: ConversationSummary & { messages: ChatMessage[] };
        error?: unknown;
      };
      if (!response.ok || !payload.conversation) {
        throw new Error(typeof payload.error === "string" ? payload.error : "ไม่สามารถเปิดประวัติได้");
      }
      setActiveConversationId(payload.conversation.id);
      setMessages(payload.conversation.messages);
      setMessage("");
    } catch (error) {
      setMessages([{
        id: `local-${nextId.current++}`,
        role: "assistant",
        content: error instanceof Error ? error.message : "ไม่สามารถเปิดประวัติได้",
        error: true,
      }]);
    } finally {
      setIsHistoryLoading(false);
    }
  }

  const started = messages.length > 0;

  return (
    <div className="owner-chatbot owner-chatbot-page">
      <section className="owner-chat-panel" aria-label="ผู้ช่วยล็อตเตอรี่">
        <header className="owner-chat-header">
          <div className="owner-chat-brand">
            <AssistantAvatar className="owner-chat-logo" />
            <div>
              <h1>ผู้ช่วยล็อตเตอรี่</h1>
              <p>วิเคราะห์ข้อมูลล่าสุดจากระบบให้คุณ</p>
            </div>
          </div>
          <div className="owner-chat-scope" aria-label="ขอบเขตข้อมูลของผู้ช่วย">
            <DashboardIcon name="lock" />
            <span>ข้อมูลในระบบเท่านั้น</span>
          </div>
        </header>

        <div className="owner-chat-workspace">
          <aside className="owner-chat-history" aria-label="ประวัติการสนทนา">
            <div className="owner-chat-history-heading">
              <strong>ประวัติการสนทนา</strong>
              <button type="button" onClick={startNewChat} disabled={isSending || isHistoryLoading}>
                <DashboardIcon name="plus" />
                <span>แชทใหม่</span>
              </button>
            </div>
            <div className="owner-chat-history-list">
              {conversations.length === 0 ? (
                <p>ยังไม่มีประวัติการสนทนา</p>
              ) : conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  className={conversation.id === activeConversationId ? "active" : undefined}
                  aria-current={conversation.id === activeConversationId ? "true" : undefined}
                  disabled={isSending || isHistoryLoading}
                  onClick={() => void openConversation(conversation.id)}
                  title={conversation.title}
                >
                  <DashboardIcon name="chat" />
                  <span>{conversation.title}</span>
                </button>
              ))}
            </div>
          </aside>

          <div className="owner-chat-main">
        <div ref={bodyRef} className="owner-chat-body" aria-live="polite" aria-busy={isSending || isHistoryLoading}>
          <div className="owner-chat-day">วันนี้</div>
          <div className="owner-chat-message assistant">
            <AssistantAvatar className="owner-chat-avatar" />
            <div>
              <p>สวัสดีคุณ{ownerName} ผมผู้ช่วยล็อตเตอรี่ครับ มีอะไรให้ช่วยบอกมาได้เลยครับ</p>
              <p>ถามภาพรวมธุรกิจ ยอดขาย งานที่รอตรวจ หรือสถานะงวดได้เลยครับ ผมตอบเฉพาะข้อมูลจากฐานข้อมูลในระบบเท่านั้น</p>
            </div>
          </div>

          {!configured && (
            <div className="owner-chat-setup" role="note">
              <strong>ยังใช้งานไม่ได้ เพราะยังไม่ได้ตั้งค่าคีย์</strong>
              <ol>
                <li>
                  สร้าง API key จากระบบ OpenTyphoon
                </li>
                <li>
                  ใส่ค่าลงในไฟล์ <code>.env</code> ที่บรรทัด <code>TYPHOON_API_KEY=</code>
                </li>
                <li>รีสตาร์ต dev server หนึ่งครั้ง แล้วกลับมาที่หน้านี้</li>
              </ol>
              <small>
                ตั้งชื่อโมเดลได้ที่ <code>TYPHOON_MODEL</code> · คีย์ถูกอ่านที่ฝั่งเซิร์ฟเวอร์เท่านั้น
                ไม่เคยถูกส่งมาที่เบราว์เซอร์
              </small>
            </div>
          )}

          {messages.map((item) => (
            <div key={item.id} className={`owner-chat-message ${item.role}${item.error ? " error" : ""}`}>
              {item.role === "assistant" && <AssistantAvatar className="owner-chat-avatar" />}
              <div><p>{item.content}</p></div>
              {item.role === "user" && (
                <span className="owner-chat-avatar owner-chat-user-avatar" aria-hidden="true">
                  {ownerName.slice(0, 1)}
                </span>
              )}
            </div>
          ))}

          {isSending && (
            <div className="owner-chat-message assistant loading">
              <AssistantAvatar className="owner-chat-avatar" />
              <div><span /><span /><span /><em>กำลังวิเคราะห์ข้อมูล...</em></div>
            </div>
          )}
          {isHistoryLoading && (
            <div className="owner-chat-history-loading" role="status">กำลังเปิดประวัติการสนทนา...</div>
          )}
        </div>

        {quickActions.length > 0 && (
          <div className={`owner-chat-quickbar${started ? "" : " is-starter"}`} aria-label={started ? "ถามต่อ" : "คำถามที่ถามบ่อย"}>
            {quickActions.map((action) => (
              <button
                key={action.label}
                type="button"
                className="owner-chat-chip"
                onClick={() => runQuickAction(action)}
                disabled={isSending || !configured}
                title={action.prompt}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}

        <form className="owner-chat-composer" onSubmit={submit}>
          <div>
            <input value={message} onChange={(event) => setMessage(event.target.value)}
              placeholder={configured ? "พิมพ์คำถาม..." : "กรุณาตั้งค่า Typhoon API ก่อนใช้งาน"}
              aria-label="พิมพ์คำถาม" maxLength={2_000} disabled={!configured || isSending} autoFocus />
            <button type="submit" disabled={!configured || !message.trim() || isSending} aria-label="ส่งข้อความ">
              <DashboardIcon name="send" />
            </button>
          </div>
          <small>
            ตอบเฉพาะข้อมูลจากฐานข้อมูลขององค์กรปัจจุบัน · ไม่ใช้ข้อมูลภายนอก ·
            ข้อมูลสรุปที่ส่งไปวิเคราะห์รวมรหัสอ้างอิงลูกค้าในบิลด้วย
          </small>
        </form>
          </div>
        </div>
      </section>
    </div>
  );
}
