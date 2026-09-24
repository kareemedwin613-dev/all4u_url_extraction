import { authenticatedApiRequest } from "../../services/api-client.js";
export async function promptRequest(client, baseUrl, path = "", method = "GET", body) {
  const { payload } = await authenticatedApiRequest(client, { baseUrl, path: `/api/v1/tailoring-prompts${path}`, method, body });
  return payload.data;
}
export const promptDraftValues = detail => ({ name: detail?.draft_name || "", instructions: detail?.draft_body || "", priority: detail?.draft_priority ?? 0 });
export function buildPromptTree(prompts, categories) {
  const visible = (scope, primary = null, sub = null) => prompts.filter(p => p.scope === scope && p.primary_category_id === primary && p.subcategory_id === sub);
  const published = rows => rows.some(p => p.published_version && !p.archived);
  const leaf = p => ({ key: `prompt:${p.id}`, promptId: p.id, isLeaf: true,
    title: `${p.draft_name} · ${p.archived ? "Archived" : p.published_version ? `Published v${p.published_version}` : "Draft"}${p.draft_pending && p.published_version ? " + Draft" : ""} · Priority ${p.published_priority ?? p.draft_priority}` });
  const generic = visible("GENERIC");
  const tree = [{ key: "GENERIC", title: "Generic", scope: "GENERIC", children: generic.map(leaf) }];
  const primaryIds = new Set([...(categories?.primary || []).map(c => c.id), ...prompts.map(p => p.primary_category_id).filter(Boolean)]);
  for (const primary of primaryIds) {
    const defaults = visible("PRIMARY", primary), category = categories?.byId?.get(primary);
    const node = { key: `PRIMARY:${primary}`, title: `${category?.name || "Unavailable category"}${published(defaults) ? "" : " · Uses Generic"}`,
      scope: "PRIMARY", primaryCategoryId: primary, children: defaults.map(leaf) };
    const subtypeIds = new Set([...(categories?.childrenByParent?.get(primary) || []).map(c => c.id), ...prompts.filter(p => p.primary_category_id === primary).map(p => p.subcategory_id).filter(Boolean)]);
    for (const sub of subtypeIds) {
      const rows = visible("SUBTYPE", primary, sub);
      node.children.push({ key: `SUBTYPE:${sub}`, title: `${categories?.byId?.get(sub)?.name || "Unavailable subtype"}${published(rows) ? "" : published(defaults) ? " · Uses category default" : " · Uses Generic"}`,
        scope: "SUBTYPE", primaryCategoryId: primary, subcategoryId: sub, children: rows.map(leaf) });
    }
    tree.push(node);
  }
  return tree;
}
