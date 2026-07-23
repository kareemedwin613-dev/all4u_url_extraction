import React from "react";
import {roleLabel} from "../access/role-codes.js";

export function RoleBadges({roles = []}) {
  return roles.length ? <div className="tags" aria-label="Assigned roles">{roles.map(role => <span className="tag role-badge" key={role}>{roleLabel(role)}</span>)}</div> : <span className="muted">No roles assigned</span>;
}

export function AccountStatusBadge({status}) {
  const label = status === "ACTIVE" ? "Active" : status === "INACTIVE" ? "Inactive" : "Unknown";
  return <span className={`badge badge-${String(status || "").toLowerCase()}`}>{label}</span>;
}

export function AccessStatePanel({title, message, action}) {
  return <section className="state access-state" aria-labelledby="access-state-heading"><h1 id="access-state-heading" tabIndex="-1">{title}</h1><p>{message}</p>{action}</section>;
}
