import {MIME_TYPES,PAGE_SIZES,SEARCH_MAX,SENIORITIES,STATUSES} from "./constants.js";
export const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid=value=>UUID_RE.test(String(value||""));
export function validateConfig(env={}){const url=String(env.VITE_SUPABASE_URL||"").trim(),key=String(env.VITE_SUPABASE_PUBLISHABLE_KEY||"").trim(),apiValue=String(env.VITE_API_BASE_URL||"").trim();let parsed,api;try{parsed=new URL(url);}catch{}try{if(apiValue)api=new URL(apiValue);}catch{}const errors=[],privilegedMarker=["service","role"].join("_");if(!parsed||parsed.protocol!=="https:"||!parsed.hostname.endsWith(".supabase.co")||parsed.pathname!=="/")errors.push("Set VITE_SUPABASE_URL to a standard HTTPS Supabase project URL.");if(key.length<20||key.toLowerCase().includes(privilegedMarker))errors.push("Set VITE_SUPABASE_PUBLISHABLE_KEY to a publishable or anon browser key.");if(apiValue&&(!api||!(api.protocol==="https:"||api.protocol==="http:"&&["localhost","127.0.0.1"].includes(api.hostname))||api.username||api.password))errors.push("Set VITE_API_BASE_URL to an HTTPS URL, HTTP localhost for development, or leave it blank for the dashboard origin.");return {valid:!errors.length,errors,config:{url:parsed?`${parsed.protocol}//${parsed.hostname}`:"",key,apiBaseUrl:api?api.toString().replace(/\/+$/ ,""):""}};}
export function validateLogin(email,password){const errors={};if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email||"").trim()))errors.email="Enter a valid email address.";if(!String(password||""))errors.password="Enter your password.";return {valid:!Object.keys(errors).length,errors};}
export function normalizeSearch(value){const search=String(value||"").trim().slice(0,SEARCH_MAX);if(/[,%_()"'\\\r\n]/.test(search))throw Object.assign(new Error("Search contains unsupported filter characters."),{code:"INVALID_FILTER"});return search;}
export const allowed=(value,values,fallback="")=>values.includes(value)?value:fallback;
export function normalizePage(value){const n=Number.parseInt(value,10);return Number.isInteger(n)&&n>=1?n:1;}
export const normalizePageSize=value=>allowed(Number(value),PAGE_SIZES,25);
export const normalizeStatus=value=>allowed(value,STATUSES,"");
export const normalizeSeniority=value=>allowed(value,SENIORITIES,"");
export const normalizeMime=value=>allowed(value,MIME_TYPES,"");
