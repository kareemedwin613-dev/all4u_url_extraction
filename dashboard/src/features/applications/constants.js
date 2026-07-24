export const WORK_STATUSES = Object.freeze(["UNASSIGNED","ASSIGNED","IN_PROGRESS","BLOCKED","COMPLETED","CANCELLED"]);
export const APPLICATION_STATUSES = Object.freeze(["NOT_APPLIED","APPLIED","SCREENING","INTERVIEW_SCHEDULED","OFFER_RECEIVED","REJECTED","WITHDRAWN","CLOSED"]);
export const APPLICATION_PRIORITIES = Object.freeze(["LOW","NORMAL","HIGH","URGENT"]);
export const APPLICATION_SORTS = Object.freeze([
  ...["number","company","title","resume","candidate","assignee","link","work","application_status","priority","due","updated","created","captured","category","batch"].flatMap(key=>[[`${key}_asc`,`${key.replaceAll("_"," ")} - Ascending`],[`${key}_desc`,`${key.replaceAll("_"," ")} - Descending`]]),
]);
export const DUE_FILTERS = Object.freeze([["OVERDUE","Overdue"],["DUE_TODAY","Due today"],["NO_DUE_DATE","No due date"]]);
