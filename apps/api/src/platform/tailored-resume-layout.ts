import { tailoredHeadline } from "./tailored-headline.js";
import { resolveTailoredSkillGroups, type TailoredSkillGroup } from "./tailored-skill-groups.js";

// Layout decisions for the tailored PDF. The prioritized skills list arrives JD-supported first,
// then the candidate's own skills, then evidenced additions; these helpers keep that order.
export const RENDERED_SKILL_LIMIT = 30;
export const ENVIRONMENT_LIMIT = 10;

const clean = (value: unknown) => String(value ?? "").trim().replace(/\s+/g, " ");
const key = (value: unknown) => clean(value).toLocaleLowerCase();
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function resolveResumeHeadline(input: Record<string, any>): string | null {
  return tailoredHeadline(input?.targetJob?.title, input?.resumeSeniority, input?.targetJob?.company) || clean(input?.resumeHeadline) || null;
}

// Top skills only, grouped. A group's weight is the summed relevance of its skills, so one
// highly ranked tool ("Excel") does not outrank a group of core skills; the catch-all goes last.
export function renderedSkillGroups(skillsValue: unknown, groupsValue: unknown, limit = RENDERED_SKILL_LIMIT): TailoredSkillGroup[] {
  const seen = new Set<string>(), top: string[] = [];
  for (const raw of Array.isArray(skillsValue) ? skillsValue : []) {
    const skill = clean(raw), skillKey = key(skill);
    if (!skill || seen.has(skillKey)) continue;
    seen.add(skillKey); top.push(skill);
    if (top.length === limit) break;
  }
  const rank = new Map(top.map((skill, index) => [key(skill), index]));
  const weight = (group: TailoredSkillGroup) => group.name === "Additional Skills" ? -1 : group.skills.reduce((sum, skill) => sum + top.length - (rank.get(key(skill)) ?? top.length), 0);
  return resolveTailoredSkillGroups(top, groupsValue).map(group => ({ ...group, skills: group.skills.filter(skill => rank.has(key(skill))) }))
    .filter(group => group.skills.length).sort((left, right) => weight(right) - weight(left));
}

// Short terms (C, R, Go) match too much ordinary prose to count as evidence.
function mentions(text: string, skill: string) {
  const term = clean(skill);
  return term.length >= 3 && new RegExp(`(?<![A-Za-z0-9])${term.split(" ").map(escapeRegExp).join("\\s+")}(?![A-Za-z0-9])`, "i").test(text);
}

// Technologies for one role: final skills that the role's own source details name, in priority order.
export function roleEnvironment(skillsValue: unknown, roleDetails: unknown, limit = ENVIRONMENT_LIMIT): string[] {
  const details = String(roleDetails ?? ""), found: string[] = [], seen = new Set<string>();
  for (const raw of Array.isArray(skillsValue) ? skillsValue : []) {
    const skill = clean(raw);
    if (!skill || seen.has(key(skill)) || !mentions(details, skill)) continue;
    seen.add(key(skill)); found.push(skill);
    if (found.length === limit) break;
  }
  return found.length >= 2 ? found : [];
}
