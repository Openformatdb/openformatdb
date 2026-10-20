// Naive POLICY.md screen for agent-written text (v0): keyword match, refuse, point to the policy.
// False positives are expected and fine: the agent rephrases or a human reviews the PR.

export interface PolicyHit { field: string; rule: string; match: string }

const RULES: { rule: string; re: RegExp }[] = [
  { rule: "removing DRM or copy protection", re: /\b(remov|strip|bypass|break|crack|circumvent|defeat|disabl)\w*\s+(the\s+|its\s+)?(drm|copy[\s-]?protection|content protection)\b|\b(drm|copy[\s-]?protection)\s+(remov|strip|bypass|break|crack|circumvent)\w*/i },
  { rule: "publishing keys or credentials", re: /\b(extracted|leaked|dumped|decryption|private|licen[cs]e|serial)\s+keys?\b|\bpasswords?\s+(list|dump)\b/i },
  { rule: "hosting copies of paywalled standards", re: /\b(full|complete|pirated|leaked)\s+(copy|pdf|text)\s+of\s+(the\s+)?(iso|iec|ieee|astm|din)\b/i },
];

export const POLICY_POINTER =
  "POLICY.md (section \"Refused\"): no copies of paywalled standards, no vendor code, keys or credentials, " +
  "nothing whose purpose is to remove DRM or copy protection, no sample files you may not share.";

/** Scan named text fields; returns every hit. */
export function policyScan(fields: [string, string | undefined][]): PolicyHit[] {
  const hits: PolicyHit[] = [];
  for (const [field, text] of fields) {
    if (!text) continue;
    for (const { rule, re } of RULES) {
      const m = text.match(re);
      if (m) hits.push({ field, rule, match: m[0] });
    }
  }
  return hits;
}
