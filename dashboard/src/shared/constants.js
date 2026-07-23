export const APP_NAME="Resume JD Operations";
export const PAGE_SIZES=Object.freeze([10,25,50]);
export const STATUSES=Object.freeze(["ACTIVE","ARCHIVED"]);
export const SENIORITIES=Object.freeze(["INTERN","ENTRY","JUNIOR","MID","SENIOR","LEAD","PRINCIPAL","MANAGER","DIRECTOR","EXECUTIVE","UNSPECIFIED"]);
export const MIME_TYPES=Object.freeze(["application/pdf","application/vnd.openxmlformats-officedocument.wordprocessingml.document","text/plain"]);
export const JOB_SORTS=Object.freeze({created_desc:{column:"created_at",ascending:false},created_asc:{column:"created_at",ascending:true},company_asc:{column:"company",ascending:true},title_asc:{column:"job_title",ascending:true}});
export const RESUME_SORTS=Object.freeze({updated_desc:{column:"updated_at",ascending:false},updated_asc:{column:"updated_at",ascending:true},candidate_asc:{column:"candidate_name",ascending:true},name_asc:{column:"resume_name",ascending:true}});
export const SEARCH_MAX=100,SIGNED_URL_SECONDS=90;
