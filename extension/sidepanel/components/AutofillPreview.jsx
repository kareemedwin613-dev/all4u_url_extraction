import React from "react";
import { Alert, Button, Card, Collapse, Flex,Input,InputNumber,Select, Space, Tag, Typography } from "antd";
import { autofillValue,autofillValueSource, displayAutofillValue } from "../../autofill/autofill-context.js";

const { Text } = Typography;
const LABELS = {
  "candidate.firstName": "First name", "candidate.middleName": "Middle name", "candidate.lastName": "Last name",
  "candidate.fullName": "Full name", "candidate.email": "Email", "candidate.phone": "Phone",
  "candidate.addressLine1": "Address line 1", "candidate.addressLine2": "Address line 2", "candidate.city": "City",
  "candidate.state": "State / region", "candidate.postalCode": "Postal code", "candidate.country": "Country",
  "candidate.linkedInUrl": "LinkedIn", "candidate.githubUrl": "GitHub", "candidate.portfolioUrl": "Portfolio",
  "candidate.summary": "Summary",
  "candidate.currentLocation": "Current location", "candidate.currentCompany": "Current company",
  "screening.authorized_to_work": "Authorized to work",
  "screening.requires_sponsorship": "Requires sponsorship",
  "screening.willing_to_relocate": "Willing to relocate",
  "screening.available_start_date": "Available start date",
  "screening.desired_salary": "Desired salary",
  "screening.years_of_experience": "Years of experience",
  "screening.remote_work_preference": "Remote-work preference",
  "screening.gender_identity": "Gender identity (voluntary)",
  "screening.race_ethnicity": "Race / ethnicity (voluntary)",
  "screening.veteran_status": "Veteran status (voluntary)",
};
const RESULT_MESSAGES = {
  FIELD_VERIFICATION_FAILED: "The page changed or reformatted this value. Review it manually.",
  FIELD_NO_LONGER_AVAILABLE: "This field changed after the preview. Start Autofill again.",
  VALUE_UNAVAILABLE: "No verified Resume value is available.",
  SELECT_OPTION_NOT_FOUND: "The page does not offer a matching option.",
  FIELD_FILL_FAILED: "The page prevented this field from being filled.",
};

const REMOTE_OPTIONS=["REMOTE","HYBRID","ONSITE","FLEXIBLE","NO_PREFERENCE"].map(value=>({value,label:value.replaceAll("_"," ")}));
function ScreeningEditor({field,value,onChange}){if(field.answerType==="BOOLEAN")return <Select size="small" value={value} onChange={onChange} options={[{value:true,label:"Yes"},{value:false,label:"No"}]} style={{width:"100%"}}/>;if(field.answerType==="NUMBER")return <InputNumber size="small" min={0} max={100} value={value} onChange={onChange} style={{width:"100%"}}/>;if(field.answerType==="DATE")return <Input size="small" type="date" value={value} onChange={event=>onChange(event.target.value)}/>;if(field.answerType==="SINGLE_SELECT")return <Select size="small" value={value} onChange={onChange} options={REMOTE_OPTIONS} style={{width:"100%"}}/>;return <Input size="small" value={value} maxLength={500} onChange={event=>onChange(event.target.value)}/>;}

export function AutofillPreview({ active, busy, onValueChange, onFill, onRescan }) {
  const fields = active.autofillFields || [], results = active.autofillResults || [];
  const unresolved=active.unresolvedAutofillQuestions||[];
  const screeningFields=fields.filter(field=>String(field.key||"").startsWith("screening."));
  const approvedAnswers=active.autofillContext?.applicationAnswers || [];
  const guideEntries=active.autofillContext?.guideEntries || [];
  const guideHelp=(id)=>guideEntries.find(entry=>entry.id===id)?.howToAnswer||"";
  const resultById = new Map(results.map((result) => [result.fieldId, result]));
  const retryAvailable=fields.some(field=>resultById.get(field.fieldId)?.status!=="VERIFIED");
  return (
    <Card size="small" title="Autofill Results" style={{ marginBottom: 12 }}>
      {active.autofillAdapter&&<Text type="secondary" style={{display:"block",marginBottom:8}}>Adapter: {active.autofillAdapter.label} v{active.autofillAdapter.version} · {active.autofillAdapter.tier.replaceAll("_"," ").toLowerCase()}</Text>}
      <Alert type="info" showIcon message="Detected fields were filled automatically" description="The extension fills every supported field it can verify and never submits the application. Complete unsupported fields manually." style={{ marginBottom: 10 }} />
      {!approvedAnswers.length&&!guideEntries.length&&<Alert type="warning" showIcon message="No standard answers are available" description="Publish Application Guide answers or verify this Resume's Answer Library in the dashboard, then start Autofill again." style={{marginBottom:10}}/>}
      {approvedAnswers.length>0&&!guideEntries.length&&!screeningFields.length&&<Alert type="warning" showIcon message="No approved standard question matched this page" description="Personal fields can still be filled. Review the remaining questions manually." style={{marginBottom:10}}/>}
      {!fields.length ? <Text type="secondary">No supported personal, contact, or approved screening fields were found on this page.</Text> : (
        <Space orientation="vertical" size={8} style={{ width: "100%" }}>
          {fields.map((field) => {
            const result = resultById.get(field.fieldId),baseValue=autofillValue(active.autofillContext, field),value=Object.hasOwn(active.autofillOverrides||{},field.fieldId)?active.autofillOverrides[field.fieldId]:baseValue,displayValue = displayAutofillValue(value);
            return <Flex key={field.fieldId} gap={8} align="start">
              <div style={{ minWidth: 0, flex: 1 }}>
                <Flex justify="space-between" gap={8}><Text strong>{LABELS[field.key] || field.label}</Text><Tag color={field.readiness === "READY" ? "green" : "gold"}>{field.confidence}%</Tag></Flex>
                {String(field.key).startsWith("screening.")&&result?.status!=="VERIFIED"?<ScreeningEditor field={field} value={value} onChange={next=>onValueChange(field.fieldId,next)}/>:<Text ellipsis={{ tooltip: displayValue }} style={{ display: "block" }}>{displayValue}</Text>}
                <Text type="secondary" style={{display:"block",fontSize:11}}>Source: {autofillValueSource(active.autofillContext,field)}</Text>
                {result && <Text type={result.status === "VERIFIED" ? "success" : "danger"}>{result.status === "VERIFIED" ? "Filled and verified" : RESULT_MESSAGES[result.code] || result.code.replaceAll("_", " ")}</Text>}
              </div>
            </Flex>;
          })}
          <Space><Button type="primary" loading={busy} onClick={onFill}>{results.length?"Retry failed fields":"Fill selected fields"}</Button><Button disabled={busy} onClick={onRescan}>Re-scan page</Button></Space>
        </Space>
      )}
      {unresolved.length>0&&(
        <Collapse size="small" style={{marginTop:10}} items={[{key:"unresolved",label:`Unresolved questions (${unresolved.length})`,children:<Space orientation="vertical" size={8} style={{width:"100%"}}><Alert type="warning" showIcon message="Complete these fields manually" description="These questions are reported to Admins so common ones can be added to the Application Guide. Declarations and questions the guide marks for a person always need your answer."/>{unresolved.map((item,index)=><Card size="small" key={`${item.normalizedQuestion}-${index}`}><Flex justify="space-between" align="start" gap={8}><div style={{minWidth:0}}><Text>{item.question}</Text><Text type="secondary" style={{display:"block",fontSize:11}}>{item.guideEntryId?"Application Guide: answer this one yourself":item.reason==="REVIEW_REQUIRED"?"Manual review required":"No Application Guide or Answer Library match"}{item.suggestions?.length?` · Possible match: ${item.suggestions.map(x=>x.answerKey.replaceAll("_"," ")).join(", ")}`:""}</Text>{item.guideEntryId&&guideHelp(item.guideEntryId)?<Text style={{display:"block",fontSize:12,whiteSpace:"pre-wrap"}}>{guideHelp(item.guideEntryId)}</Text>:null}</div><Button size="small" onClick={()=>navigator.clipboard?.writeText(item.question)}>Copy</Button></Flex></Card>)}</Space>}]}/>
      )}
    </Card>
  );
}
