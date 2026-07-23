import React, {useCallback, useEffect, useMemo, useState} from "react";
import {AccountStatusBadge, RoleBadges} from "../components/access-components.jsx";
import {assignRole, getUser, listUsers, removeRole, setStatus} from "../services/admin-user-service.js";
import {formatDate} from "../shared/formatters.js";

const PAGE_SIZES = [25, 50, 100];

export function AdminUsersPage({client, roles, reload}) {
  const [searchInput, setSearchInput] = useState("");
  const [filters, setFilters] = useState({search: "", status: null, roleCode: null, page: 1, pageSize: 25});
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => { const timer = setTimeout(() => setFilters(value => ({...value, search: searchInput.trim(), page: 1})), 300); return () => clearTimeout(timer); }, [searchInput]);
  useEffect(() => { let active = true; setResult(null); setError(""); listUsers(client, filters).then(value => active && setResult(value)).catch(value => active && setError(value.message)); return () => { active = false; }; }, [client, filters, reload]);
  const change = patch => setFilters(value => ({...value, ...patch}));
  return <div className="page"><h1 tabIndex="-1">Users</h1><section className="panel admin-filters" aria-label="User filters"><label>Search name or email<input type="search" value={searchInput} maxLength="100" onChange={event => setSearchInput(event.target.value)}/></label><label>Status<select value={filters.status || ""} onChange={event => change({status: event.target.value || null, page: 1})}><option value="">All statuses</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></label><label>Role<select value={filters.roleCode || ""} onChange={event => change({roleCode: event.target.value || null, page: 1})}><option value="">All roles</option>{roles.map(role => <option value={role.code} key={role.code}>{role.name}</option>)}</select></label><label>Page size<select value={filters.pageSize} onChange={event => change({pageSize: Number(event.target.value), page: 1})}>{PAGE_SIZES.map(size => <option key={size}>{size}</option>)}</select></label></section>{error ? <section className="state error" role="alert"><h2>Users could not be loaded</h2><p>{error}</p></section> : !result ? <div className="state loading" role="status">Loading users…</div> : !result.items.length ? <section className="state empty"><h2>No users found</h2><p>{filters.search || filters.status || filters.roleCode ? "No users match the current filters." : "No registered profiles were found."}</p></section> : <section className="panel"><div className="table-scroll"><table><thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Status</th><th scope="col">Roles</th><th scope="col">Created</th><th scope="col">Actions</th></tr></thead><tbody>{result.items.map(user => <tr key={user.id}><td>{user.full_name || "Name not provided"}</td><td>{user.email}</td><td><AccountStatusBadge status={user.status}/></td><td><RoleBadges roles={user.role_codes || []}/></td><td>{formatDate(user.created_at)}</td><td><a href={`#/admin/users/${user.id}`}>Manage</a></td></tr>)}</tbody></table></div><nav className="pagination" aria-label="User pagination"><p>{result.total} users</p><div><button disabled={result.page <= 1} onClick={() => change({page: result.page - 1})}>Previous</button><span>Page {result.page} of {result.totalPages || 1}</span><button disabled={result.page >= result.totalPages} onClick={() => change({page: result.page + 1})}>Next</button></div></nav></section>}</div>;
}

export function AdminUserDetailPage({client, id, roles, currentUserId, onCurrentUserChanged}) {
  const [user, setUser] = useState();
  const [selected, setSelected] = useState(new Set());
  const [statusValue, setStatusValue] = useState("ACTIVE");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { setError(""); try { const value = await getUser(client, id); setUser(value); setSelected(new Set(value.roles || [])); setStatusValue(value.status); } catch (value) { setError(value.message); } }, [client, id]);
  useEffect(() => { load(); }, [load]);
  const changed = useMemo(() => user && (roles.some(role => selected.has(role.code) !== (user.roles || []).includes(role.code))), [roles, selected, user]);
  function toggle(code) { setSelected(value => { const next = new Set(value); next.has(code) ? next.delete(code) : next.add(code); return next; }); }
  async function saveRoles() {
    setBusy(true); setMessage("");
    try {
      const before = new Set(user.roles || []);
      for (const role of roles) if (selected.has(role.code) && !before.has(role.code)) await assignRole(client, id, role.code);
      for (const role of roles) if (!selected.has(role.code) && before.has(role.code)) await removeRole(client, id, role.code);
      await load();
      if (id === currentUserId) await onCurrentUserChanged();
      setMessage("Role assignments saved successfully.");
    } catch (value) { setMessage(`${value.message} Any completed role changes were retained; the current assignments have been reloaded.`); await load(); }
    finally { setBusy(false); }
  }
  async function saveStatus() {
    if (statusValue === "INACTIVE" && user.status !== "INACTIVE" && !window.confirm("The user will remain in Supabase Auth but will no longer be able to access platform data. Continue?")) return;
    setBusy(true); setMessage("");
    try { await setStatus(client, id, statusValue); await load(); if (id === currentUserId) await onCurrentUserChanged(); setMessage("Account status updated successfully."); }
    catch (value) { setMessage(value.message); setStatusValue(user.status); }
    finally { setBusy(false); }
  }
  if (error) return <div className="page"><a href="#/admin/users">← Back to Users</a><section className="state error" role="alert"><h1>User could not be loaded</h1><p>{error}</p></section></div>;
  if (!user) return <div className="state loading" role="status">Loading user…</div>;
  return <div className="page"><a className="back-link" href="#/admin/users">← Back to Users</a><h1 tabIndex="-1">Manage User</h1>{id === currentUserId && <p className="notice warning" role="status">You are editing your own account. Role or status changes may affect your current access.</p>}<section className="panel"><h2>Identity</h2><dl className="metadata"><div><dt>Full name</dt><dd>{user.fullName || "Name not provided"}</dd></div><div><dt>Email</dt><dd>{user.email}</dd></div><div><dt>User ID</dt><dd><code>{user.id}</code></dd></div><div><dt>Created</dt><dd>{formatDate(user.createdAt)}</dd></div></dl></section><section className="panel"><h2>Application account status</h2><div className="inline-form"><label htmlFor="account-status">Status<select id="account-status" value={statusValue} disabled={busy} onChange={event => setStatusValue(event.target.value)}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></select></label><button disabled={busy || statusValue === user.status} onClick={saveStatus}>Apply Status</button></div></section><section className="panel"><h2>System roles</h2><p>Roles are fixed system definitions. Select one or more assignments for this user.</p><div className="role-options">{roles.map(role => <label className="role-option" key={role.code}><input type="checkbox" checked={selected.has(role.code)} disabled={busy} onChange={() => toggle(role.code)}/><span><strong>{role.name}</strong><small>{role.description}</small></span></label>)}</div><button disabled={busy || !changed} onClick={saveRoles}>{busy ? "Saving…" : "Save Role Assignments"}</button><p className="form-message neutral" aria-live="polite">{message}</p></section></div>;
}

export function AdminRolesPage({roles}) {
  return <div className="page"><h1 tabIndex="-1">System Roles</h1><p>These roles are fixed and read-only in v0.5.</p><section className="panel"><div className="table-scroll"><table><thead><tr><th scope="col">Role name</th><th scope="col">Role code</th><th scope="col">Description</th><th scope="col">Active status</th></tr></thead><tbody>{roles.map(role => <tr key={role.code}><td>{role.name}</td><td><code>{role.code}</code></td><td>{role.description}</td><td><AccountStatusBadge status={role.active ? "ACTIVE" : "INACTIVE"}/></td></tr>)}</tbody></table></div></section></div>;
}
