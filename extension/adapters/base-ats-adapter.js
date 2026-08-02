export class BaseAtsAdapter{
  constructor({id,version="1.0.0",label=id,tier="ATS_FAMILY"}){if(!id)throw new Error("Adapter id is required.");this.id=id;this.version=version;this.label=label;this.tier=tier;}
  matches(){return false;}
  detectResumeField(){return null;}
  detectFields(){return{fields:[],unresolved:[]};}
  attachResume(){return{status:"UNSUPPORTED",code:"RESUME_INPUT_NOT_FOUND"};}
  fillFields(){return[];}
  async fillField(field,value,context){return(await this.fillFields({...context,fields:[{...field,value}]}))[0]||{fieldId:field?.fieldId,status:"FAILED",code:"FIELD_FILL_FAILED"};}
  verifyField(_field,_value,result){return result?.status==="VERIFIED"||result?.status==="ATTACHED";}
  diagnostics(){return{id:this.id,version:this.version,label:this.label,tier:this.tier};}
}
