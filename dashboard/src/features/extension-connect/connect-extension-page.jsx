import React,{useMemo,useState}from"react";
import{Alert,Button,Card,Space,Typography}from"antd";
import{approveExtensionPairing}from"../../services/storage-read-service.js";
import{parseConnectRequest}from"./connect-extension-request.js";

const{Paragraph,Text,Title}=Typography;

export function ConnectExtensionPage({client,apiBaseUrl,access,query}){
  const request=useMemo(()=>parseConnectRequest(query),[query]),[state,setState]=useState("ready"),[error,setError]=useState("");
  async function approve(){
    setState("busy");setError("");
    try{await approveExtensionPairing(client,{apiBaseUrl,pairingId:request.pairingId,challenge:request.challenge});setState("approved");}
    catch(value){setError(value.message||"The extension could not be approved.");setState("ready");}
  }
  if(!request)return <div className="page"><Alert type="error" showIcon message="This connection link is incomplete" description="Open the Resume JD extension and click Connect with dashboard again."/></div>;
  return <div className="page"><Card style={{maxWidth:560}}>
    <Title level={3} style={{marginTop:0}}>Connect the Chrome extension</Title>
    {state==="approved"?<Alert type="success" showIcon message="Extension approved" description="Return to the extension. It finishes signing in within a few seconds; you can close this tab."/>:state==="cancelled"?<Alert type="info" showIcon message="Not connected" description="Nothing was approved. You can close this tab."/>:<>
      <Paragraph>The extension will sign in as <Text strong>{access?.email||"your account"}</Text>, with its own session that you can sign out separately.</Paragraph>
      <Paragraph>Approve only if you just clicked <Text strong>Connect with dashboard</Text> in your extension and it shows this code:</Paragraph>
      <div style={{fontFamily:"monospace",fontSize:32,letterSpacing:4,textAlign:"center",margin:"16px 0"}} aria-label="Confirmation code">{request.code}</div>
      {error&&<Alert type="error" showIcon message={error} style={{marginBottom:12}}/>}
      <Space><Button type="primary" onClick={approve} loading={state==="busy"}>Approve</Button><Button onClick={()=>setState("cancelled")} disabled={state==="busy"}>Cancel</Button></Space>
      <Paragraph type="secondary" style={{marginTop:16,marginBottom:0}}>If you did not start this, click Cancel. Someone who sent you this link could otherwise use your account.</Paragraph>
    </>}
  </Card></div>;
}
