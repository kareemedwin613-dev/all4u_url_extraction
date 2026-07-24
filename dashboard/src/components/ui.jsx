import React from "react";
import {Alert,Button,Card,Descriptions,Empty,Flex,Pagination,Spin,Table,Tag,Typography} from "antd";
import {formatLabel} from "../shared/formatters.js";

const {Text,Title}=Typography;
const tagColor=value=>({ACTIVE:"green",INACTIVE:"red",ARCHIVED:"default",URGENT:"red",HIGH:"gold",NORMAL:"blue",LOW:"default",BLOCKED:"red",COMPLETED:"green",CANCELLED:"default",APPLIED:"blue",OFFER_RECEIVED:"green",REJECTED:"red"}[String(value||"").toUpperCase()]||"blue");

export const StatusTag=({value})=><Tag color={tagColor(value)}>{formatLabel(value)}</Tag>;
export const TagList=({values=[],empty="None"})=>values.length?<Flex gap="small" wrap>{values.map(value=><Tag key={value}>{value}</Tag>)}</Flex>:<Text type="secondary">{empty}</Text>;
export const LoadingState=({text="Loading…"})=><Flex className="ui-state" align="center" justify="center" gap="small" role="status"><Spin/><Text>{text}</Text></Flex>;
export const ErrorState=({message,title="Something went wrong",retry})=><Alert className="ui-alert" type="error" showIcon message={title} description={message} action={retry?<Button danger onClick={retry}>Retry</Button>:null}/>;
export const EmptyState=({title,text,onClear})=><Card><Empty description={<><Title level={4}>{title}</Title><Text type="secondary">{text}</Text></>}>{onClear&&<Button onClick={onClear}>Clear filters</Button>}</Empty></Card>;
export const Metadata=({items,column=2})=><Descriptions bordered size="small" column={{xs:1,sm:1,md:column}} items={items.map(([label,children],index)=>({key:`${label}-${index}`,label,children:children??"Not available"}))}/>;
export const PageCard=({title,extra,children,className=""})=><Card title={title} extra={extra} className={className}>{children}</Card>;
export function LegacyTable({headers,children}){const rows=React.Children.toArray(children).map((row,rowIndex)=>{const values={key:row.key||rowIndex};React.Children.toArray(row.props.children).forEach((cell,index)=>{values[index]=cell.props.children;});return values;}),columns=headers.map((title,index)=>({title,dataIndex:index,key:index}));return <Table columns={columns} dataSource={rows} pagination={false} scroll={{x:"max-content"}} size="middle"/>;}
export const DataPagination=({data,onPage})=><Flex className="ui-pagination" justify="space-between" align="center" wrap><Text>Showing {data.from}–{data.to} of {data.total}</Text><Pagination current={data.page} pageSize={data.pageSize||Math.max(1,data.to-data.from+1)} total={data.total} showSizeChanger={false} onChange={onPage}/></Flex>;
export const PageHeading=({title,eyebrow,extra})=><Flex className="page-heading" align="center" justify="space-between" gap="middle" wrap><div>{eyebrow&&<Text type="secondary" className="eyebrow">{eyebrow}</Text>}<Title level={1} tabIndex={-1}>{title}</Title></div>{extra}</Flex>;
