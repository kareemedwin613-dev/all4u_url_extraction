const HEADERS = [
  "JD ID","Company","Job Title","Category ID","Subcategory ID","Industry Domain ID","Seniority","Location","Work Arrangement",
  "Clearance Requirements","Travel Required","Travel Details","Salary Minimum","Salary Maximum","Salary Currency","Salary Period","Salary Text",
  "Source Website","Source URL","Detected Skills","Capture Method","Extraction Confidence","Captured At","Captured By User ID","Captured By Email",
  "Description 1","Description 2","Description 3","Description 4","Description 5","Google Synced At"
];

function response_(body){return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);}
function hex_(bytes){return bytes.map(function(value){var normalized=value<0?value+256:value;return ("0"+normalized.toString(16)).slice(-2);}).join("");}
function equal_(left,right){if(left.length!==right.length)return false;var result=0;for(var index=0;index<left.length;index++)result|=left.charCodeAt(index)^right.charCodeAt(index);return result===0;}
function safe_(value){if(value===null||value===undefined)return"";var text=Array.isArray(value)?value.join(", "):String(value);return /^[=+\-@]/.test(text)?"'"+text:text;}

function doPost(event){
  try{
    var properties=PropertiesService.getScriptProperties(),secret=properties.getProperty("SYNC_SECRET"),spreadsheetId=properties.getProperty("SPREADSHEET_ID"),sheetName=properties.getProperty("SHEET_NAME")||"Job Descriptions";
    if(!secret||secret.length<32||!spreadsheetId)throw new Error("SCRIPT_NOT_CONFIGURED");
    var envelope=JSON.parse(event&&event.postData&&event.postData.contents||"{}"),timestamp=String(envelope.timestamp||""),payloadText=String(envelope.payload||""),signature=String(envelope.signature||"").toLowerCase();
    if(!/^\d{13}$/.test(timestamp)||Math.abs(Date.now()-Number(timestamp))>300000)throw new Error("REQUEST_EXPIRED");
    var expected=hex_(Utilities.computeHmacSha256Signature(timestamp+"."+payloadText,secret));
    if(!/^[0-9a-f]{64}$/.test(signature)||!equal_(signature,expected))throw new Error("SIGNATURE_INVALID");
    var data=JSON.parse(payloadText),jdId=String(data.jdId||"");
    if(!/^[0-9a-f-]{36}$/i.test(jdId))throw new Error("JD_ID_INVALID");
    var descriptions=Array.isArray(data.descriptionChunks)?data.descriptionChunks.slice(0,5):[];while(descriptions.length<5)descriptions.push("");
    var values=[data.jdId,data.company,data.jobTitle,data.categoryId,data.subcategoryId,data.industryDomainCategoryId,data.seniority,data.location,data.workArrangement,
      data.clearanceRequirements,data.travelRequired,data.travelDetails,data.salaryMin,data.salaryMax,data.salaryCurrency,data.salaryPeriod,data.salaryText,
      data.sourceWebsite,data.sourceUrl,data.detectedSkills,data.captureMethod,data.extractionConfidence,data.capturedAt,data.capturedByUserId,data.capturedByEmail]
      .concat(descriptions).concat([new Date().toISOString()]).map(safe_);
    var lock=LockService.getScriptLock();lock.waitLock(10000);
    try{
      var spreadsheet=SpreadsheetApp.openById(spreadsheetId),sheet=spreadsheet.getSheetByName(sheetName)||spreadsheet.insertSheet(sheetName);
      if(sheet.getLastRow()===0)sheet.getRange(1,1,1,HEADERS.length).setValues([HEADERS]).setFontWeight("bold").setFrozenRows(1);
      var match=sheet.getRange(2,1,Math.max(sheet.getLastRow()-1,1),1).createTextFinder(jdId).matchEntireCell(true).findNext(),row=match?match.getRow():sheet.getLastRow()+1;
      sheet.getRange(row,1,1,values.length).setValues([values]);
    }finally{lock.releaseLock();}
    return response_({ok:true,jdId:jdId});
  }catch(error){return response_({ok:false,error:String(error&&error.message||"WORKSPACE_SYNC_FAILED")});}
}
