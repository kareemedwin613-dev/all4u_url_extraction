const screeningKey = (answerKey) => `screening.${answerKey}`;

export function salaryMidpoint(job) {
  const minimum=Number(job?.salaryMin),maximum=Number(job?.salaryMax);
  if(!Number.isFinite(minimum)||!Number.isFinite(maximum)||minimum<0||maximum<minimum||job?.salaryMin==null||job?.salaryMax==null)return"";
  return String(Math.round(((minimum+maximum)/2)*100)/100);
}

export function screeningDefinitions(context) {
  const definitions=(Array.isArray(context?.applicationAnswers) ? context.applicationAnswers : []).map((answer) => ({
    answerKey: answer.answerKey,
    answerType: answer.answerType,
    questionPatterns: Array.isArray(answer.questionPatterns) ? answer.questionPatterns : [],
  }));
  if(salaryMidpoint(context?.job)&&!definitions.some(answer=>answer.answerKey==="desired_salary"))definitions.push({answerKey:"desired_salary",answerType:"TEXT",questionPatterns:["What is your desired salary?","What are your salary expectations?"]});
  return definitions;
}

export function autofillValue(context, field) {
  if (String(field?.key || "").startsWith("candidate.")) return context?.values?.[field.key] ?? "";
  if(field?.answerKey==="desired_salary"){
    const midpoint=salaryMidpoint(context?.job);
    if(midpoint)return midpoint;
  }
  const answer = (context?.applicationAnswers || []).find((item) => screeningKey(item.answerKey) === field?.key);
  return answer?.answerValue ?? "";
}

export function autofillValueSource(context,field){
  if(field?.answerKey==="desired_salary"&&salaryMidpoint(context?.job))return"JD salary midpoint";
  return String(field?.key||"").startsWith("screening.")?"Verified Answer Library":"Verified Resume metadata";
}

function snapshot(answer) {
  if (!answer) return "";
  return JSON.stringify({
    answerKey: answer.answerKey, answerType: answer.answerType, answerValue: answer.answerValue,
    questionPatterns: answer.questionPatterns || [], reviewedAt: answer.reviewedAt,
  });
}

export function selectedScreeningAnswersUnchanged(previous, current, fields) {
  const keys = new Set((fields || []).filter((field) => String(field?.key || "").startsWith("screening.")).map((field) => field.answerKey));
  if (!keys.size) return true;
  for (const key of keys) {
    const before = (previous?.applicationAnswers || []).find((answer) => answer.answerKey === key);
    const after = (current?.applicationAnswers || []).find((answer) => answer.answerKey === key);
    if(key==="desired_salary"&&(salaryMidpoint(previous?.job)||salaryMidpoint(current?.job))){if(salaryMidpoint(previous?.job)!==salaryMidpoint(current?.job))return false;continue;}
    if (!before || !after || snapshot(before) !== snapshot(after)) return false;
  }
  return true;
}

export function displayAutofillValue(value) {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value === null || value === undefined) return "";
  return String(value).replaceAll("_", " ");
}
