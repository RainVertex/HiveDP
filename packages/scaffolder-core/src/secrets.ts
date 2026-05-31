// In-memory SecretAccessor seeded from a name to value map.
import type { SecretAccessor } from "./actions/types";
import type { Redactor } from "./redact";

export function createSecretAccessor(
  values: Record<string, string | undefined>,
  redactor: Redactor,
): SecretAccessor {
  return {
    read(name) {
      const v = values[name];
      if (!v) throw new Error(`Required scaffolder secret not configured: ${name}`);
      redactor.add(v);
      return v;
    },
    tryRead(name) {
      const v = values[name];
      if (!v) return null;
      redactor.add(v);
      return v;
    },
    names() {
      return Object.keys(values).filter((k) => Boolean(values[k]));
    },
  };
}
