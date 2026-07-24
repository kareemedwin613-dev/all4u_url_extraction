export const WORK_STATUSES = Object.freeze(["UNASSIGNED","ASSIGNED","IN_PROGRESS","BLOCKED","COMPLETED","CANCELLED"]);
export const APPLICATION_STATUSES = Object.freeze(["NOT_APPLIED","APPLIED","SCREENING","INTERVIEW_SCHEDULED","OFFER_RECEIVED","REJECTED","WITHDRAWN","CLOSED"]);
export const APPLICATION_PRIORITIES = Object.freeze(["LOW","NORMAL","HIGH","URGENT"]);
export const APPLICATION_SORTS = Object.freeze([
  ["updated_desc","Updated - Newest"],["created_desc","Created - Newest"],["created_asc","Created - Oldest"],
  ["due_asc","Due date - Soonest"],["priority_desc","Priority - Highest"],["company_asc","Company - A to Z"],["title_asc","Job title - A to Z"],
]);
export const DUE_FILTERS = Object.freeze([["OVERDUE","Overdue"],["DUE_TODAY","Due today"],["NO_DUE_DATE","No due date"]]);

