import React,{useEffect,useMemo,useState}from"react";
import{Alert,Button,Card,Col,Collapse,Form,Input,InputNumber,Row,Select,Space,Spin,Switch,Typography}from"antd";
import{listResumeAnswers,saveResumeAnswers}from"./resume-answer-service.js";
const{Text}=Typography;

export const ANSWER_DEFINITIONS=Object.freeze({
 authorized_to_work:{label:"Authorized To Work",type:"BOOLEAN",patterns:["Are you legally authorized to work?","Are you eligible to work in the United States?"]},
 requires_sponsorship:{label:"Requires Sponsorship",type:"BOOLEAN",patterns:["Will you now or in the future require sponsorship?","Will you require visa sponsorship?"]},
 willing_to_relocate:{label:"Willing To Relocate",type:"BOOLEAN",patterns:["Are you willing to relocate?"]},
 available_start_date:{label:"Available Start Date",type:"DATE",patterns:["When can you start?","What is your available start date?"]},
 desired_salary:{label:"Fallback Desired Salary",type:"TEXT",patterns:["What is your desired salary?","What are your salary expectations?"],help:"Used only when the JD has no complete numeric salary range. The extension otherwise recommends the JD midpoint."},
 years_of_experience:{label:"Years Of Experience",type:"NUMBER",patterns:["How many years of relevant experience do you have?","How many years of experience do you have?"]},
 remote_work_preference:{label:"Remote-Work Preference",type:"SINGLE_SELECT",patterns:["What is your preferred work arrangement?","What is your remote work preference?"]},
 gender_identity:{label:"Gender Identity (Voluntary)",type:"TEXT",patterns:["Gender","What is your gender?","I identify my gender as"],help:"Sensitive voluntary self-identification. Stored only when you configure and verify it; always reviewed again before autofill."},
 race_ethnicity:{label:"Race / Ethnicity (Voluntary)",type:"TEXT",patterns:["Race","Race and ethnicity","What is your race and ethnicity?"],help:"Sensitive voluntary self-identification. Use the exact option wording you normally select; always reviewed again before autofill."},
 veteran_status:{label:"Veteran Status (Voluntary)",type:"TEXT",patterns:["Veteran Status","Are you a military veteran?"],help:"Sensitive voluntary self-identification. Use the exact option wording you normally select; always reviewed again before autofill."},
});
const REMOTE_OPTIONS=["REMOTE","HYBRID","ONSITE","FLEXIBLE","NO_PREFERENCE"].map(value=>({value,label:value.replaceAll("_"," ")}));
const configured=value=>value!==undefined&&value!==null&&String(value).trim()!=="";

function ManualValueEditor({answerKey,definition}){
 const name=["answers",answerKey,"answerValue"];
 if(definition.type==="BOOLEAN")return <Form.Item name={name} label="Manual Answer"><Select allowClear placeholder="Not configured" options={[{value:true,label:"Yes"},{value:false,label:"No"}]}/></Form.Item>;
 if(definition.type==="NUMBER")return <Form.Item name={name} label="Manual Answer"><InputNumber min={0} max={100} precision={1} placeholder="Not configured" style={{width:"100%"}}/></Form.Item>;
 if(definition.type==="DATE")return <Form.Item name={name} label="Manual Answer"><Input type="date"/></Form.Item>;
 if(definition.type==="SINGLE_SELECT")return <Form.Item name={name} label="Manual Answer"><Select allowClear placeholder="Not configured" options={REMOTE_OPTIONS}/></Form.Item>;
 return <Form.Item name={name} label="Manual Answer"><Input maxLength={500} placeholder="Not configured; for example 120000"/></Form.Item>;
}

function formState(items){
 const existing=new Map((items||[]).map(item=>[item.answerKey,item]));
 return{answers:Object.fromEntries(Object.entries(ANSWER_DEFINITIONS).map(([key,definition])=>{
  const item=existing.get(key);
  return[key,{answerValue:item?.answerValue,active:item?.active!==false,questionPatterns:item?.questionPatterns?.length?item.questionPatterns:definition.patterns}];
 }))};
}

export function ResumeAnswerLibrary({client,apiBaseUrl,resumeId}){
 const[answers,setAnswers]=useState(),[error,setError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false),[form]=Form.useForm();
 const definitions=useMemo(()=>Object.entries(ANSWER_DEFINITIONS),[]);
 useEffect(()=>{let live=true;setError("");listResumeAnswers(client,apiBaseUrl,resumeId).then(items=>{if(!live)return;setAnswers(items);form.setFieldsValue(formState(items));}).catch(value=>live&&setError(value.message));return()=>{live=false};},[client,apiBaseUrl,resumeId,form]);
 async function saveAll(){
  const values=await form.validateFields(),payload=[];
  for(const[key,definition]of definitions){const row=values.answers?.[key]||{};if(!configured(row.answerValue))continue;payload.push({answerKey:key,answerType:definition.type,answerValue:row.answerValue,questionPatterns:(row.questionPatterns||definition.patterns).map(value=>String(value).trim()).filter(Boolean),reviewStatus:"VERIFIED",active:row.active!==false});}
  if(!payload.length){setError("Configure at least one manual answer before saving.");return;}
  setBusy(true);setError("");setNotice("");
  try{const result=await saveResumeAnswers(client,apiBaseUrl,resumeId,payload);setAnswers(result);form.setFieldsValue(formState(result));setNotice(`${payload.length} configured answer${payload.length===1?"":"s"} saved and enabled for Autofill in one request.`);}catch(value){setError(value.message);}finally{setBusy(false);}
 }
 if(answers===undefined&&!error)return <Card><Spin/> <Text>Loading Resume answers...</Text></Card>;
 return <Space orientation="vertical" size="middle" style={{width:"100%"}}>
  <Alert type="info" showIcon message="Manual setup — no guessed defaults" description="Configure reusable answers here and save them together. Blank answers are ignored. Saved active answers are used automatically when matching fields are detected."/>
  {error&&<Alert type="error" showIcon closable onClose={()=>setError("")} message="Answer Library error" description={error}/>} {notice&&<Alert type="success" showIcon closable onClose={()=>setNotice("")} message={notice}/>} 
  <Form form={form} layout="vertical" initialValues={formState([])}>
   <Row gutter={[16,16]}>
    {definitions.map(([key,definition])=><Col xs={24} lg={12} key={key}>
     <Card size="small" title={definition.label} style={{height:"100%"}}>
      {definition.help&&<Text type="secondary" style={{display:"block",marginBottom:12}}>{definition.help}</Text>}
      <ManualValueEditor answerKey={key} definition={definition}/>
      <Form.Item name={["answers",key,"active"]} valuePropName="checked" noStyle><Switch checkedChildren="Active" unCheckedChildren="Archived"/></Form.Item>
      <Collapse ghost size="small" style={{marginTop:8}} items={[{key:"patterns",label:"Question Wording",children:<Form.Item name={["answers",key,"questionPatterns"]} extra="Paste unresolved ordinary question wording copied from the extension. Do not add legal attestations or unrelated sensitive questions."><Select mode="tags" tokenSeparators={[","]} maxCount={20} maxTagCount="responsive"/></Form.Item>}]}/>
     </Card>
    </Col>)}
   </Row>
   <Button type="primary" loading={busy} onClick={saveAll} style={{marginTop:16}}>Save configured answers</Button>
  </Form>
 </Space>;
}
