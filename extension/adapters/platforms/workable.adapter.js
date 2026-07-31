import{GenericHtmlAdapter}from"../generic-html-adapter.js";
export class WorkableAdapter extends GenericHtmlAdapter{
 constructor(){super({id:"workable",version:"1.0.0",label:"Workable",tier:"ATS_FAMILY"});}
 matches(url){const host=url.hostname.toLowerCase();return host==="apply.workable.com"||host.endsWith(".workable.com");}
}
