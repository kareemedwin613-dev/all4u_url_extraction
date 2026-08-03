import{GenericHtmlAdapter}from"./generic-html-adapter.js";
import{GreenhouseAdapter}from"./platforms/greenhouse.adapter.js";
import{WorkableAdapter}from"./platforms/workable.adapter.js";
import{LeverAdapter}from"./platforms/lever.adapter.js";
import{IcimsAdapter}from"./platforms/icims.adapter.js";

const required=["matches","detectResumeField","detectFields","attachResume","fillField","fillFields","verifyField","diagnostics"];
function valid(adapter){return adapter&&typeof adapter.id==="string"&&required.every(name=>typeof adapter[name]==="function");}
function url(value){try{return value instanceof URL?value:new URL(String(value));}catch{return new URL("https://invalid.local/");}}
export function createAdapterRegistry({exact=[],families=[new GreenhouseAdapter(),new WorkableAdapter(),new LeverAdapter(),new IcimsAdapter()],generic=new GenericHtmlAdapter()}={}){
 const exactAdapters=exact.filter(valid),familyAdapters=families.filter(valid);if(!valid(generic))throw new Error("A valid generic adapter is required.");
 return Object.freeze({select(value){const target=url(value),exactMatch=exactAdapters.find(adapter=>adapter.matches(target));if(exactMatch)return{adapter:exactMatch,...exactMatch.diagnostics(),tier:"EXACT_DOMAIN"};const family=familyAdapters.find(adapter=>adapter.matches(target));if(family)return{adapter:family,...family.diagnostics(),tier:"ATS_FAMILY"};return{adapter:generic,...generic.diagnostics(),tier:"GENERIC"};},all:()=>[...exactAdapters,...familyAdapters,generic]});
}
const defaultRegistry=createAdapterRegistry();
export const selectJobSiteAdapter=value=>defaultRegistry.select(value);
