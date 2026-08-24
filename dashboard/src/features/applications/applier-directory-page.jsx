import React,{useEffect,useState} from "react";
import {Card,Empty,Table,Typography} from "antd";
import {ErrorState,LoadingState} from "../../components/ui.jsx";
import {clientSortColumns} from "../../shared/table-sorting.js";
import {listActiveAppliers} from "./application-service.js";
const {Text,Title}=Typography;

export function ApplierDirectoryPage({client,apiBaseUrl,reload}) {
  const [items,setItems]=useState();
  const [error,setError]=useState("");
  useEffect(()=>{let live=true;listActiveAppliers(client,apiBaseUrl).then(value=>live&&setItems(value)).catch(value=>live&&setError(value.message));return()=>{live=false};},[client,apiBaseUrl,reload]);
  const columns=clientSortColumns([{title:"Name",dataIndex:"display_name"},{title:"Email",dataIndex:"email"},{title:"Active Applications",dataIndex:"active_application_count"}]);return <div className="page"><Text>This read-only directory lists active Appliers available for individual Application assignment. User status and role management remain Admin-only.</Text>{error?<ErrorState message={error}/>:!items?<LoadingState/>:!items.length?<Card><Empty description="No active Appliers. An Admin can assign the Applier role from User Management."/></Card>:<Card><Table rowKey="id" columns={columns} dataSource={items} pagination={false} scroll={{x:"max-content",y:"calc(100vh - 240px)"}}/></Card>}</div>;
}
