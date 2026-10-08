import{GenericHtmlAdapter}from"../generic-html-adapter.js";
import{WORKABLE_SECTIONS,detectRepeatableSections,fillRepeatableSections}from"../../autofill/repeatable-sections.js";
// Workable collects Experience and Education one entry at a time behind "+ Add"; every Resume entry is added.
export class WorkableAdapter extends GenericHtmlAdapter{
 constructor(){super({id:"workable",version:"1.1.0",label:"Workable",tier:"ATS_FAMILY"});}
 matches(url){const host=url.hostname.toLowerCase();return host==="apply.workable.com"||host.endsWith(".workable.com");}
 detectFields(context={}){const result=super.detectFields(context);return{...result,sections:detectRepeatableSections(context.root||document,WORKABLE_SECTIONS)};}
 async fillFields(context={}){const results=await super.fillFields(context);return[...results,...await fillRepeatableSections(context.root||document,context.sections,WORKABLE_SECTIONS)];}
}
