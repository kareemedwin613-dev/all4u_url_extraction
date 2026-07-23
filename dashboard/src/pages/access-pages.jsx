import React, {useEffect, useState} from "react";
import {ALL_CAPABILITIES} from "../access/capabilities.js";
import {ACCESS_STATE_COPY} from "../access/access-state-copy.js";
import {RoleBadges, AccountStatusBadge, AccessStatePanel} from "../components/access-components.jsx";
import {updateMyProfile} from "../services/profile-service.js";
import {formatDate, formatLabel} from "../shared/formatters.js";

export function PendingAccessPage() {
  return <AccessStatePanel {...ACCESS_STATE_COPY.PENDING_ACCESS}/>;
}

export function InactiveAccountPage() {
  return <AccessStatePanel {...ACCESS_STATE_COPY.ACCOUNT_INACTIVE}/>;
}

export function AccessDeniedPage() {
  return <AccessStatePanel {...ACCESS_STATE_COPY.ACCESS_DENIED} action={<a href="#/">Return to Overview</a>}/>;
}

export function AccessLoadErrorPage({error, retry}) {
  return <AccessStatePanel title={ACCESS_STATE_COPY.ACCESS_ERROR.title} message={error?.message || ACCESS_STATE_COPY.ACCESS_ERROR.message} action={<button onClick={retry}>Retry</button>}/>;
}

export function ProfilePage({client, access, reloadAccess}) {
  const [name, setName] = useState(access.fullName);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setName(access.fullName), [access.fullName]);
  async function save(event) {
    event.preventDefault();
    setBusy(true); setMessage("");
    try { await updateMyProfile(client, name); await reloadAccess(); setMessage("Profile updated successfully."); }
    catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }
  return <div className="page"><h1 tabIndex="-1">My Profile</h1><section className="panel profile-panel"><form onSubmit={save} className="profile-form"><label htmlFor="profile-name">Full name</label><input id="profile-name" value={name} maxLength="200" onChange={event => setName(event.target.value)}/><button disabled={busy}>{busy ? "Saving…" : "Save Full Name"}</button><p className="form-message neutral" aria-live="polite">{message}</p></form><dl className="metadata"><div><dt>Email</dt><dd>{access.email}</dd></div><div><dt>Account status</dt><dd><AccountStatusBadge status={access.status}/></dd></div><div><dt>Account created</dt><dd>{formatDate(access.createdAt)}</dd></div><div><dt>Assigned roles</dt><dd><RoleBadges roles={access.roles}/></dd></div></dl></section></div>;
}

export function TechnicalOverview({access}) {
  const capabilities = ALL_CAPABILITIES.filter(value => access.capabilities.has(value));
  return <div className="page"><h1 tabIndex="-1">Overview</h1><section className="panel"><h2>Account &amp; Access</h2><dl className="metadata"><div><dt>Signed-in user</dt><dd>{access.fullName || access.email}</dd></div><div><dt>Account status</dt><dd><AccountStatusBadge status={access.status}/></dd></div><div><dt>Assigned roles</dt><dd><RoleBadges roles={access.roles}/></dd></div><div><dt>Current capabilities</dt><dd>{capabilities.length ? capabilities.map(formatLabel).join(", ") : "Profile access only"}</dd></div></dl></section></div>;
}
