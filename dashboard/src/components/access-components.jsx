import React from "react";
import {Alert,Card,Flex,Tag,Typography} from "antd";
import {roleLabel} from "../access/role-codes.js";
const {Text,Title}=Typography;

export function RoleBadges({roles = []}) {
  return roles.length ? <Flex gap="small" wrap aria-label="Assigned Roles">{roles.map(role => <Tag color="blue" key={role}>{roleLabel(role)}</Tag>)}</Flex> : <Text type="secondary">No roles assigned</Text>;
}

export function AccountStatusBadge({status}) {
  const label = status === "ACTIVE" ? "Active" : status === "INACTIVE" ? "Inactive" : "Unknown";
  return <Tag color={status==="ACTIVE"?"green":status==="INACTIVE"?"red":"default"}>{label}</Tag>;
}

export function AccessStatePanel({title, message, action}) {
  return <Card className="access-state"><Alert type="warning" showIcon message={<Title level={2} id="access-state-heading" tabIndex={-1}>{title}</Title>} description={<><p>{message}</p>{action}</>}/></Card>;
}
