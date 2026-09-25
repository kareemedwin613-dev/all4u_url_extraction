import type { TailoringInput } from "./types.js";
import { GENERIC_TAILORING_PROMPT_V1, TAILORING_OUTPUT_INSTRUCTIONS, TAILORING_PROMPT_HEADER } from "./prompt-template.js";

const monthIndex=(value:string|null,present:Date):number|null=>{
  if(value===null)return present.getUTCFullYear()*12+present.getUTCMonth();
  const match=/^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);return match?Number(match[1])*12+Number(match[2])-1:null;
};
export function tailoringRoleTargets(input:TailoringInput,referenceDate=new Date()){
  return input.sourceResume.professionalExperience.map(role=>{
    const start=monthIndex(role.startDate,referenceDate),end=monthIndex(role.endDate,referenceDate),months=start===null||end===null||end<start?null:end-start;
    return{sourceExperienceId:role.id,projects:months===null||months<=24?2:months<=36?3:4,bullets:months===null||months<=36?4:months<=48?5:7};
  });
}

export function tailoringModelContext(input:TailoringInput){
  return{
    jobDescription:{company:input.jobDescription.company,jobTitle:input.jobDescription.jobTitle,descriptionText:input.jobDescription.descriptionText,skills:input.jobDescription.skills},
    sourceResume:{skills:input.sourceResume.skills,professionalExperience:input.sourceResume.professionalExperience.map(({id,company,title,location,startDate,endDate})=>({id,company,title,location,startDate,endDate}))},
  };
}

export function buildTailoringPrompt(input:TailoringInput,referenceDate=new Date()){
  if(input.contractVersion==="1.3"||input.contractVersion==="1.4"){
    if(!input.promptSnapshot||!["2","3","4"].includes(input.promptSnapshot.contractVersion))throw new Error("TAILORING_PROMPT_CONTRACT_UNSUPPORTED: Update the tailoring worker.");
    return input.promptSnapshot.composedPrompt;
  }
  const context=JSON.stringify(tailoringModelContext(input));
  const roleTargets=JSON.stringify(tailoringRoleTargets(input,referenceDate));
  return `${TAILORING_PROMPT_HEADER}

TAILORING
${GENERIC_TAILORING_PROMPT_V1.instructions}

${TAILORING_OUTPUT_INSTRUCTIONS}

ROLE_TARGETS_JSON
${roleTargets}

BEGIN_UNTRUSTED_INPUT_JSON
${context}
END_UNTRUSTED_INPUT_JSON`;
}
