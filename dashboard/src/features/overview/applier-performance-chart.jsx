import React,{useState}from"react";
import{Card,Empty,Flex,Segmented,Tag,Typography}from"antd";
const{Text}=Typography;
const BASE_METRICS=[
 {key:"assigned_count",label:"Assigned",color:"#8c8c8c"},
 {key:"active_count",label:"Active",color:"#1677ff"},
 {key:"completed_count",label:"Completed",color:"#52c41a"},
];
export const PERFORMANCE_WINDOWS={
 today:{label:"Today",field:"applied_today"},
 threeDays:{label:"Last 3 Days",field:"applied_last_3_days"},
 week:{label:"This Week",field:"applied_this_week"},
 month:{label:"This Month",field:"applied_this_month"},
};
const count=value=>Math.max(0,Number(value)||0);
export function normalizeApplierPerformance(rows=[]){return(Array.isArray(rows)?rows:[]).map(row=>({id:String(row.id||""),name:String(row.applier_name||row.email||"Unknown Applier"),email:String(row.email||""),assigned:count(row.assigned_count),active:count(row.active_count),completed:count(row.completed_count),applied:count(row.applied_count),appliedToday:count(row.applied_today),appliedLast3Days:count(row.applied_last_3_days),appliedThisWeek:count(row.applied_this_week),appliedThisMonth:count(row.applied_this_month),completionRate:Math.max(0,Math.min(100,Number(row.completion_rate)||0)),raw:row}));}
const appliedForWindow=(item,window)=>window==="today"?item.appliedToday:window==="threeDays"?item.appliedLast3Days:window==="week"?item.appliedThisWeek:item.appliedThisMonth;
export function ApplierPerformanceChart({rows=[]}){
 const[window,setWindow]=useState("week"),windowLabel=PERFORMANCE_WINDOWS[window].label;
 const data=normalizeApplierPerformance(rows),metrics=[...BASE_METRICS,{key:"window_applied",label:`Applied · ${windowLabel}`,color:"#722ed1"}],maximum=Math.max(1,...data.flatMap(item=>[item.assigned,item.active,item.completed,appliedForWindow(item,window)]));
 return <Card title="Applier performance" extra={<a href="#/applier-workloads">View workloads</a>}>
  {!data.length?<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No active Appliers are available."/>:<>
   <Flex justify="space-between" align="center" gap={12} wrap="wrap" style={{marginBottom:16}}><Flex gap={16} wrap="wrap">{metrics.map(metric=><Flex key={metric.key} align="center" gap={6}><span aria-hidden="true" style={{width:12,height:12,borderRadius:2,background:metric.color}}/><Text>{metric.label}</Text></Flex>)}</Flex><Segmented aria-label="Applied reporting window" value={window} onChange={setWindow} options={Object.entries(PERFORMANCE_WINDOWS).map(([value,option])=>({value,label:option.label}))}/></Flex>
   <div role="img" aria-label="Applier performance graph" style={{display:"grid",gap:18,maxHeight:480,overflowY:"auto",paddingRight:8}}>{data.map(item=><div key={item.id||item.email}>
    <Flex justify="space-between" align="center" gap={12} wrap="wrap" style={{marginBottom:6}}><div><Text strong>{item.name}</Text>{item.email&&item.email!==item.name?<Text type="secondary" style={{display:"block",fontSize:12}}>{item.email}</Text>:null}</div><Flex gap={6} wrap="wrap"><Tag>{item.assigned} assigned</Tag><Tag color="green">{item.completionRate}% completed</Tag><Tag color="purple">{appliedForWindow(item,window)} applied · {windowLabel.toLowerCase()}</Tag></Flex></Flex>
    <div style={{display:"grid",gap:5}}>{metrics.map(metric=>{const value=metric.key==="assigned_count"?item.assigned:metric.key==="active_count"?item.active:metric.key==="completed_count"?item.completed:appliedForWindow(item,window);return <Flex key={metric.key} align="center" gap={8}><Text type="secondary" style={{width:112,fontSize:12}}>{metric.label}</Text><div style={{height:14,flex:1,background:"#f0f2f5",borderRadius:7,overflow:"hidden"}}><div title={`${item.name}: ${value} ${metric.label.toLowerCase()}`} style={{height:"100%",width:`${value/maximum*100}%`,minWidth:value?4:0,background:metric.color,borderRadius:7}}/></div><Text style={{width:28,textAlign:"right"}}>{value}</Text></Flex>;})}</div>
   </div>)}</div>
  </>}
 </Card>;
}
