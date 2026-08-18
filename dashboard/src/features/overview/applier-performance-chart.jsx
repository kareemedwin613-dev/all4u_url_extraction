import React,{useMemo,useState}from"react";
import{Card,Empty,Flex,Input,Tag,Typography}from"antd";
import{SearchOutlined}from"@ant-design/icons";
const{Text}=Typography;
const METRICS=[{key:"assigned",label:"Assigned",color:"#8c8c8c"},{key:"active",label:"Active",color:"#1677ff"},{key:"completed",label:"Completed",color:"#52c41a"},{key:"applied",label:"Applied",color:"#722ed1"}];
const count=value=>Math.max(0,Number(value)||0);
export function normalizeApplierPerformance(rows=[]){return(Array.isArray(rows)?rows:[]).map(row=>({id:String(row.id||""),name:String(row.applier_name||row.email||"Unknown Applier"),email:String(row.email||""),assigned:count(row.assigned_count),active:count(row.active_count),completed:count(row.completed_count),applied:count(row.applied_count),completionRate:Math.max(0,Math.min(100,Number(row.completion_rate)||0))}));}
export function ApplierPerformanceChart({rows=[],dateLabel="Today"}){
 const[search,setSearch]=useState(""),data=useMemo(()=>normalizeApplierPerformance(rows),[rows]),needle=search.trim().toLocaleLowerCase(),visible=useMemo(()=>needle?data.filter(item=>`${item.name} ${item.email}`.toLocaleLowerCase().includes(needle)):data,[data,needle]),maximum=Math.max(1,...visible.flatMap(item=>METRICS.map(metric=>item[metric.key])));
 return <Card title="Applier performance" extra={<Text type="secondary">{dateLabel}</Text>} style={{height:"100%"}}>
  <Input allowClear prefix={<SearchOutlined/>} value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search Applier name or email" aria-label="Search Applier performance by name or email" style={{marginBottom:16}}/>
  {!data.length?<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No active Appliers are available."/>:!visible.length?<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No Appliers match this search."/>:<>
   <Flex gap={12} wrap="wrap" style={{marginBottom:16}}>{METRICS.map(metric=><Flex key={metric.key} align="center" gap={6}><span aria-hidden="true" style={{width:12,height:12,borderRadius:2,background:metric.color}}/><Text>{metric.label}</Text></Flex>)}</Flex>
   <div role="img" aria-label="Applier performance graph" style={{display:"grid",gap:18,maxHeight:480,overflowY:"auto",paddingRight:8}}>{visible.map(item=><div key={item.id||item.email}>
    <Flex justify="space-between" align="center" gap={12} wrap="wrap" style={{marginBottom:6}}><div><Text strong>{item.name}</Text>{item.email&&item.email!==item.name?<Text type="secondary" style={{display:"block",fontSize:12}}>{item.email}</Text>:null}</div><Flex gap={6} wrap="wrap"><Tag>{item.assigned} assigned</Tag><Tag color="green">{item.completionRate}% completed</Tag><Tag color="purple">{item.applied} applied</Tag></Flex></Flex>
    <div style={{display:"grid",gap:5}}>{METRICS.map(metric=><Flex key={metric.key} align="center" gap={8}><Text type="secondary" style={{width:82,fontSize:12}}>{metric.label}</Text><div style={{height:14,flex:1,background:"#f0f2f5",borderRadius:7,overflow:"hidden"}}><div title={`${item.name}: ${item[metric.key]} ${metric.label.toLowerCase()}`} style={{height:"100%",width:`${item[metric.key]/maximum*100}%`,minWidth:item[metric.key]?4:0,background:metric.color,borderRadius:7}}/></div><Text style={{width:28,textAlign:"right"}}>{item[metric.key]}</Text></Flex>)}</div>
   </div>)}</div>
  </>}
 </Card>;
}
