import { seniorityCompatibility } from "./seniority.js";
import { matchingTechStacks } from "./tech-stacks.js";
export function scoreMatch(job,resume,threshold=60) {
  const stacks=matchingTechStacks(job,resume);
  if (!stacks.length) return {eligible:false,total:0,reason:"different-category"};
  const category={matched:true,points:50,maximum:50};
  const exactSub=job.subcategoryId&&stacks.some((stack)=>stack.subcategoryId&&stack.subcategoryId===job.subcategoryId);
  const unspecified=!job.subcategoryId||stacks.some((stack)=>!stack.subcategoryId);
  const subcategory={matched:!!exactSub,points:exactSub?20:unspecified?10:0,maximum:20,reason:exactSub?"exact":unspecified?"one-or-both-unspecified":"different"};
  const compat=seniorityCompatibility(job.seniority,resume.seniority); const seniority={job:job.seniority,resume:resume.seniority,...compat,maximum:15};
  const jd=[...new Set(job.detectedSkills||[])].sort(), rs=new Set(resume.skills||[]), matched=jd.filter((s)=>rs.has(s)), missing=jd.filter((s)=>!rs.has(s));
  const points=jd.length?Math.round((15*matched.length/jd.length)*100)/100:0;
  const skills={jobSkills:jd,resumeSkills:[...rs].sort(),matchedSkills:matched,missingSkills:missing,points,maximum:15};
  const total=Math.round((50+subcategory.points+seniority.points+points)*100)/100;
  return {version:"rule-based-v1",eligible:total>=threshold,threshold,category,subcategory,seniority,skills,total};
}
export function rankMatches(job,resumes,threshold=60) { return resumes.map((resume)=>({resume,details:scoreMatch(job,resume,threshold)})).filter((x)=>x.details.reason!=="different-category").sort((a,b)=>b.details.total-a.details.total||new Date(b.resume.updatedAt)-new Date(a.resume.updatedAt)||a.resume.id.localeCompare(b.resume.id)).slice(0,20); }
export function summarizeBatch(results=[]) { return results.reduce((out,item)=>{out[item.status]=(out[item.status]||0)+1;return out;},{created:0,alreadyQueued:0,failed:0}); }
