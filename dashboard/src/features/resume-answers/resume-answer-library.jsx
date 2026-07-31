import React,{useEffect,useMemo,useState}from"react";
import{Alert,Button,Card,Checkbox,Empty,Flex,Form,Input,InputNumber,Modal,Popconfirm,Select,Space,Spin,Switch,Table,Tag,Typography}from"antd";
import{archiveResumeAnswer,createResumeAnswer,listResumeAnswers,updateResumeAnswer}from"./resume-answer-service.js";
const{Text}=Typography;

export const ANSWER_DEFINITIONS=Object.freeze({
 authorized_to_work:{label:"Authorized to work",type:"BOOLEAN",patterns:["Are you legally authorized to work?"]},
 requires_sponsorship:{label:"Requires sponsorship",type:"BOOLEAN",patterns:["Will you now or in the future require sponsorship?"]},
 willing_to_relocate:{label:"Willing to relocate",type:"BOOLEAN",patterns:["Are you willing to relocate?"]},
 available_start_date:{label:"Available start date",type:"DATE",patterns:["When can you start?"]},
 desired_salary:{label:"Desired salary",type:"TEXT",patterns:["What is your desired salary?"]},
 years_of_experience:{label:"Years of experience",type:"NUMBER",patterns:["How many years of relevant experience do you have?"]},
 remote_work_preference:{label:"Remote-work preference",type:"SINGLE_SELECT",patterns:["What is your preferred work arrangement?"]},
});
const REMOTE_OPTIONS=["REMOTE","HYBRID","ONSITE","FLEXIBLE","NO_PREFERENCE"].map(value=>({value,label:value.replaceAll("_"," ")}));
const defaultValue=type=>type==="BOOLEAN"?true:type==="NUMBER"?0:type==="SINGLE_SELECT"?"NO_PREFERENCE":"";
const showValue=answer=>typeof answer.answerValue==="boolean"?(answer.answerValue?"Yes":"No"):String(answer.answerValue??"").replaceAll("_"," ");
const showDate=value=>value?new Date(value).toLocaleString():"Not recorded";

function ValueEditor({form}){const key=Form.useWatch("answerKey",form),definition=ANSWER_DEFINITIONS[key];if(!definition)return null;if(definition.type==="BOOLEAN")return <Form.Item name="answerValue" label="Answer" rules={[{required:true}]}><Select options={[{value:true,label:"Yes"},{value:false,label:"No"}]}/></Form.Item>;if(definition.type==="NUMBER")return <Form.Item name="answerValue" label="Answer" rules={[{required:true}]}><InputNumber min={0} max={100} precision={1} style={{width:"100%"}}/></Form.Item>;if(definition.type==="DATE")return <Form.Item name="answerValue" label="Answer" rules={[{required:true}]}><Input type="date"/></Form.Item>;if(definition.type==="SINGLE_SELECT")return <Form.Item name="answerValue" label="Answer" rules={[{required:true}]}><Select options={REMOTE_OPTIONS}/></Form.Item>;return <Form.Item name="answerValue" label="Answer" rules={[{required:true,whitespace:true,max:500}]}><Input maxLength={500} placeholder="For example: 120,000 USD annually"/></Form.Item>}

export function ResumeAnswerLibrary({client,apiBaseUrl,resumeId}){
 const[answers,setAnswers]=useState(),[error,setError]=useState(""),[notice,setNotice]=useState(""),[editor,setEditor]=useState(null),[busy,setBusy]=useState(false),[form]=Form.useForm();
 const load=()=>{setError("");listResumeAnswers(client,apiBaseUrl,resumeId).then(setAnswers).catch(value=>setError(value.message));};
 useEffect(load,[client,apiBaseUrl,resumeId]);
 const options=useMemo(()=>Object.entries(ANSWER_DEFINITIONS).map(([value,item])=>({value,label:item.label,disabled:!editor?.item&&answers?.some(answer=>answer.answerKey===value)})),[answers,editor]);
 function open(item=null){const key=item?.answerKey||options.find(option=>!option.disabled)?.value||"authorized_to_work",definition=ANSWER_DEFINITIONS[key];setEditor({item});form.setFieldsValue({answerKey:key,answerValue:item?.answerValue??defaultValue(definition.type),questionPatterns:item?.questionPatterns||definition.patterns,verified:item?.reviewStatus==="VERIFIED",active:item?.active!==false});}
 function keyChanged(key){const definition=ANSWER_DEFINITIONS[key];form.setFieldsValue({answerValue:defaultValue(definition.type),questionPatterns:definition.patterns});}
 async function save(){const values=await form.validateFields(),definition=ANSWER_DEFINITIONS[values.answerKey];setBusy(true);setError("");try{const body={answerKey:values.answerKey,answerType:definition.type,answerValue:values.answerValue,questionPatterns:(values.questionPatterns||[]).map(value=>value.trim()).filter(Boolean),reviewStatus:values.verified?"VERIFIED":"NEEDS_REVIEW",active:values.active!==false},result=editor.item?await updateResumeAnswer(client,apiBaseUrl,resumeId,editor.item.id,body):await createResumeAnswer(client,apiBaseUrl,resumeId,body);setAnswers(result.answers||[]);setEditor(null);setNotice("Resume answer saved. Only active, verified answers are eligible for future screening Autofill.");}catch(value){setError(value.message);}finally{setBusy(false);}}
 async function archive(item){setBusy(true);setError("");try{const result=await archiveResumeAnswer(client,apiBaseUrl,resumeId,item.id);setAnswers(result.answers||[]);setNotice(`${ANSWER_DEFINITIONS[item.answerKey]?.label||item.answerKey} archived.`);}catch(value){setError(value.message);}finally{setBusy(false);}}
 const columns=[
  {title:"Answer",dataIndex:"answerKey",sorter:(a,b)=>a.answerKey.localeCompare(b.answerKey),render:(value,item)=><><Text strong>{ANSWER_DEFINITIONS[value]?.label||value}</Text><br/><Text type="secondary">{showValue(item)}</Text></>},
  {title:"Patterns",dataIndex:"questionPatterns",render:values=><Space wrap>{values?.length?values.map(value=><Tag key={value}>{value}</Tag>):<Text type="secondary">Exact key only</Text>}</Space>},
  {title:"Review",dataIndex:"reviewStatus",sorter:(a,b)=>a.reviewStatus.localeCompare(b.reviewStatus),render:(value,item)=><><Tag color={value==="VERIFIED"?"green":"gold"}>{value.replaceAll("_"," ")}</Tag>{item.reviewerName&&<><br/><Text type="secondary">{item.reviewerName}</Text></>}</>},
  {title:"Audit",dataIndex:"updatedAt",sorter:(a,b)=>String(a.updatedAt).localeCompare(String(b.updatedAt)),render:(value,item)=><><Text>Updated {showDate(value)}</Text><br/><Text type="secondary">Created by {item.creatorName||"Unknown user"} on {showDate(item.createdAt)}</Text></>},
  {title:"Active",dataIndex:"active",sorter:(a,b)=>Number(a.active)-Number(b.active),render:value=><Tag color={value?"blue":"default"}>{value?"ACTIVE":"ARCHIVED"}</Tag>},
  {title:"Actions",key:"actions",render:(_,item)=><Space><Button size="small" onClick={()=>open(item)}>Edit</Button>{item.active&&<Popconfirm title="Archive this answer?" description="It will no longer be eligible for Autofill." onConfirm={()=>archive(item)}><Button size="small" danger>Archive</Button></Popconfirm>}</Space>},
 ];
 if(answers===undefined&&!error)return <Card><Spin/> <Text>Loading Resume answers...</Text></Card>;
 return <Space orientation="vertical" size="middle" style={{width:"100%"}}>
  <Alert type="info" showIcon message="Explicit reviewed answers only" description="Store reusable application answers for this Resume. Never add demographic, disability, veteran, medical, religious, racial, ethnic, gender, sexual-orientation, or criminal-history information."/>
  {error&&<Alert type="error" showIcon closable onClose={()=>setError("")} message="Answer Library error" description={error}/>} {notice&&<Alert type="success" showIcon closable onClose={()=>setNotice("")} message={notice}/>} 
  <Card title="Resume Answer Library" extra={<Button type="primary" onClick={()=>open()} disabled={!options.some(option=>!option.disabled)}>Add answer</Button>}>
   {answers?.length?<Table rowKey="id" columns={columns} dataSource={answers} pagination={{pageSize:10,showSizeChanger:false}} scroll={{x:900}}/>:<Empty description="No reusable answers have been added for this Resume."/>}
  </Card>
  <Modal open={Boolean(editor)} title={`${editor?.item?"Edit":"Add"} Resume answer`} onCancel={()=>setEditor(null)} onOk={save} confirmLoading={busy} destroyOnHidden>
   <Form form={form} layout="vertical"><Form.Item name="answerKey" label="Answer key" rules={[{required:true}]}><Select options={options} onChange={keyChanged} disabled={Boolean(editor?.item)}/></Form.Item><ValueEditor form={form}/><Form.Item name="questionPatterns" label="Approved question wording" extra="Add up to 20 ordinary screening-question phrasings. Sensitive categories are rejected by the API and database."><Select mode="tags" tokenSeparators={[","]} maxCount={20} maxTagCount="responsive"/></Form.Item><Flex gap="large" wrap><Form.Item name="verified" valuePropName="checked"><Checkbox>I reviewed this answer and confirm it is accurate.</Checkbox></Form.Item><Form.Item name="active" valuePropName="checked"><Switch checkedChildren="Active" unCheckedChildren="Archived"/></Form.Item></Flex></Form>
  </Modal>
 </Space>;
}
