import React,{useEffect,useState}from"react";
import{Button,Card,Flex,Input,Select,Typography}from"antd";
import{DEFAULT_OVERVIEW_WINDOW,formatOverviewRangeLabel,OVERVIEW_WINDOWS}from"./overview-date.js";
const{Text}=Typography;
export function OverviewDateFilter({value,onChange,compact=false}){
  const[mode,setMode]=useState(value.window),[from,setFrom]=useState(value.from||""),[to,setTo]=useState(value.to||"");
  useEffect(()=>{setMode(value.window);setFrom(value.from||"");setTo(value.to||"");},[value.window,value.from,value.to]);
  const invalid=mode==="CUSTOM"&&(!from||!to||from>to);
  const select=next=>{setMode(next);if(next!=="CUSTOM"){const option=OVERVIEW_WINDOWS.find(item=>item.value===next);onChange({window:next,from:"",to:"",label:option.label});}};
  const labelClass=compact?"overview-header-filter-label":"";
  const labelStyle={display:"block",marginBottom:compact?2:4,lineHeight:1.5715};
  const controls=<Flex gap={8} wrap="wrap" align="center" className={compact?"overview-header-filter":""}>
    <label>
      <Text type="secondary" className={labelClass} style={labelStyle}>Reporting Period</Text>
      <Select aria-label="Overview Time Window" value={mode} style={{width:compact?145:170}} options={OVERVIEW_WINDOWS} onChange={select}/>
    </label>
    {mode==="CUSTOM"?<>
      <label>
        <Text type="secondary" className={labelClass} style={labelStyle}>From</Text>
        <Input aria-label="Overview Date From" type="date" value={from} onChange={event=>setFrom(event.target.value)}/>
      </label>
      <label>
        <Text type="secondary" className={labelClass} style={labelStyle}>Through</Text>
        <Input aria-label="Overview Date Through" type="date" value={to} onChange={event=>setTo(event.target.value)}/>
      </label>
      <div className="overview-date-filter-action">
        <Text type="secondary" className={labelClass} style={labelStyle} aria-hidden="true">&nbsp;</Text>
        <Button type="primary" disabled={invalid} onClick={()=>onChange({window:"CUSTOM",from,to,label:formatOverviewRangeLabel(from,to)})}>Apply</Button>
      </div>
    </>:null}
    {value.window!=="TODAY"&&<Button onClick={()=>onChange(DEFAULT_OVERVIEW_WINDOW)}>Reset</Button>}
    {!compact?<Text type="secondary">Summary cards: {value.label}</Text>:null}
  </Flex>;
  return compact?controls:<Card size="small" title="Reporting Period" style={{marginBottom:16}}>{controls}</Card>;
}
