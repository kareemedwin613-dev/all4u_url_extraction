// Synthetic content only. No reference-document candidate data is copied into the repo.
export function referenceResumeFixture(long = false) {
  const skills=["Python","SQL","TypeScript","Java","React","Next.js","FastAPI","AWS","Azure","Docker","Kubernetes","Terraform","PostgreSQL","Snowflake","Apache Spark","Kafka","REST APIs","GraphQL","HTML","CSS","Machine Learning","PyTorch","RAG","Microservices","OAuth","Observability","Unit Testing","Code Reviews","Agile","Jira","Not rendered beyond the existing top-30 limit"];
  const roles=Array.from({length:long?7:2},(_,index)=>({id:`exp-${index}`,job_title:index?"Software Engineer":"Senior Software Engineer",company:`Example ${["Systems","Analytics","Platforms","Services","Products","Research","Digital"][index]}`,start_date:{year:2024-index*2,month:1},end_date:index?{year:2026-index*2,month:1}:null,is_current:index===0,experience_details:"Built Python and SQL services on AWS."}));
  const bullets=[
    "Delivered Python and SQL services supporting reliable customer-facing workflows, reducing processing time by 30% through measured query and API improvements.",
    "Built reusable platform components and documented integration patterns so product teams could deliver consistent experiences across applications.",
    "Improved production reliability through automated testing, observability, and incident reviews with engineering and product partners.",
    "Coordinated incremental releases with a cross-functional team, preserving service availability while replacing legacy integrations.",
    "Designed event-driven data workflows with clear ownership, validation checks, and operational documentation for downstream consumers.",
    "Strengthened access controls and release checks, reducing recurring support requests while keeping delivery predictable.",
    "Mentored engineers through design reviews and shared troubleshooting guides, helping the team maintain services independently.",
  ];
  return {applicationNumber:128,candidate:{name:"Alex Morgan",email:"alex@example.com",phone:"(555) 010-0128",city:"Boston",stateRegion:"MA",linkedinUrl:"linkedin.com/in/alex-example"},targetJob:{title:"Senior Software Engineer",company:"Example Company"},resumeSeniority:"SENIOR",sourceStructuredContent:{professional_experience:roles,education:[{institution:"Example University",degree:"Bachelor of Science",field_of_study:"Computer Science",start_date:{year:2008},end_date:{year:2012}}],certifications:[]},approvedPreview:{summary:"Software engineer delivering reliable applications, data services, and reusable platform components. Experienced in collaborating with product teams, improving operational quality, and translating complex requirements into maintainable systems.",professionalExperience:roles.map(role=>({sourceExperienceId:role.id,tailoredDetails:bullets.slice(0,long?7:3).map(value=>`- ${value}`).join("\n")})),skills,skillGroups:[]}};
}
