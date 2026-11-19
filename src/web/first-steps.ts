/**
 * The commands a participant needs to drop their first kloss from a terminal: with login on,
 * first get a token, then drop with it. Shown in the viewer's hint and help card.
 */
export interface Step {
  label: string;
  command: string;
}

const SAFE_EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+$/;

export function firstSteps(o: {
  origin: string;
  code: string;
  auth: boolean;
  email?: string | null;
}): Step[] {
  const drop = (auth: boolean) =>
    `curl -X POST ${o.origin}/api/sessions/${o.code}/klossar${
      auth ? ' -H "Authorization: Bearer $TOKEN"' : ""
    } -d '2,0|2x4|blue'`;
  if (!o.auth) return [{ label: "Drop your first kloss", command: drop(false) }];
  // only a plain address goes into the command; anything else gets the placeholder
  const email = o.email && SAFE_EMAIL.test(o.email) ? o.email : "you@example.com";
  return [
    {
      label: "Log in: get a token (valid for 8 hours; use your password)",
      command: `TOKEN=$(curl -s -X POST ${o.origin}/api/token -H 'content-type: application/json' -d '{"email":"${email}","password":"PASSWORD"}' | jq -r .access_token)`,
    },
    { label: "Drop your first kloss", command: drop(true) },
  ];
}
