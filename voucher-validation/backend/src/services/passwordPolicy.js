// src/services/passwordPolicy.js
//
// The one definition of an acceptable password for a link-set password.
//
// It exists because the rules used to live only in the browser: the
// set-password page ticked off length, mixed case and a non-letter, while the
// server checked length alone. Anyone posting to /invite/accept directly — or
// any future page that forgot to copy the rules — could set a password the page
// would have refused. Rules enforced only on the client are suggestions.
//
// The page keeps its own copy for the live checklist; this is the one that
// decides. They must match: frontend/src/pages/SetPassword.jsx RULES.

export const PASSWORD_RULES = [
  { key: "len",  label: "At least 8 characters",  test: (v) => v.length >= 8 },
  { key: "case", label: "Upper and lower case",   test: (v) => /[a-z]/.test(v) && /[A-Z]/.test(v) },
  { key: "num",  label: "A number or symbol",     test: (v) => /[^A-Za-z]/.test(v) },
];

/** null when acceptable, otherwise the first unmet rule, phrased for the person. */
export function passwordProblem(password) {
  const v = String(password ?? "");
  if (v.length > 200) return "That password is longer than 200 characters.";
  const miss = PASSWORD_RULES.find((r) => !r.test(v));
  return miss ? `Your password needs: ${miss.label.toLowerCase()}.` : null;
}
