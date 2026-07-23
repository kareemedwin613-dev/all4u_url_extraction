const rules=[
  ["government-defense",["department of defense","dod","federal government","public trust","security clearance","government contractor","defense contractor"]],
  ["healthcare-life-sciences",["healthcare","health care","clinical","patient","pharmacy","pharmaceutical","medical device","biotech","life sciences","hipaa"]],
  ["fintech-payments",["fintech","payment processing","payments platform","digital wallet","merchant acquiring","cash app","card network"]],
  ["financial-services",["financial services","banking","capital markets","investment management","asset management","credit union","mortgage"]],
  ["insurance",["insurance","underwriting","policyholder","actuarial","claims processing"]],
  ["retail-ecommerce",["e-commerce","ecommerce","retail","marketplace","merchandising","consumer commerce"]],
  ["transportation-logistics",["transportation","logistics","supply chain","freight","shipping","fleet","fulfillment"]],
  ["energy-utilities",["energy","utility","utilities","oil and gas","renewable energy","electric grid"]],
  ["manufacturing",["manufacturing","industrial automation","factory","production plant","automotive","aerospace manufacturing"]],
  ["telecommunications",["telecommunications","telecom","wireless carrier","broadband","5g network"]],
  ["media-advertising",["media","advertising","adtech","publishing","streaming service","digital marketing"]],
  ["education",["education","edtech","university","higher education","student learning","school district"]],
  ["real-estate",["real estate","property management","proptech","commercial property"]],
  ["nonprofit",["nonprofit","non-profit","charitable organization","foundation"]],
  ["professional-services",["professional services","consulting firm","management consulting","legal services","accounting firm"]],
  ["technology",["software company","saas","cloud platform","technology company","developer platform","enterprise software"]]
];
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
export function detectIndustryDomain(title="",description=""){
  const scores=rules.map(([domain,terms],priority)=>({domain,priority,score:terms.reduce((total,term)=>{const pattern=new RegExp(`(^|[^a-z0-9])${escape(term)}(?=$|[^a-z0-9])`,"i");return total+(pattern.test(String(title))?5:0)+(pattern.test(String(description))?1:0);},0)})).filter(({score})=>score>0).sort((a,b)=>b.score-a.score||a.priority-b.priority);
  return scores[0]?.domain||null;
}
