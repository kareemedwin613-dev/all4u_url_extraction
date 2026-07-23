const dateFormatter=new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"short"});
export function formatDate(value){if(!value)return "Not available";const d=new Date(value);return Number.isNaN(d.valueOf())?"Not available":dateFormatter.format(d);}
export function formatBytes(value){const n=Number(value);if(!Number.isFinite(n)||n<0)return "Not available";if(n<1024)return `${n} B`;if(n<1048576)return `${Math.round(n/1024)} KB`;return `${(n/1048576).toFixed(n<10485760?1:0)} MB`;}
export const formatMime=value=>({"application/pdf":"PDF","application/vnd.openxmlformats-officedocument.wordprocessingml.document":"DOCX","text/plain":"TXT"})[value]||"Other";
export function formatLabel(value){if(!value)return "Not specified";return String(value).toLowerCase().split("_").map(x=>x.charAt(0).toUpperCase()+x.slice(1)).join(" ");}
export const cleanTags=values=>Array.isArray(values)?values.filter(x=>x!=null).map(x=>String(x).trim()).filter(Boolean):[];
