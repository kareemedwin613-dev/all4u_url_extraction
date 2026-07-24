import React,{useEffect,useState} from "react";
import {listActiveAppliers} from "./application-service.js";

export function ApplierDirectoryPage({client,reload}) {
  const [items,setItems]=useState();
  const [error,setError]=useState("");
  useEffect(()=>{let live=true;listActiveAppliers(client).then(value=>live&&setItems(value)).catch(value=>live&&setError(value.message));return()=>{live=false};},[client,reload]);
  return <div className="page"><h1 tabIndex="-1">Users</h1><p>This read-only directory lists active Appliers available for individual Application assignment. User status and role management remain Admin-only.</p>{error&&<p className="notice error" role="alert">{error}</p>}{!items&&!error?<div className="state loading">Loading...</div>:items&&!items.length?<section className="state empty"><h2>No active Appliers</h2><p>An Admin can assign the Applier role from User Management.</p></section>:items&&<section className="panel"><div className="table-scroll"><table><thead><tr><th>Name</th><th>Email</th><th>Active Applications</th></tr></thead><tbody>{items.map(item=><tr key={item.id}><td>{item.display_name}</td><td>{item.email}</td><td>{item.active_application_count}</td></tr>)}</tbody></table></div></section>}</div>;
}
