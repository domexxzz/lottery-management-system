export function resultValueCount(prizeCode: number): number {
  return prizeCode === 3 || prizeCode === 4 ? 2 : 1;
}

export function storedResultValues(result: { value: string; values?: string[] | null }): string[] {
  const values = result.values?.map((value) => value.trim()).filter(Boolean) ?? [];
  return values.length > 0 ? values : [result.value];
}

export function displayResultValues(result: { value: string; values?: string[] | null }): string {
  return storedResultValues(result).join(" · ");
}
