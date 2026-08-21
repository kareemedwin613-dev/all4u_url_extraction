export const OVERVIEW_WINDOWS=[{value:"TODAY",label:"Today"},{value:"THIS_WEEK",label:"This week"},{value:"THIS_MONTH",label:"This month"},{value:"CUSTOM",label:"Custom range"}];
export const DEFAULT_OVERVIEW_WINDOW=Object.freeze({window:"TODAY",from:"",to:"",label:"Today"});
const midnight=value=>new Date(value.getFullYear(),value.getMonth(),value.getDate());
const MONTHS=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/** Format YYYY-MM-DD as "Jul 29, 2026". */
export function formatOverviewDate(value){
  const match=String(value||"").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!match)return String(value||"");
  const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
  if(!month||month>12||!day||day>31)return String(value);
  return `${MONTHS[month-1]} ${day}, ${year}`;
}

/** Format a custom inclusive range as "Jul 29, 2026 - Aug 11, 2026". */
export function formatOverviewRangeLabel(from,to){
  return `${formatOverviewDate(from)} - ${formatOverviewDate(to)}`;
}

export function overviewDateBounds(value=DEFAULT_OVERVIEW_WINDOW,now=new Date()){
  let from,to;
  if(value.window==="TODAY"){from=midnight(now);to=new Date(from);to.setDate(to.getDate()+1);}
  else if(value.window==="THIS_WEEK"){from=midnight(now);from.setDate(from.getDate()-((from.getDay()+6)%7));to=new Date(from);to.setDate(to.getDate()+7);}
  else if(value.window==="THIS_MONTH"){from=new Date(now.getFullYear(),now.getMonth(),1);to=new Date(now.getFullYear(),now.getMonth()+1,1);}
  else if(value.window==="CUSTOM"&&value.from&&value.to){const[a,b,c]=value.from.split("-").map(Number),[x,y,z]=value.to.split("-").map(Number);from=new Date(a,b-1,c);to=new Date(x,y-1,z);to.setDate(to.getDate()+1);}
  return from&&to?{from:from.toISOString(),to:to.toISOString()}:null;
}
