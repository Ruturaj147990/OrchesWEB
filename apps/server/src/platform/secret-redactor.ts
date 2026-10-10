export class SecretRedactor {
  private static patterns: RegExp[] = [
    /sk-[a-zA-Z0-9_-]{20,}/g, // OpenAI API keys
    /ghp_[a-zA-Z0-9]{36}/g, // GitHub Personal Access Tokens
    /Bearer\s+[a-zA-Z0-9._~+/-]{20,}/gi, // Bearer tokens
    /-----BEGIN[ A-Z0-9_-]+PRIVATE KEY-----[\s\S]*?-----END[ A-Z0-9_-]+PRIVATE KEY-----/g, // Private keys
    /([a-zA-Z0-9_]*(?:SECRET|KEY|PASSWORD|TOKEN|AUTH)[a-zA-Z0-9_]*\s*[:=]\s*["']?)([^"'\r\n\s]{8,})(["']?)/gi, // Common env secrets
  ];

  public static redactString(input: string): string {
    if (!input || typeof input !== "string") return input;
    let redacted = input;
    for (const pat of this.patterns) {
      redacted = redacted.replace(pat, (match, prefix, secretVal, suffix) => {
        if (prefix !== undefined && secretVal !== undefined) {
          return `${prefix}[REDACTED_SECRET]${suffix || ""}`;
        }
        return "[REDACTED_SECRET]";
      });
    }
    return redacted;
  }

  public static redactObject<T>(obj: T): T {
    if (!obj || typeof obj !== "object") {
      if (typeof obj === "string") {
        return this.redactString(obj) as unknown as T;
      }
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.redactObject(item)) as unknown as T;
    }

    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.includes("secret") ||
        lowerKey.includes("password") ||
        lowerKey.includes("token") ||
        lowerKey.includes("apikey") ||
        lowerKey.includes("api_key")
      ) {
        if (typeof val === "string") {
          result[key] = "[REDACTED_CREDENTIAL]";
          continue;
        }
      }
      result[key] = this.redactObject(val);
    }
    return result as T;
  }
}
