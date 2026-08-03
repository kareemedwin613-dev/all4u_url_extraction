import{GenericHtmlAdapter}from"../generic-html-adapter.js";
export class LeverAdapter extends GenericHtmlAdapter{
 constructor(){super({id:"lever",version:"1.0.0",label:"Lever",tier:"ATS_FAMILY"});}
 matches(url){try{return /(^|\.)lever\.co$/i.test(new URL(url).hostname);}catch{return false;}}
}
