// Measurements in PDF points, from the six supplied US Letter references.
// No candidate text or personal data belongs in these reusable layouts.
export type ReferenceTemplateKey = "ALEGREYA_CLASSIC_V1" | "AMIRI_COMPACT_V1" | "LORA_BANDS_V1" | "CRIMSON_BANDS_V1" | "TITILLIUM_BANNER_V1" | "TITILLIUM_EXPERIENCE_V1";
export type ResumeSection = "summary" | "skills" | "experience" | "education";
export type ReferenceResumeLayout = {
  key: ReferenceTemplateKey; name: string; description: string; font: string; fontAsset: string;
  margin: number; top: number; body: number; leading: number; nameSize: number; headlineSize: number;
  headingSize: number; sectionGap: number; groupGap: number; roleGap: number;
  header: "centered" | "inline" | "stacked" | "banner";
  heading: "rule" | "gray-band" | "blue-band"; uppercase: boolean;
  skillColumns: number; inlineEmployer: boolean; degreeFirst: boolean; boldLead: boolean;
  sections: readonly ResumeSection[];
};
const definitions: ReferenceResumeLayout[] = [
  {key:"ALEGREYA_CLASSIC_V1",name:"Alegreya Classic",description:"Centered serif header, ruled headings and stacked skill groups; Bradley reference.",font:"Alegreya",fontAsset:"alegreya",margin:62.35,top:32,body:10.5,leading:11.5,nameSize:22,headlineSize:15.2,headingSize:13.5,sectionGap:12,groupGap:9,roleGap:8,header:"centered",heading:"rule",uppercase:true,skillColumns:1,inlineEmployer:false,degreeFirst:true,boldLead:true,sections:["summary","skills","experience","education"]},
  {key:"AMIRI_COMPACT_V1",name:"Amiri Compact",description:"Compact inline header, thin rules and four-column skills after education; Derek reference.",font:"Amiri",fontAsset:"amiri",margin:34,top:31,body:9.5,leading:10.6,nameSize:18,headlineSize:12.7,headingSize:10.5,sectionGap:11,groupGap:9,roleGap:8,header:"inline",heading:"rule",uppercase:false,skillColumns:4,inlineEmployer:true,degreeFirst:true,boldLead:true,sections:["summary","experience","education","skills"]},
  {key:"LORA_BANDS_V1",name:"Lora Bands",description:"Large stacked header, gray heading bands and two-column skills; William reference.",font:"Lora",fontAsset:"lora",margin:51.02,top:46,body:11,leading:13.5,nameSize:25,headlineSize:17.5,headingSize:12,sectionGap:18,groupGap:13,roleGap:14,header:"stacked",heading:"gray-band",uppercase:false,skillColumns:2,inlineEmployer:true,degreeFirst:true,boldLead:false,sections:["summary","skills","experience","education"]},
  {key:"CRIMSON_BANDS_V1",name:"Crimson Bands",description:"Inline serif header, gray heading bands and two-column skills at the end; Michael reference.",font:"Crimson Text",fontAsset:"crimson-text",margin:28.34,top:27,body:11,leading:12,nameSize:19.5,headlineSize:16.9,headingSize:12,sectionGap:13,groupGap:9,roleGap:9,header:"inline",heading:"gray-band",uppercase:true,skillColumns:2,inlineEmployer:false,degreeFirst:false,boldLead:false,sections:["summary","experience","education","skills"]},
  {key:"TITILLIUM_BANNER_V1",name:"Titillium Banner",description:"Blue banner, icon headings and three-column skills before experience; John reference.",font:"Titillium Web",fontAsset:"titillium-web",margin:28.34,top:28,body:9.5,leading:11.2,nameSize:26.5,headlineSize:17.5,headingSize:10.5,sectionGap:13,groupGap:9,roleGap:10,header:"banner",heading:"blue-band",uppercase:true,skillColumns:3,inlineEmployer:false,degreeFirst:true,boldLead:true,sections:["summary","skills","experience","education"]},
  {key:"TITILLIUM_EXPERIENCE_V1",name:"Titillium Experience",description:"Blue banner, experience-first layout and stacked skills; Eric reference.",font:"Titillium Web",fontAsset:"titillium-web",margin:28.34,top:30,body:9.5,leading:11.2,nameSize:27,headlineSize:17.8,headingSize:10.5,sectionGap:14,groupGap:10,roleGap:10,header:"banner",heading:"blue-band",uppercase:true,skillColumns:1,inlineEmployer:false,degreeFirst:true,boldLead:false,sections:["summary","experience","skills","education"]},
];
export const REFERENCE_RESUME_LAYOUTS = Object.freeze(definitions.map(layout => Object.freeze({...layout, sections:Object.freeze([...layout.sections])})));
export const ACTIVE_RESUME_TEMPLATE_KEYS = Object.freeze(REFERENCE_RESUME_LAYOUTS.map(layout => layout.key));
export const referenceResumeLayout = (key: string) => REFERENCE_RESUME_LAYOUTS.find(layout => layout.key === key);
