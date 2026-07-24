import React, {useEffect, useState} from "react";
import {Alert,Button,Card,Descriptions,Form,Input,Typography} from "antd";
import {ALL_CAPABILITIES} from "../access/capabilities.js";
import {ACCESS_STATE_COPY} from "../access/access-state-copy.js";
import {RoleBadges, AccountStatusBadge, AccessStatePanel} from "../components/access-components.jsx";
import {updateMyProfile} from "../services/profile-service.js";
import {formatDate, formatLabel} from "../shared/formatters.js";
const {Title}=Typography;

export function PendingAccessPage() {
  return <AccessStatePanel {...ACCESS_STATE_COPY.PENDING_ACCESS}/>;
}

export function InactiveAccountPage() {
  return <AccessStatePanel {...ACCESS_STATE_COPY.ACCOUNT_INACTIVE}/>;
}

export function AccessDeniedPage() {
  return <AccessStatePanel {...ACCESS_STATE_COPY.ACCESS_DENIED} action={<Button type="link" href="#/">Return to Overview</Button>}/>;
}

export function AccessLoadErrorPage({error, retry}) {
  return <AccessStatePanel title={ACCESS_STATE_COPY.ACCESS_ERROR.title} message={error?.message || ACCESS_STATE_COPY.ACCESS_ERROR.message} action={<Button danger onClick={retry}>Retry</Button>}/>;
}

export function ProfilePage({client, access, reloadAccess}) {
  const [name, setName] = useState(access.fullName);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setName(access.fullName), [access.fullName]);
  async function save() {
    setBusy(true); setMessage("");
    try { await updateMyProfile(client, name); await reloadAccess(); setMessage("Profile updated successfully."); }
    catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }
  return <div className="page"><Title level={1} tabIndex={-1}>My Profile</Title>{message&&<Alert type={message.includes("successfully")?"success":"error"} showIcon message={message}/>}<Card><Form layout="vertical" onFinish={save} className="profile-form"><Form.Item label="Full name"><Input value={name} maxLength={200} onChange={event=>setName(event.target.value)}/></Form.Item><Button type="primary" htmlType="submit" loading={busy}>Save Full Name</Button></Form><Descriptions bordered column={{xs:1,md:2}} items={[{key:"email",label:"Email",children:access.email},{key:"status",label:"Account status",children:<AccountStatusBadge status={access.status}/>},{key:"created",label:"Account created",children:formatDate(access.createdAt)},{key:"roles",label:"Assigned roles",children:<RoleBadges roles={access.roles}/>} ]}/></Card></div>;
}

export function TechnicalOverview({access}) {
  const capabilities = ALL_CAPABILITIES.filter(value => access.capabilities.has(value));
  return <div className="page"><Title level={1} tabIndex={-1}>Overview</Title><Card title="Account & Access"><Descriptions bordered column={{xs:1,md:2}} items={[{key:"user",label:"Signed-in user",children:access.fullName||access.email},{key:"status",label:"Account status",children:<AccountStatusBadge status={access.status}/>},{key:"roles",label:"Assigned roles",children:<RoleBadges roles={access.roles}/>},{key:"capabilities",label:"Current capabilities",children:capabilities.length?capabilities.map(formatLabel).join(", "):"Profile access only"}]}/></Card></div>;
}
