import{GenericHtmlAdapter}from"../generic-html-adapter.js";
export class IcimsAdapter extends GenericHtmlAdapter{
 constructor(){super({id:"icims",version:"1.0.0",label:"iCIMS",tier:"ATS_FAMILY"});}
 matches(url){try{return /(^|\.)icims\.com$/i.test(new URL(url).hostname);}catch{return false;}}
}
