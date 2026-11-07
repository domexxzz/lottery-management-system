export type TyphoonResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  code?: string;
  error?: { message?: string } | string;
};

export function extractTyphoonText(payload: TyphoonResponse): string | null {
  const content = payload.choices?.[0]?.message?.content;
  return typeof content === "string" && content.trim() ? content.trim() : null;
}

/** ดึงข้อความจาก error ของ OpenAI-compatible API โดยไม่ผูกกับหน้าตาเดียว */
export function extractTyphoonError(payload: TyphoonResponse): string {
  if (typeof payload.error === "string") return payload.error;
  if (payload.error?.message) return payload.error.message;
  if (payload.code) return payload.code;
  return "unknown";
}

export function isTyphoonAuthFailure(status: number, providerMessage: string): boolean {
  if (status === 401 || status === 403) return true;
  return /api[ _-]?key|unauthori|authentication|credential/i.test(providerMessage);
}
