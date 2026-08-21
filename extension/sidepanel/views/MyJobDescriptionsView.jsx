import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Col, Empty, Flex, Form, Input, Modal, Row, Select, Space, Tag, Typography } from "antd";
import { EditOutlined, ExportOutlined, LeftOutlined, ReloadOutlined, RightOutlined } from "@ant-design/icons";
import { getJobReview, listJobReviews, updateOwnJob } from "../../services/job-review-service.js";

const { Text, Title } = Typography;
const REVIEW_OPTIONS=[
  {value:"ALL",label:"All Statuses"},{value:"NEEDS_REVIEW",label:"Needs Review"},
  {value:"NEEDS_CORRECTION",label:"Needs Correction"},{value:"APPROVED",label:"Approved"},{value:"DECLINED",label:"Declined"},
];
const SENIORITIES=["INTERN","ENTRY","JUNIOR","MID","SENIOR","LEAD","PRINCIPAL","MANAGER","DIRECTOR","EXECUTIVE","UNSPECIFIED"];
const label=value=>String(value||"Not specified").toLowerCase().split("_").map(item=>item.charAt(0).toUpperCase()+item.slice(1)).join(" ");

function dateRange(value){
  if(value==="ALL")return{};const now=new Date(),from=new Date(now);
  if(value==="TODAY")from.setHours(0,0,0,0);
  if(value==="WEEK"){from.setDate(from.getDate()-((from.getDay()+6)%7));from.setHours(0,0,0,0);}
  if(value==="MONTH"){from.setDate(1);from.setHours(0,0,0,0);}
  return{capturedFrom:from.toISOString(),capturedTo:new Date(now.getTime()+1000).toISOString()};
}
async function openPosting(url){const parsed=new URL(url);if(!/^https?:$/.test(parsed.protocol))throw new Error("The job posting URL is invalid.");const[active]=await chrome.tabs.query({active:true,currentWindow:true});if(active?.id)await chrome.tabs.update(active.id,{url:parsed.toString(),active:true});else await chrome.tabs.create({url:parsed.toString(),active:true});}

export function MyJobDescriptionsView({client,backendBaseUrl,categories,onStatus,onError}){
  const[form]=Form.useForm();
  const[items,setItems]=useState([]),[total,setTotal]=useState(0),[index,setIndex]=useState(0),[busy,setBusy]=useState(false);
  const[reviewStatus,setReviewStatus]=useState("ALL"),[timeWindow,setTimeWindow]=useState("ALL"),[editing,setEditing]=useState(null),[editBusy,setEditBusy]=useState(false),[categoryId,setCategoryId]=useState("");
  const filters=useMemo(()=>({reviewStatus,...dateRange(timeWindow)}),[reviewStatus,timeWindow]);
  const load=useCallback(async()=>{setBusy(true);try{const result=await listJobReviews(client,backendBaseUrl,filters);setItems(result?.items||[]);setTotal(Number(result?.total)||0);setIndex(0);}catch(error){onError(error);}finally{setBusy(false);}},[client,backendBaseUrl,filters,onError]);
  useEffect(()=>{load();},[load]);
  const current=items[index]||null;
  const primary=useMemo(()=>categories.filter(item=>!item.parent_id),[categories]);
  const children=useMemo(()=>categories.filter(item=>item.parent_id===categoryId),[categories,categoryId]);
  const editable=current&&["NEEDS_REVIEW","NEEDS_CORRECTION"].includes(current.review_status);

  async function beginEdit(){if(!current||!editable)return;setEditBusy(true);try{const detail=await getJobReview(client,backendBaseUrl,current.id);setEditing(detail);setCategoryId(detail.category_id);form.setFieldsValue({company:detail.company,jobTitle:detail.job_title,categoryId:detail.category_id,subcategoryId:detail.subcategory_id||undefined,seniority:detail.seniority||"UNSPECIFIED",locationText:detail.location_text||"",workArrangement:detail.work_arrangement||"UNSPECIFIED",sourceUrl:detail.source_url,salaryText:detail.salary_text||"",detectedSkills:(detail.detected_skills||[]).join(", "),descriptionText:detail.description_text});}catch(error){onError(error);}finally{setEditBusy(false);}}
  async function save(){try{const values=await form.validateFields();setEditBusy(true);const updated=await updateOwnJob(client,backendBaseUrl,editing.id,{...values,subcategoryId:values.subcategoryId||null,locationText:values.locationText||null,detectedSkills:String(values.detectedSkills||"").split(",").map(value=>value.trim()).filter(Boolean),clearanceRequirements:editing.clearance_requirements||[],travelRequired:editing.travel_required,travelDetails:editing.travel_details,salaryMin:editing.salary_min,salaryMax:editing.salary_max,salaryCurrency:editing.salary_currency,salaryPeriod:editing.salary_period,salaryText:values.salaryText||null});setItems(list=>list.map(item=>item.id===updated.id?{...item,...updated}:item));setEditing(null);onStatus({kind:"success",message:updated.review_status==="NEEDS_CORRECTION"?"Correction saved. A manager can now review the updated JD.":"JD changes saved while it waits for review."});}catch(error){if(!error?.errorFields)onError(error);}finally{setEditBusy(false);}}

  return <Space orientation="vertical" size={12} style={{width:"100%"}}>
    <div><Title level={4} style={{marginBottom:0}}>My JDs</Title><Text type="secondary">Track the JDs you found and correct pending records.</Text></div>
    <Card size="small"><Flex gap={8}><Select aria-label="My JD status" value={reviewStatus} onChange={setReviewStatus} options={REVIEW_OPTIONS} style={{flex:1}}/><Select aria-label="My JD time" value={timeWindow} onChange={setTimeWindow} options={[{value:"TODAY",label:"Today"},{value:"WEEK",label:"This week"},{value:"MONTH",label:"This month"},{value:"ALL",label:"Any time"}]} style={{flex:1}}/><Button icon={<ReloadOutlined/>} onClick={load} loading={busy}/></Flex></Card>
    <Alert type="info" showIcon message={`${total} JD${total===1?"":"s"} found by you match this view`}/>
    {!current?<Card loading={busy}><Empty description="No JDs match these filters"/></Card>:<Card loading={busy} title={`${current.company} — ${current.job_title}`} extra={<Tag color={current.review_status==="APPROVED"?"green":current.review_status==="DECLINED"?"red":current.review_status==="NEEDS_CORRECTION"?"orange":"blue"}>{label(current.review_status)}</Tag>}>
      <Space orientation="vertical" size={9} style={{width:"100%"}}>
        <Flex gap={6} wrap="wrap"><Tag color="blue">{current.category_name||"Uncategorized"}</Tag><Text>{current.location_text||"Location not specified"}</Text></Flex>
        <Text type="secondary">Captured {new Date(current.created_at).toLocaleString()}</Text>
        {current.review_comment&&<Alert type={current.review_status==="NEEDS_CORRECTION"?"warning":"info"} showIcon message="Reviewer comment" description={current.review_comment}/>} 
        {current.review_decline_reason&&<Text type="danger">Reason: {label(current.review_decline_reason)}</Text>}
        <Button block icon={<ExportOutlined/>} onClick={()=>openPosting(current.source_url).catch(onError)}>Open job posting</Button>
        {editable?<Button block type="primary" icon={<EditOutlined/>} loading={editBusy} onClick={beginEdit}>Edit this JD</Button>:<Alert type="success" showIcon message={current.review_status==="APPROVED"?"Approved JDs are locked.":"Declined JDs are retained as read-only history."}/>} 
        <Flex justify="space-between" align="center"><Button icon={<LeftOutlined/>} disabled={index===0} onClick={()=>setIndex(value=>value-1)}>Previous</Button><Text>{index+1} of {items.length}</Text><Button icon={<RightOutlined/>} disabled={index>=items.length-1} onClick={()=>setIndex(value=>value+1)}>Next</Button></Flex>
      </Space>
    </Card>}
    <Modal open={!!editing} title="Edit my JD" width="calc(100vw - 24px)" okText="Save changes" confirmLoading={editBusy} onOk={save} onCancel={()=>!editBusy&&setEditing(null)}>
      <Alert type="info" showIcon message="Your review status and the manager's comment will not be changed." style={{marginBottom:12}}/>
      <Form form={form} layout="vertical"><Row gutter={8}>
        <Col span={12}><Form.Item name="company" label="Company" rules={[{required:true},{max:200}]}><Input/></Form.Item></Col><Col span={12}><Form.Item name="jobTitle" label="Job title" rules={[{required:true},{max:200}]}><Input/></Form.Item></Col>
        <Col span={12}><Form.Item name="categoryId" label="Primary category" rules={[{required:true}]}><Select options={primary.map(item=>({value:item.id,label:item.name}))} onChange={value=>{setCategoryId(value);form.setFieldValue("subcategoryId",undefined);}}/></Form.Item></Col><Col span={12}><Form.Item name="subcategoryId" label="Subcategory"><Select allowClear options={children.map(item=>({value:item.id,label:item.name}))}/></Form.Item></Col>
        <Col span={12}><Form.Item name="seniority" label="Seniority"><Select options={SENIORITIES.map(value=>({value,label:label(value)}))}/></Form.Item></Col><Col span={12}><Form.Item name="workArrangement" label="Work arrangement"><Select options={["REMOTE","HYBRID","ONSITE","UNSPECIFIED"].map(value=>({value,label:label(value)}))}/></Form.Item></Col>
      </Row><Form.Item name="locationText" label="Location"><Input maxLength={300}/></Form.Item><Form.Item name="salaryText" label="Salary text"><Input maxLength={500}/></Form.Item><Form.Item name="sourceUrl" label="Job posting URL" rules={[{required:true},{type:"url"},{max:4000}]}><Input/></Form.Item><Form.Item name="detectedSkills" label="Technical skills (comma-separated)"><Input.TextArea autoSize={{minRows:2,maxRows:4}}/></Form.Item><Form.Item name="descriptionText" label="Job description" rules={[{required:true},{min:100},{max:200000}]}><Input.TextArea rows={9}/></Form.Item></Form>
    </Modal>
  </Space>;
}
