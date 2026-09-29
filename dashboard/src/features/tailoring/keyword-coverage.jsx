import React,{useEffect,useRef,useState}from"react";
import{Alert,Button,Card,Table,Typography}from"antd";
import{getTailoringKeywordCoverage}from"./tailoring-service.js";
const presence=value=>value===null?"Not checked":value?"Present":"Missing";
export function KeywordCoverage({client,apiBaseUrl,id,updatedAt}){
  const[report,setReport]=useState(),[error,setError]=useState(""),[busy,setBusy]=useState(false),sequence=useRef(0);
  useEffect(()=>{sequence.current++;setReport(undefined);setError("");setBusy(false);return()=>{sequence.current++;};},[client,apiBaseUrl,id,updatedAt]);
  async function check(){const request=++sequence.current;setBusy(true);setError("");try{const data=await getTailoringKeywordCoverage(client,apiBaseUrl,id);if(request===sequence.current)setReport(data);}catch(e){if(request===sequence.current)setError(e.message||"Coverage could not be checked.");}finally{if(request===sequence.current)setBusy(false);}}
  return <Card title="Keyword coverage" extra={<Button loading={busy} onClick={check}>{report?"Refresh report":"Check coverage"}</Button>}>
    <Typography.Paragraph type="secondary">On-demand, non-blocking comparison of detected JD keywords, saved original input, generated resume, and actual PDF. No AI call; this never changes approval or eligibility.</Typography.Paragraph>
    {error&&<Alert type="warning" showIcon message={error}/>}
    {report&&!report.available&&<Alert type="info" message={report.message}/>}
    {report?.available&&<>
      <Typography.Paragraph>{report.missingSupported.length} source-present keywords missing from generated content; {report.pdfStatus==="CHECKED"?`${report.lostInPdf.length} generated keywords missing from PDF.`:"PDF not checked (not created or unavailable)."}</Typography.Paragraph>
      <Typography.Paragraph type="secondary">{report.basis}</Typography.Paragraph>
      <Table rowKey="keyword" size="small" dataSource={report.rows} pagination={{pageSize:20}} columns={[
        {title:"JD keyword",dataIndex:"keyword"},{title:"Original input",dataIndex:"sourcePresent",render:presence},
        {title:"Generated",dataIndex:"generatedPresent",render:presence},{title:"Stored PDF",dataIndex:"pdfPresent",render:presence}
      ]}/>
    </>}
  </Card>;
}
