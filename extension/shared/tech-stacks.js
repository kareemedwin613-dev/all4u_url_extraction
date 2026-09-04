const clean = (value) => String(value || "").trim();
const uniqueIds = (value) => [...new Set((Array.isArray(value) ? value : [value]).map(clean).filter(Boolean))];

export function resumeTechStacks(resume = {}) {
  if (Array.isArray(resume.tech_stacks) && resume.tech_stacks.length) {
    return resume.tech_stacks.map((row) => ({
      primaryCategoryId: row.primaryCategoryId || row.primary_category_id,
      subcategoryId: row.subcategoryId || row.subcategory_id || null,
    }));
  }
  if (Array.isArray(resume.primaryCategoryIds) && resume.primaryCategoryIds.length) {
    return pairTechStacks(resume.primaryCategoryIds, resume.subcategoryIds || [], resume.categoryParentById);
  }
  if (resume.primaryCategoryId || resume.primary_category_id) {
    return [{
      primaryCategoryId: resume.primaryCategoryId || resume.primary_category_id,
      subcategoryId: resume.subcategoryId || resume.subcategory_id || null,
    }];
  }
  return [];
}

export function pairTechStacks(primaryIds, subcategoryIds, parentById) {
  const primaries = uniqueIds(primaryIds);
  const subs = uniqueIds(subcategoryIds);
  const parentOf = parentById instanceof Map ? parentById : new Map(Object.entries(parentById || {}));
  return primaries.flatMap((primaryId) => {
    const children = subs.filter((id) => parentOf.get(id) === primaryId);
    return children.length
      ? children.map((subcategoryId) => ({ primaryCategoryId: primaryId, subcategoryId }))
      : [{ primaryCategoryId: primaryId, subcategoryId: null }];
  });
}

export function parentByIdFromCategories(categories = []) {
  return new Map((Array.isArray(categories) ? categories : []).map((item) => [item.id, item.parent_id || null]));
}

export function matchingTechStacks(job, resume) {
  const categoryId = job?.categoryId || job?.category_id;
  return resumeTechStacks(resume).filter((stack) => stack.primaryCategoryId === categoryId);
}
