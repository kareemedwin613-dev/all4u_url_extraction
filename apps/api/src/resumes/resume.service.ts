import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import type { AuthenticatedUser } from "@resume-jd/contracts";
import { createHash, randomUUID } from "node:crypto";
import { ApiException } from "../common/errors/api.exception.js";
import { SupabaseService } from "../supabase/supabase.service.js";

export const RESUME_LIST_FIELDS="id,resume_number,resume_type,parent_resume_id,candidate_name,candidate_email,candidate_phone,resume_name,primary_category_id,subcategory_id,seniority,skills,industries,original_filename,mime_type,file_size_bytes,file_sha256,status,archived_at,archived_by,profile_review_status,created_at,updated_at,cover_letter_storage_path,cover_letter_original_filename";
export const RESUME_DETAIL_FIELDS=`${RESUME_LIST_FIELDS},user_id,candidate_first_name,candidate_middle_name,candidate_last_name,address_line_1,address_line_2,address_city,address_state_region,address_postal_code,address_country,linkedin_url,github_url,portfolio_url,profile_reviewed_by,profile_reviewed_at,profile_schema_version,resume_text,structured_content,structured_schema_version,storage_bucket,storage_path,cover_letter_storage_bucket,cover_letter_mime_type,cover_letter_file_size_bytes,cover_letter_file_sha256`;
const COVER_LETTER_MIMES=["application/pdf","application/vnd.openxmlformats-officedocument.wordprocessingml.document","text/plain"];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SORTS:any={number_asc:["resume_number",true],number_desc:["resume_number",false],candidate_asc:["candidate_name",true],candidate_desc:["candidate_name",false],name_asc:["resume_name",true],name_desc:["resume_name",false],category_asc:["primary_category_id",true],category_desc:["primary_category_id",false],subcategory_asc:["subcategory_id",true],subcategory_desc:["subcategory_id",false],seniority_asc:["seniority",true],seniority_desc:["seniority",false],status_asc:["status",true],status_desc:["status",false],mime_asc:["mime_type",true],mime_desc:["mime_type",false],updated_asc:["updated_at",true],updated_desc:["updated_at",false]};
const clean=(value:any)=>String(value??"").trim(),array=(value:any)=>[...new Set((Array.isArray(value)?value:String(value||"").split(",")).map(clean).filter(Boolean))];
const ids=(value:any)=>[...new Set((Array.isArray(value)?value:[value]).map(clean).filter((item)=>UUID.test(item)))];
type ResumeStackInput={primaryCategoryId:string;subcategoryId:string|null};
function hasStackInput(m:any){return Array.isArray(m?.techStacks)||Array.isArray(m?.primaryCategoryIds)||Boolean(m?.primaryCategoryId);}
async function resolveStacks(client:any,m:any):Promise<ResumeStackInput[]>{
  if(Array.isArray(m?.techStacks)&&m.techStacks.length){
    const stacks:ResumeStackInput[]=m.techStacks.map((row:any)=>({primaryCategoryId:clean(row?.primaryCategoryId||row?.primary_category_id),subcategoryId:clean(row?.subcategoryId||row?.subcategory_id)||null})).filter((row:ResumeStackInput)=>UUID.test(row.primaryCategoryId)).slice(0,12);
    if(!stacks.length)throw new ApiException("VALIDATION_ERROR","Select at least one primary category.",HttpStatus.BAD_REQUEST);
    return stacks;
  }
  const primaries=ids(m?.primaryCategoryIds?.length?m.primaryCategoryIds:m?.primaryCategoryId),subs=ids(m?.subcategoryIds?.length?m.subcategoryIds:m?.subcategoryId);
  if(!primaries.length)throw new ApiException("VALIDATION_ERROR","Select at least one primary category.",HttpStatus.BAD_REQUEST);
  if(!subs.length)return primaries.map((id):ResumeStackInput=>({primaryCategoryId:id,subcategoryId:null}));
  const{data,error}=await client.from("categories").select("id,parent_id").in("id",[...primaries,...subs]);
  if(error)fail(error,"Categories could not be loaded.");
  const parent=new Map((data||[]).map((row:any)=>[row.id,row.parent_id]));
  return primaries.flatMap((primaryId:string):ResumeStackInput[]=>{
    const children=subs.filter((id)=>parent.get(id)===primaryId);
    return children.length
      ?children.map((subcategoryId):ResumeStackInput=>({primaryCategoryId:primaryId,subcategoryId}))
      :[{primaryCategoryId:primaryId,subcategoryId:null}];
  });
}
async function saveStacks(client:any,resumeId:string,stacks:any[]){
  const{error}=await client.rpc("replace_resume_tech_stacks_v357",{p_resume_id:resumeId,p_stacks:stacks});
  if(error)fail(error,"Resume tech stacks could not be saved.");
}
function decorateStacks(row:any,stacks:any[]){
  const tech_stacks=stacks.length?stacks:(row.primary_category_id?[{primary_category_id:row.primary_category_id,subcategory_id:row.subcategory_id||null}]:[]);
  return{...row,tech_stacks,primary_category_ids:[...new Set(tech_stacks.map((item:any)=>item.primary_category_id))],subcategory_ids:[...new Set(tech_stacks.map((item:any)=>item.subcategory_id).filter(Boolean))]};
}
async function attachStacks(client:any,rows:any){
  const list=(Array.isArray(rows)?rows:[rows]).filter(Boolean);
  if(!list.length)return rows;
  const fallback=()=>{const decorated=list.map((row:any)=>decorateStacks(row,[]));return Array.isArray(rows)?decorated:decorated[0];};
  try{
    if(typeof client?.from!=="function")return fallback();
    let query:any=client.from("resume_tech_stacks").select("resume_id,primary_category_id,subcategory_id,sort_order").in("resume_id",list.map((row:any)=>row.id));
    if(typeof query?.order==="function")query=query.order("sort_order");
    if(typeof query?.order==="function")query=query.order("id");
    const{data,error}=await query;
    if(error)return fallback();
    const byResume=new Map<string,any[]>();
    for(const row of data||[]){const current=byResume.get(row.resume_id)||[];current.push({primary_category_id:row.primary_category_id,subcategory_id:row.subcategory_id});byResume.set(row.resume_id,current);}
    const decorated=list.map((row:any)=>decorateStacks(row,byResume.get(row.id)||[]));
    return Array.isArray(rows)?decorated:decorated[0];
  }catch{
    return fallback();
  }
}
const structuredV3=(value:any)=>{const source=value&&typeof value==="object"?value:{},education=source.education;return{...source,professional_experience:Array.isArray(source.professional_experience)?source.professional_experience:[],education_legacy_text:typeof education==="string"?education:String(source.education_legacy_text||""),education:Array.isArray(education)?education:[],certifications:Array.isArray(source.certifications)?source.certifications:[]};};
const safeName=(value:string)=>value.normalize("NFKC").replace(/[^A-Za-z0-9._-]+/g,"_").replace(/^\.+/,"").slice(-180)||"resume.pdf";
const optional=(value:any,limit:number)=>clean(value).slice(0,limit)||null;
const secureUrl=(value:any)=>{const result=clean(value);return !result?null:/^https:\/\/[^\s]+$/i.test(result)&&result.length<=2000?result:undefined;};
function fail(error:any,message:string):never{
  const raw=String(error?.message||"");
  if(error?.code==="42501"||/row-level security|permission denied|FORBIDDEN:/i.test(raw))throw new ApiException("FORBIDDEN","The database policy denied this operation.",HttpStatus.FORBIDDEN);
  const known=raw.match(/^([A-Z][A-Z0-9_]+):\s*(.+)$/);
  if(known)throw new ApiException(known[1],known[2],known[1].includes("NOT_FOUND")?HttpStatus.NOT_FOUND:HttpStatus.BAD_REQUEST);
  throw new ApiException("DATABASE_ERROR",message,HttpStatus.BAD_GATEWAY);
}

@Injectable()
export class ResumeService{
  constructor(@Inject(SupabaseService)private readonly supabase:SupabaseService){}
  async list(user:AuthenticatedUser,q:any){
    const client=this.supabase.forUser(user.token),requestedPage=Number(q.page),requestedSize=Number(q.pageSize),page=Number.isInteger(requestedPage)&&requestedPage>0?requestedPage:1,size=[10,25,50,100].includes(requestedSize)?requestedSize:25,sort=SORTS[q.sort]||SORTS.candidate_asc,search=clean(q.search).slice(0,100),numberSearch=search.replace(/^(resume[- ]?|#)/i,""),status=q.status==="ARCHIVED"?"ARCHIVED":q.status==="ALL"?"":"ACTIVE";
    let x:any=client.from("resumes").select(RESUME_LIST_FIELDS,{count:"exact"}).eq("resume_type","ORIGINAL");
    if(status)x=x.eq("status",status);
    if(search){if(/^\d+$/.test(numberSearch))x=x.eq("resume_number",Number(numberSearch));else x=x.textSearch("search_vector",search,{type:"websearch",config:"english"});}
    if(q.categoryId&&UUID.test(String(q.categoryId))){
      const{data:stackRows,error:stackError}=await client.from("resume_tech_stacks").select("resume_id").eq("primary_category_id",q.categoryId);
      if(stackError)fail(stackError,"Resumes could not be loaded.");
      const stackIds=[...new Set((stackRows||[]).map((row:any)=>row.resume_id))];
      if(!stackIds.length)return{items:[],total:0,page:1,pageSize:size,pageCount:0,from:0,to:0,hasPrevious:false,hasNext:false};
      x=x.in("id",stackIds);
    }
    for(const [key,column,allowed]of [["seniority","seniority",["INTERN","ENTRY","JUNIOR","MID","SENIOR","LEAD","PRINCIPAL","MANAGER","DIRECTOR","EXECUTIVE","UNSPECIFIED"]],["mimeType","mime_type",COVER_LETTER_MIMES]]as any[])if(q[key]&&(!allowed||allowed.includes(q[key])))x=x.eq(column,q[key]);
    const {data,error,count}=await x.order(sort[0],{ascending:sort[1]}).range((page-1)*size,page*size-1);
    if(error)fail(error,"Resumes could not be loaded.");
    const total=Number(count)||0,pages=total?Math.ceil(total/size):0;
    return{items:await attachStacks(client,data||[]),total,page:pages?Math.min(page,pages):1,pageSize:size,pageCount:pages,from:total?(page-1)*size+1:0,to:Math.min(page*size,total),hasPrevious:page>1,hasNext:page<pages};
  }
  async detail(user:AuthenticatedUser,id:string){const client=this.supabase.forUser(user.token),{data,error}=await client.from("resumes").select(RESUME_DETAIL_FIELDS).eq("id",id).maybeSingle();if(error)fail(error,"The Resume could not be loaded.");if(!data)return data;const decorated=await attachStacks(client,data);return{...decorated,candidate_profile:{id:data.id,review_status:data.profile_review_status}};}
  async count(user:AuthenticatedUser,status?:string){let q:any=this.supabase.forUser(user.token).from("resumes").select("id",{count:"exact",head:true}).eq("resume_type","ORIGINAL");if(status)q=q.eq("status",status);const{count,error}=await q;if(error)fail(error,"The Resume count could not be loaded.");return Number(count)||0;}
  async recent(user:AuthenticatedUser){const client=this.supabase.forUser(user.token),{data,error}=await client.from("resumes").select(RESUME_LIST_FIELDS).eq("resume_type","ORIGINAL").eq("status","ACTIVE").order("updated_at",{ascending:false}).limit(5);if(error)fail(error,"Recent Resumes could not be loaded.");return attachStacks(client,data||[]);}
  async identity(user:AuthenticatedUser,m:any){const{data,error}=await this.supabase.forUser(user.token).rpc("find_resume_identity_duplicates",{p_candidate_name:clean(m.candidateName),p_candidate_email:clean(m.candidateEmail).toLowerCase(),p_candidate_phone:clean(m.candidatePhone)});if(error)fail(error,"The duplicate Resume check failed.");return data||[];}
  async checksum(user:AuthenticatedUser,checksum:string){if(!/^[0-9a-f]{64}$/.test(checksum))throw new ApiException("VALIDATION_ERROR","The Resume checksum is invalid.",HttpStatus.BAD_REQUEST);const{data,error}=await this.supabase.forUser(user.token).from("resumes").select("id,resume_number,candidate_name,resume_name").eq("file_sha256",checksum).eq("status","ACTIVE").eq("resume_type","ORIGINAL").limit(1);if(error)fail(error,"The duplicate-file check failed.");return data?.[0]||null;}
  async upload(user:AuthenticatedUser,metadata:any,file:any){
    if(!file||file.size<1||file.size>5242880)throw new ApiException("VALIDATION_ERROR","Choose a file between 1 byte and 5 MB.",HttpStatus.BAD_REQUEST);
    if(!COVER_LETTER_MIMES.includes(file.mimetype))throw new ApiException("VALIDATION_ERROR","The Resume file type is not supported.",HttpStatus.BAD_REQUEST);
    const links=[secureUrl(metadata.linkedInUrl),secureUrl(metadata.githubUrl),secureUrl(metadata.portfolioUrl)];
    if(metadata.reviewConfirmed!==true||links.some(value=>value===undefined))throw new ApiException("VALIDATION_ERROR","Review and confirm the Resume metadata. Professional links must use HTTPS.",HttpStatus.BAD_REQUEST);
    const first=optional(metadata.candidateFirstName,100),last=optional(metadata.candidateLastName,100);
    if(!first||!last)throw new ApiException("VALIDATION_ERROR","Candidate first and last name are required for verified Autofill metadata.",HttpStatus.BAD_REQUEST);
    const email=clean(metadata.candidateEmail).toLowerCase(),phone=clean(metadata.candidatePhone);
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||phone.replace(/\D/g,"").length<7||phone.replace(/\D/g,"").length>15)throw new ApiException("VALIDATION_ERROR","A valid candidate email and phone number are required.",HttpStatus.BAD_REQUEST);
    const id=randomUUID(),path=`${user.id}/${id}/${safeName(file.originalname)}`,client=this.supabase.forUser(user.token),stacks=await resolveStacks(client,metadata),row={
      id,user_id:user.id,candidate_name:clean(metadata.candidateName),candidate_first_name:first,candidate_middle_name:optional(metadata.candidateMiddleName,100),candidate_last_name:last,
      candidate_email:email,candidate_phone:phone,
      address_line_1:optional(metadata.addressLine1,200),address_line_2:optional(metadata.addressLine2,200),address_city:optional(metadata.city,120),address_state_region:optional(metadata.stateRegion,120),address_postal_code:optional(metadata.postalCode,40),address_country:optional(metadata.country,120),
      linkedin_url:links[0],github_url:links[1],portfolio_url:links[2],profile_review_status:"VERIFIED",profile_reviewed_by:user.id,profile_reviewed_at:new Date().toISOString(),profile_schema_version:1,
      resume_type:"ORIGINAL",parent_resume_id:null,resume_name:clean(metadata.resumeName),primary_category_id:stacks[0].primaryCategoryId,subcategory_id:stacks[0].subcategoryId||null,seniority:metadata.seniority||"UNSPECIFIED",skills:array(metadata.skills),industries:array(metadata.industries),
      resume_text:clean(metadata.resumeText),structured_content:structuredV3(metadata.structuredContent),structured_schema_version:3,storage_bucket:"original-resumes",storage_path:path,original_filename:file.originalname,mime_type:file.mimetype,file_size_bytes:file.size,file_sha256:clean(metadata.checksum),status:"ACTIVE"
    };
    if(!row.candidate_name||!row.resume_name||row.resume_text.length<100||!/^[0-9a-f]{64}$/.test(row.file_sha256))throw new ApiException("VALIDATION_ERROR","Review the required Resume metadata and checksum.",HttpStatus.BAD_REQUEST);
    const uploaded=await client.storage.from("original-resumes").upload(path,file.buffer,{contentType:file.mimetype,upsert:false});
    if(uploaded.error)fail(uploaded.error,"The private Resume file could not be uploaded.");
    const{data,error}=await client.from("resumes").insert(row).select(RESUME_DETAIL_FIELDS).single();
    if(error){await client.storage.from("original-resumes").remove([path]);fail(error,"Resume metadata could not be saved.");}
    try{await saveStacks(client,data.id,stacks);}catch(stackError){await client.from("resumes").delete().eq("id",data.id);await client.storage.from("original-resumes").remove([path]);throw stackError;}
    return attachStacks(client,data);
  }
  async update(user:AuthenticatedUser,id:string,m:any){
    const client=this.supabase.forUser(user.token),stacks=hasStackInput(m)?await resolveStacks(client,m):null,changes:any={candidate_name:clean(m.candidateName),resume_name:clean(m.resumeName),seniority:m.seniority,skills:array(m.skills),industries:array(m.industries)};
    if(stacks){changes.primary_category_id=stacks[0].primaryCategoryId;changes.subcategory_id=stacks[0].subcategoryId||null;}
    else if(m.primaryCategoryId){changes.primary_category_id=m.primaryCategoryId;changes.subcategory_id=m.subcategoryId||null;}
    const{data,error}=await client.from("resumes").update(changes).eq("id",id).eq("resume_type","ORIGINAL").select(RESUME_LIST_FIELDS).single();
    if(error)fail(error,"Original Resume metadata could not be updated.");
    if(stacks)await saveStacks(client,id,stacks);
    return attachStacks(client,data);
  }
  async rename(user:AuthenticatedUser,id:string,resumeName:string){
    const name=clean(resumeName).slice(0,200);
    if(!name)throw new ApiException("VALIDATION_ERROR","Enter a Resume name.",HttpStatus.BAD_REQUEST);
    const client=this.supabase.forUser(user.token),{data,error}=await client.from("resumes").update({resume_name:name}).eq("id",id).eq("resume_type","ORIGINAL").select(RESUME_LIST_FIELDS).single();
    if(error)fail(error,"The Resume name could not be updated.");
    return attachStacks(client,data);
  }
  async status(user:AuthenticatedUser,id:string,status:string){if(!["ACTIVE","ARCHIVED"].includes(status))throw new ApiException("VALIDATION_ERROR","Select a valid Resume status.",HttpStatus.BAD_REQUEST);const client=this.supabase.forUser(user.token),{data,error}=await client.rpc("set_resume_archived_state_v23",{p_resume_id:id,p_status:status});if(error)fail(error,"Original Resume status could not be updated.");return data?attachStacks(client,data):data;}
  async signedUrl(user:AuthenticatedUser,id:string){const row=await this.detail(user,id);if(!row)throw new ApiException("NOT_FOUND","The Resume was not found.",HttpStatus.NOT_FOUND);const{data,error}=await this.supabase.forUser(user.token).storage.from(row.storage_bucket).createSignedUrl(row.storage_path,90);if(error||!data?.signedUrl)fail(error,"The private Resume file could not be opened.");return{signedUrl:data.signedUrl,expiresInSeconds:90,filename:row.original_filename,resumeNumber:row.resume_number,resumeType:row.resume_type};}

  async uploadCoverLetter(user:AuthenticatedUser,id:string,file:any){
    if(!file||file.size<1||file.size>5242880)throw new ApiException("VALIDATION_ERROR","Choose a cover letter between 1 byte and 5 MB.",HttpStatus.BAD_REQUEST);
    if(!COVER_LETTER_MIMES.includes(file.mimetype))throw new ApiException("VALIDATION_ERROR","The cover letter file type is not supported.",HttpStatus.BAD_REQUEST);
    const resume=await this.detail(user,id);
    if(!resume)throw new ApiException("NOT_FOUND","The Resume was not found.",HttpStatus.NOT_FOUND);
    if(resume.resume_type!=="ORIGINAL")throw new ApiException("RESUME_TYPE_INVALID","Cover letters can only be attached to original Resumes.",HttpStatus.BAD_REQUEST);
    if(!resume.user_id)throw new ApiException("DATABASE_ERROR","Cover letter storage path could not be resolved for this Resume.",HttpStatus.BAD_GATEWAY);
    const filename=safeName(file.originalname||"cover-letter.pdf"),path=`${resume.user_id}/${resume.id}/cover-${filename}`,checksum=createHash("sha256").update(file.buffer).digest("hex"),client=this.supabase.forUser(user.token);
    const uploaded=await client.storage.from("cover-letters").upload(path,file.buffer,{contentType:file.mimetype,upsert:true});
    if(uploaded.error)fail(uploaded.error,"The private cover letter file could not be uploaded.");
    const{data,error}=await client.rpc("set_resume_cover_letter_v37",{
      p_resume_id:id,
      p_storage_path:path,
      p_original_filename:file.originalname||filename,
      p_mime_type:file.mimetype,
      p_file_size_bytes:file.size,
      p_file_sha256:checksum,
    });
    if(error){
      await client.storage.from("cover-letters").remove([path]);
      fail(error,"Cover letter metadata could not be saved.");
    }
    const previousPath=data?.previousPath,previousBucket=data?.previousBucket||"cover-letters";
    if(previousPath&&previousPath!==path)await client.storage.from(previousBucket).remove([previousPath]);
    return data?.resume||await this.detail(user,id);
  }

  async coverLetterSignedUrl(user:AuthenticatedUser,id:string){
    const row=await this.detail(user,id);
    if(!row)throw new ApiException("NOT_FOUND","The Resume was not found.",HttpStatus.NOT_FOUND);
    if(!row.cover_letter_storage_path||!row.cover_letter_storage_bucket)throw new ApiException("COVER_LETTER_NOT_FOUND","This Resume does not have a cover letter.",HttpStatus.NOT_FOUND);
    const{data,error}=await this.supabase.forUser(user.token).storage.from(row.cover_letter_storage_bucket).createSignedUrl(row.cover_letter_storage_path,90);
    if(error||!data?.signedUrl)fail(error,"The private cover letter file could not be opened.");
    return{signedUrl:data.signedUrl,expiresInSeconds:90,filename:row.cover_letter_original_filename,mimeType:row.cover_letter_mime_type,fileSizeBytes:row.cover_letter_file_size_bytes};
  }

  async removeCoverLetter(user:AuthenticatedUser,id:string){
    const client=this.supabase.forUser(user.token);
    const{data,error}=await client.rpc("clear_resume_cover_letter_v37",{p_resume_id:id});
    if(error)fail(error,"The cover letter could not be removed.");
    const previousPath=data?.previousPath,previousBucket=data?.previousBucket||"cover-letters";
    if(previousPath)await client.storage.from(previousBucket).remove([previousPath]);
    return data?.resume||await this.detail(user,id);
  }

  async listBannedCompanies(user:AuthenticatedUser,id:string){
    const{data,error}=await this.supabase.forUser(user.token).rpc("list_resume_banned_companies_v38",{p_resume_id:id});
    if(error)fail(error,"Banned companies could not be loaded.");
    return data||[];
  }

  async addBannedCompany(user:AuthenticatedUser,id:string,companyName:string){
    const name=clean(companyName);
    if(!name||name.length>200)throw new ApiException("VALIDATION_ERROR","Enter a company name between 1 and 200 characters.",HttpStatus.BAD_REQUEST);
    const{data,error}=await this.supabase.forUser(user.token).rpc("add_resume_banned_company_v38",{p_resume_id:id,p_company_name:name});
    if(error)fail(error,"The banned company could not be added.");
    return data;
  }

  async removeBannedCompany(user:AuthenticatedUser,id:string,entryId:string){
    const{data,error}=await this.supabase.forUser(user.token).rpc("remove_resume_banned_company_v38",{p_resume_id:id,p_id:entryId});
    if(error)fail(error,"The banned company could not be removed.");
    return data;
  }

  async applierProfile(user:AuthenticatedUser,id:string){
    const{data,error}=await this.supabase.forUser(user.token).rpc("get_resume_applier_profile_v313",{p_resume_id:id});
    if(error)fail(error,"The Applier profile for this Resume could not be loaded.");
    return data||null;
  }
}
