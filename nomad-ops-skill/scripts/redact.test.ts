/**
 * redact.test.ts — unit tests for the redactSecrets function.
 * Run: npx ts-node scripts/redact.test.ts
 */

// ── Inline the function under test (no import needed, same logic as client) ──

const REDACTED_KEYS = new Set([
  "SecretID", "secret_id", "SecretId",
  "AccessorID",
  "OneTimeSecretID",
  "Token",
]);
const REDACTED_MARKER = "[REDACTED]";

function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) =>
        REDACTED_KEYS.has(k) ? [k, REDACTED_MARKER] : [k, redactSecrets(v)]
      )
    );
  }
  return value;
}

// ── Test harness ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(description: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ✓ ${description}`);
    passed++;
  } else {
    console.error(`  ✗ ${description}`);
    console.error(`    expected: ${e}`);
    console.error(`    actual  : ${a}`);
    failed++;
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

console.log("redactSecrets");

assert(
  "leaves non-secret fields untouched",
  redactSecrets({ ID: "abc", Name: "my-token", Global: true }),
  { ID: "abc", Name: "my-token", Global: true }
);

assert(
  "redacts SecretID",
  redactSecrets({ ID: "abc", SecretID: "s3cr3t-uuid" }),
  { ID: "abc", SecretID: REDACTED_MARKER }
);

assert(
  "redacts secret_id (snake_case variant)",
  redactSecrets({ id: "x", secret_id: "exposed" }),
  { id: "x", secret_id: REDACTED_MARKER }
);

assert(
  "redacts AccessorID",
  redactSecrets({ AccessorID: "a1b2c3", SecretID: "xyz" }),
  { AccessorID: REDACTED_MARKER, SecretID: REDACTED_MARKER }
);

assert(
  "redacts OneTimeSecretID",
  redactSecrets({ OneTimeSecretID: "ot-secret" }),
  { OneTimeSecretID: REDACTED_MARKER }
);

assert(
  "redacts Token (field)",
  redactSecrets({ Token: "token-val" }),
  { Token: REDACTED_MARKER }
);

assert(
  "redacts nested secrets",
  redactSecrets({ Wrap: { ID: "t1", SecretID: "nested-secret", Name: "dev" } }),
  { Wrap: { ID: "t1", SecretID: REDACTED_MARKER, Name: "dev" } }
);

assert(
  "redacts secrets inside arrays",
  redactSecrets([
    { ID: "a", SecretID: "s1" },
    { ID: "b", SecretID: "s2" },
  ]),
  [
    { ID: "a", SecretID: REDACTED_MARKER },
    { ID: "b", SecretID: REDACTED_MARKER },
  ]
);

assert(
  "handles null values without throwing",
  redactSecrets(null),
  null
);

assert(
  "handles primitive string passthrough",
  redactSecrets("plain string"),
  "plain string"
);

assert(
  "handles empty object",
  redactSecrets({}),
  {}
);

assert(
  "handles deeply nested structure",
  redactSecrets({
    Tokens: [
      { ID: "1", SecretID: "deep-secret", Policies: ["read"] }
    ],
    Meta: { env: "prod" }
  }),
  {
    Tokens: [
      { ID: "1", SecretID: REDACTED_MARKER, Policies: ["read"] }
    ],
    Meta: { env: "prod" }
  }
);

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
