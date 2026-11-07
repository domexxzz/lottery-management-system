export function customerProfileKey(name: string): string {
  return Buffer.from(name.trim(), "utf8").toString("base64url");
}

export function customerNameFromProfileKey(key: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(key)) return null;
  const name = Buffer.from(key, "base64url").toString("utf8").trim();
  if (name === "" || customerProfileKey(name) !== key) return null;
  return name;
}
