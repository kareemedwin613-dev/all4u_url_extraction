import React from "react";
import {experienceDateRange,normalizeStructuredResumeV2} from "./resume-structure.js";

export function StructuredResumeView({content,version}){
  if(Number(version)<2)return <>{[["Summary",content?.summary],["Professional Experience",content?.professional_experience],["Education",content?.education],["Skills Section",content?.skills]].map(([heading,value])=>typeof value==="string"&&value?<details key={heading} open><summary>{heading}</summary><div className="long-text">{value}</div></details>:null)}</>;
  const value=normalizeStructuredResumeV2(content);
  return <div className="structured-resume-view">{value.summary&&<section><h3>Summary</h3><div className="long-text">{value.summary}</div></section>}<section><h3>Professional Experience</h3>{value.professional_experience.length?value.professional_experience.map(item=><article className="resume-position" key={item.id}><div><strong>{item.company}</strong><span>{experienceDateRange(item)}</span></div><div><em>{item.job_title}</em><span>{item.location}</span></div>{item.experience_details&&<div className="long-text">{item.experience_details}</div>}</article>):<p className="muted">No professional experience recorded.</p>}</section>{value.education&&<section><h3>Education</h3><div className="long-text">{value.education}</div></section>}{value.skills&&<section><h3>Skills Section</h3><div className="long-text">{value.skills}</div></section>}</div>;
}
