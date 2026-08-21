import React,{useMemo,useState}from"react";
import{Card,Empty,Flex,Input,Tag,Typography}from"antd";
import{SearchOutlined}from"@ant-design/icons";
const{Text}=Typography;
const METRICS=[{key:"captured",label:"Captured",color:"#8c8c8c"},{key:"approved",label:"Approved",color:"#52c41a"},{key:"needsReview",label:"Needs Review",color:"#faad14"},{key:"needsCorrection",label:"Correction",color:"#fa8c16"},{key:"declined",label:"Declined",color:"#ff4d4f"}];
const count=value=>Math.max(0,Number(value)||0);
export function normalizeJdFinderPerformance(rows=[]){return(Array.isArray(rows)?rows:[]).map(row=>({id:String(row.id||""),name:String(row.finder_name||row.email||"Unknown JD Finder"),email:String(row.email||""),captured:count(row.captured_count),approved:count(row.approved_count),needsReview:count(row.needs_review_count),needsCorrection:count(row.needs_correction_count),declined:count(row.declined_count),approvalRate:Math.max(0,Math.min(100,Number(row.approval_rate)||0))}));}
export function JdFinderPerformanceChart({rows=[],dateLabel="Today"}){
 const[search,setSearch]=useState(""),data=useMemo(()=>normalizeJdFinderPerformance(rows),[rows]),needle=search.trim().toLocaleLowerCase(),visible=useMemo(()=>needle?data.filter(item=>`${item.name} ${item.email}`.toLocaleLowerCase().includes(needle)):data,[data,needle]),maximum=Math.max(1,...visible.flatMap(item=>METRICS.map(metric=>item[metric.key])));
 return <Card title="JD Finder performance" extra={<Text type="secondary">{dateLabel}</Text>} style={{height:"100%"}}>
  <Input allowClear prefix={<SearchOutlined/>} value={search} onChange={event=>setSearch(event.target.value)} placeholder="Search JD Finder name or email" aria-label="Search JD Finder performance by name or email" style={{marginBottom:16}}/>
  {!data.length?<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No active JD Finders are available."/>:!visible.length?<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No JD Finders match this search."/>:<>
   <Flex gap={12} wrap="wrap" style={{marginBottom:16}}>{METRICS.map(metric=><Flex key={metric.key} align="center" gap={6}><span aria-hidden="true" style={{width:12,height:12,borderRadius:2,background:metric.color}}/><Text>{metric.label}</Text></Flex>)}</Flex>
   <div role="img" aria-label="JD Finder performance graph" style={{display:"grid",gap:18,maxHeight:480,overflowY:"auto",paddingRight:8}}>{visible.map(item=><div key={item.id||item.email}>
    <Flex justify="space-between" align="center" gap={12} wrap="wrap" style={{marginBottom:6}}><div><Text strong>{item.name}</Text>{item.email&&item.email!==item.name?<Text type="secondary" style={{display:"block",fontSize:12}}>{item.email}</Text>:null}</div><Flex gap={6} wrap="wrap"><Tag>{item.captured} captured</Tag><Tag color="green">{item.approvalRate}% approved</Tag><Tag color="gold">{item.needsReview} pending</Tag></Flex></Flex>
    <div style={{display:"grid",gap:5}}>{METRICS.map(metric=><Flex key={metric.key} align="center" gap={8}><Text type="secondary" style={{width:92,fontSize:12}}>{metric.label}</Text><div style={{height:14,flex:1,background:"#f0f2f5",borderRadius:7,overflow:"hidden"}}><div title={`${item.name}: ${item[metric.key]} ${metric.label.toLowerCase()}`} style={{height:"100%",width:`${item[metric.key]/maximum*100}%`,minWidth:item[metric.key]?4:0,background:metric.color,borderRadius:7}}/></div><Text style={{width:28,textAlign:"right"}}>{item[metric.key]}</Text></Flex>)}</div>
   </div>)}</div>
  </>}
 </Card>;
}
