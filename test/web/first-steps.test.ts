import { describe, expect, test } from "bun:test";
import { firstSteps } from "../../src/web/first-steps.ts";

const origin = "https://kloss.example";

describe("firstSteps", () => {
  test("with login off, one command drops a kloss into the session", () => {
    const steps = firstSteps({ origin, code: "otter-maple-42", auth: false });
    expect(steps).toHaveLength(1);
    expect(steps[0]?.command).toBe(
      "curl -X POST https://kloss.example/api/sessions/otter-maple-42/klossar -d '2,0|2x4|blue'",
    );
  });

  test("with login on, first get a token (with your own e-mail filled in), then drop", () => {
    const steps = firstSteps({
      origin,
      code: "otter-maple-42",
      auth: true,
      email: "ada@example.com",
    });
    expect(steps).toHaveLength(2);
    expect(steps[0]?.label).toContain("token");
    expect(steps[0]?.command).toBe(
      `TOKEN=$(curl -s -X POST https://kloss.example/api/token -H 'content-type: application/json' -d '{"email":"ada@example.com","password":"PASSWORD"}' | jq -r .access_token)`,
    );
    expect(steps[1]?.command).toBe(
      `curl -X POST https://kloss.example/api/sessions/otter-maple-42/klossar -H "Authorization: Bearer $TOKEN" -d '2,0|2x4|blue'`,
    );
  });

  test("without a known e-mail address, a placeholder shows where yours goes", () => {
    const steps = firstSteps({ origin, code: "otter-maple-42", auth: true });
    expect(steps[0]?.command).toContain('"email":"you@example.com"');
  });

  test("an e-mail address cannot break out of the quoted command", () => {
    const steps = firstSteps({ origin, code: "x-y-10", auth: true, email: "a'b\"c@example.com" });
    expect(steps[0]?.command).not.toContain("a'b");
  });
});
