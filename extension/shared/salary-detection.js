export const SALARY_PERIODS=Object.freeze(["HOUR","DAY","WEEK","MONTH","YEAR","OTHER"]);
const number=value=>{const cleaned=String(value??"").replace(/[$£€,\s]/g,"");if(!cleaned)return null;const parsed=Number(cleaned);return Number.isFinite(parsed)&&parsed>=0?parsed:null;};
const periodFrom=value=>{const text=String(value||"").toLowerCase();if(/hour|hourly|hr\b/.test(text))return "HOUR";if(/day|daily/.test(text))return "DAY";if(/week|weekly/.test(text))return "WEEK";if(/month|monthly/.test(text))return "MONTH";if(/year|yearly|annual|annum/.test(text))return "YEAR";return text?"OTHER":null;};
const currencyFrom=value=>{const text=String(value||"").toUpperCase();if(/\bCAD\b|C\$/.test(text))return "CAD";if(/\bAUD\b|A\$/.test(text))return "AUD";if(/\bGBP\b|£/.test(text))return "GBP";if(/\bEUR\b|€/.test(text))return "EUR";if(/\bUSD\b|\$/.test(text))return "USD";return /^[A-Z]{3}$/.test(text.trim())?text.trim():null;};
export function detectSalary(text="",structured={}){
  const suppliedMin=number(structured.min),suppliedMax=number(structured.max),suppliedText=String(structured.text||"").trim();
  if(suppliedMin!==null||suppliedMax!==null)return {min:suppliedMin,max:suppliedMax??suppliedMin,currency:currencyFrom(structured.currency||suppliedText),period:periodFrom(structured.period||suppliedText),text:suppliedText};
  const source=`${suppliedText}\n${String(text||"")}`;
  const range=source.match(/((?:USD|CAD|AUD|GBP|EUR|US\$|C\$|A\$|[$£€])\s*\d[\d,]*(?:\.\d{1,2})?\s*(?:-|–|—|to)\s*(?:(?:USD|CAD|AUD|GBP|EUR|US\$|C\$|A\$|[$£€])\s*)?\d[\d,]*(?:\.\d{1,2})?\s*(?:hourly|daily|weekly|monthly|annually|yearly|(?:per|a|an|\/)?\s*(?:hour|hr|day|week|month|year|annum))?)/i);
  const exact=range?null:source.match(/((?:USD|CAD|AUD|GBP|EUR|US\$|C\$|A\$|[$£€])\s*\d[\d,]*(?:\.\d{1,2})?\s*(?:hourly|daily|weekly|monthly|annually|yearly|(?:per|a|an|\/)?\s*(?:hour|hr|day|week|month|year|annum)))/i);
  const match=range||exact;if(!match)return {min:null,max:null,currency:null,period:null,text:""};
  const amounts=[...match[1].matchAll(/(?:USD|CAD|AUD|GBP|EUR|US\$|C\$|A\$|[$£€])\s*(\d[\d,]*(?:\.\d{1,2})?)/gi)].map((item)=>number(item[1]));
  return {min:amounts[0]??null,max:amounts[1]??amounts[0]??null,currency:currencyFrom(match[1]),period:periodFrom(match[1]),text:match[1].trim()};
}
