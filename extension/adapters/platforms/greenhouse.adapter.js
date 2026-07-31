import{GenericHtmlAdapter}from"../generic-html-adapter.js";
export class GreenhouseAdapter extends GenericHtmlAdapter{
 constructor(){super({id:"greenhouse",version:"1.0.0",label:"Greenhouse",tier:"ATS_FAMILY"});}
 matches(url){const host=url.hostname.toLowerCase();return host==="job-boards.greenhouse.io"||host==="boards.greenhouse.io"||host.endsWith(".greenhouse.io");}
}
