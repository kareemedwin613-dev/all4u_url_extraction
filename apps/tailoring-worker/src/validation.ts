import type { SourceExperience, TailoringInput, TailoringOutput } from "./types.js";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REFUSAL=/\b(unable to|cannot (?:produce|tailor|complete)|provide (?:the )?(?:contents|input)|without (?:the )?(?:source|input|resume content))\b/i;
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==="object"&&!Array.isArray(value);
const clean=(value:unknown)=>typeof value==="string"?value.trim():"";
const exactKeys=(value:Record<string,unknown>,allowed:string[],label:string)=>{
  const unexpected=Object.keys(value).filter(key=>!allowed.includes(key));
  if(unexpected.length)throw new Error(`${label} contains unsupported fields: ${unexpected.join(", ")}.`);
};
const boundedText=(value:unknown,label:string,min:number,max:number)=>{
  const result=clean(value);
  if(result.length<min||result.length>max)throw new Error(`${label} must contain between ${min} and ${max} characters.`);
  return result;
};
const boundedStrings=(value:unknown,label:string,maxItems:number,maxLength:number)=>{
  if(!Array.isArray(value)||value.length>maxItems)throw new Error(`${label} must be an array with at most ${maxItems} items.`);
  return value.map((item,index)=>boundedText(item,`${label}[${index}]`,1,maxLength));
};
const unique=(items:string[])=>new Set(items.map(item=>item.toLocaleLowerCase())).size===items.length;

function validateExperience(value:unknown,index:number):SourceExperience{
  if(!object(value))throw new Error(`sourceResume.professionalExperience[${index}] must be an object.`);
  exactKeys(value,["id","company","title","location","startDate","endDate","details"],`sourceResume.professionalExperience[${index}]`);
  const nullable=(key:string,limit:number)=>value[key]==null?null:boundedText(value[key],`experience ${key}`,1,limit);
  return{
    id:boundedText(value.id,"experience id",1,120),
    company:boundedText(value.company,"experience company",1,200),
    title:boundedText(value.title,"experience title",1,200),
    location:nullable("location",200),startDate:nullable("startDate",40),endDate:nullable("endDate",40),
    details:boundedText(value.details,"experience details",1,20000)
  };
}

export function validateTailoringInput(value:unknown):TailoringInput{
  if(!object(value))throw new Error("Tailoring input must be an object.");
  exactKeys(value,["contractVersion","application","jobDescription","sourceResume"],"Tailoring input");
  if(value.contractVersion!=="1.2")throw new Error("Tailoring input contractVersion must be 1.2.");
  const application=value.application,job=value.jobDescription,resume=value.sourceResume;
  if(!object(application)||!object(job)||!object(resume))throw new Error("Application, jobDescription, and sourceResume are required objects.");
  exactKeys(application,["id","applicationNumber"],"application");
  exactKeys(job,["id","company","jobTitle","descriptionText","skills"],"jobDescription");
  exactKeys(resume,["id","resumeNumber","resumeType","summary","skills","professionalExperience"],"sourceResume");
  if(!UUID.test(clean(application.id))||!UUID.test(clean(job.id))||!UUID.test(clean(resume.id)))throw new Error("Application, JD, and Resume IDs must be UUIDs.");
  if(!Number.isSafeInteger(application.applicationNumber)||Number(application.applicationNumber)<1)throw new Error("applicationNumber must be a positive integer.");
  if(!Number.isSafeInteger(resume.resumeNumber)||Number(resume.resumeNumber)<1)throw new Error("resumeNumber must be a positive integer.");
  if(resume.resumeType!=="ORIGINAL")throw new Error("Only an ORIGINAL Resume can be tailored.");
  const jobSkills=boundedStrings(job.skills,"jobDescription.skills",250,120),resumeSkills=boundedStrings(resume.skills,"sourceResume.skills",250,120);
  if(!unique(resumeSkills))throw new Error("sourceResume.skills must not contain duplicates.");
  if(!Array.isArray(resume.professionalExperience)||resume.professionalExperience.length<1||resume.professionalExperience.length>30)throw new Error("sourceResume.professionalExperience must contain between 1 and 30 records.");
  const professionalExperience=resume.professionalExperience.map(validateExperience);
  if(!unique(professionalExperience.map(item=>item.id)))throw new Error("Source experience IDs must be unique.");
  return{
    contractVersion:"1.2",
    application:{id:clean(application.id),applicationNumber:Number(application.applicationNumber)},
    jobDescription:{id:clean(job.id),company:boundedText(job.company,"jobDescription.company",1,200),jobTitle:boundedText(job.jobTitle,"jobDescription.jobTitle",1,300),descriptionText:boundedText(job.descriptionText,"jobDescription.descriptionText",100,300000),skills:jobSkills},
    sourceResume:{id:clean(resume.id),resumeNumber:Number(resume.resumeNumber),resumeType:"ORIGINAL",summary:boundedText(resume.summary,"sourceResume.summary",1,10000),skills:resumeSkills,professionalExperience}
  };
}

export function validateTailoringOutput(value:unknown,input:TailoringInput):TailoringOutput{
  if(!object(value))throw new Error("Codex output must be a JSON object.");
  exactKeys(value,["summary","professionalExperience","skills","changeSummary","unsupportedRequirements","warnings"],"Codex output");
  const summary=boundedText(value.summary,"summary",1,4000),skills=boundedStrings(value.skills,"skills",250,120);
  if(REFUSAL.test(summary))throw new Error("Codex returned a refusal or placeholder instead of a tailored summary.");
  if(!unique(skills))throw new Error("Tailored skills must not contain duplicates.");
  const sourceSkills=new Set(input.sourceResume.skills.map(item=>item.toLocaleLowerCase()));
  const invented=skills.filter(item=>!sourceSkills.has(item.toLocaleLowerCase()));
  if(invented.length)throw new Error(`Tailored skills are not present in the source Resume: ${invented.join(", ")}.`);
  const relevantSourceSkills=input.sourceResume.skills.filter(skill=>input.jobDescription.descriptionText.toLocaleLowerCase().includes(skill.toLocaleLowerCase()));
  if(relevantSourceSkills.length&&!skills.some(skill=>relevantSourceSkills.some(source=>source.toLocaleLowerCase()===skill.toLocaleLowerCase())))throw new Error("Codex omitted every source skill that is explicitly relevant to the JD.");
  if(!Array.isArray(value.professionalExperience)||value.professionalExperience.length!==input.sourceResume.professionalExperience.length)throw new Error("Codex must return exactly one tailored entry for every source experience.");
  const expected=new Set(input.sourceResume.professionalExperience.map(item=>item.id));
  const seen=new Set<string>();
  const professionalExperience=value.professionalExperience.map((item,index)=>{
    if(!object(item))throw new Error(`professionalExperience[${index}] must be an object.`);
    exactKeys(item,["sourceExperienceId","tailoredDetails"],`professionalExperience[${index}]`);
    const sourceExperienceId=boundedText(item.sourceExperienceId,`professionalExperience[${index}].sourceExperienceId`,1,120);
    if(!expected.has(sourceExperienceId))throw new Error(`Unknown source experience ID: ${sourceExperienceId}.`);
    if(seen.has(sourceExperienceId))throw new Error(`Duplicate source experience ID: ${sourceExperienceId}.`);
    seen.add(sourceExperienceId);
    const tailoredDetails=boundedText(item.tailoredDetails,`professionalExperience[${index}].tailoredDetails`,1,12000);
    if(REFUSAL.test(tailoredDetails))throw new Error(`Codex returned a refusal or placeholder for source experience ${sourceExperienceId}.`);
    return{sourceExperienceId,tailoredDetails};
  });
  const unsupportedRequirements=boundedStrings(value.unsupportedRequirements,"unsupportedRequirements",100,500),sourceCorpus=[input.sourceResume.summary,...input.sourceResume.skills,...input.sourceResume.professionalExperience.map(item=>item.details)].join("\n").toLocaleLowerCase(),unsubstantiatedSkills=input.jobDescription.skills.filter(skill=>!sourceCorpus.includes(skill.toLocaleLowerCase())),unsupportedCorpus=unsupportedRequirements.join("\n").toLocaleLowerCase(),unreported=unsubstantiatedSkills.filter(skill=>!unsupportedCorpus.includes(skill.toLocaleLowerCase()));
  if(unreported.length)throw new Error(`Unsupported JD skills were not reported: ${unreported.join(", ")}.`);
  return{summary,professionalExperience,skills,changeSummary:boundedStrings(value.changeSummary,"changeSummary",100,500),unsupportedRequirements,warnings:boundedStrings(value.warnings,"warnings",100,500)};
}
