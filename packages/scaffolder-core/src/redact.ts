// Redactor: masks registered secret values in log output.
export class Redactor {
  private secrets: string[] = [];

  add(value: string | undefined | null): this {
    if (!value) return this;
    if (value.length < 4) return this;
    if (!this.secrets.includes(value)) this.secrets.push(value);
    return this;
  }

  addMany(values: Array<string | undefined | null>): this {
    for (const v of values) this.add(v);
    return this;
  }

  redact(input: string): string {
    let out = input;
    // Replace longer secrets first to avoid partial overlaps leaking.
    const sorted = [...this.secrets].sort((a, b) => b.length - a.length);
    for (const secret of sorted) {
      out = out.split(secret).join("***");
    }
    return out;
  }

  size(): number {
    return this.secrets.length;
  }
}

export function createRedactor(values?: Array<string | undefined | null>): Redactor {
  const r = new Redactor();
  if (values) r.addMany(values);
  return r;
}
