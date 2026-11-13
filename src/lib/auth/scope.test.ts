import { describe, expect, test } from "vitest";
import { auditScope, billScope, NO_AGENT_SENTINEL, orgScope, type ScopeSubject } from "./scope";

const ORG = "org-1";
const OTHER_ORG = "org-2";

function subject(overrides: Partial<ScopeSubject>): ScopeSubject {
  return {
    organizationId: ORG,
    role: "ADMIN",
    userId: "user-1",
    agentId: null,
    ...overrides,
  };
}

describe("billScope — Agent เห็นเฉพาะบิลของตนเอง", () => {
  test("AGENT ถูกจำกัดด้วย agentId ของตนเอง", () => {
    const scope = billScope(subject({ role: "AGENT", agentId: "agent-A" }));
    expect(scope).toEqual({ organizationId: ORG, agentId: "agent-A" });
  });

  test("ขอบเขตของ Agent A ไม่ตรงกับบิลของ Agent B", () => {
    const scope = billScope(subject({ role: "AGENT", agentId: "agent-A" }));
    const billOfB = { organizationId: ORG, agentId: "agent-B" };
    expect(scope.agentId).not.toBe(billOfB.agentId);
  });

  test("AGENT ที่ agentId หลุดเป็น null ได้ sentinel ไม่ใช่เห็นทั้งองค์กร", () => {
    const scope = billScope(subject({ role: "AGENT", agentId: null }));
    expect(scope).toEqual({ organizationId: ORG, agentId: NO_AGENT_SENTINEL });
    // สำคัญ: ต้องไม่หลุดเป็น where ที่ไม่มี agentId
    expect(Object.keys(scope)).toContain("agentId");
  });

  test.each(["OWNER", "ADMIN"] as const)(
    "%s เห็นทุกบิลในองค์กรแต่ไม่ข้ามองค์กร",
    (role) => {
      const scope = billScope(subject({ role }));
      expect(scope).toEqual({ organizationId: ORG });
      expect(scope.organizationId).not.toBe(OTHER_ORG);
    },
  );

  test("ทุกบทบาทมี organizationId เสมอ", () => {
    for (const role of ["OWNER", "ADMIN", "AGENT"] as const) {
      expect(billScope(subject({ role, agentId: "agent-A" })).organizationId).toBe(ORG);
    }
  });
});

describe("orgScope", () => {
  test("จำกัดที่องค์กรของผู้ใช้", () => {
    expect(orgScope(subject({}))).toEqual({ organizationId: ORG });
  });
});

describe("auditScope", () => {
  test.each(["OWNER", "ADMIN"] as const)("%s เห็น audit ทั้งองค์กร", (role) => {
    expect(auditScope(subject({ role }))).toEqual({ organizationId: ORG });
  });

  test("AGENT เห็นเฉพาะเหตุการณ์ที่ตนเองเป็นผู้กระทำ", () => {
    const scope = auditScope(subject({ role: "AGENT", userId: "user-A", agentId: "agent-A" }));
    expect(scope).toEqual({ organizationId: ORG, actorId: "user-A" });
  });
});
