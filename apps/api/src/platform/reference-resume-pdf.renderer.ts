import PDFDocument from "pdfkit";
import { readFile } from "node:fs/promises";
import { renderedSkillGroups, resolveResumeHeadline } from "./tailored-resume-layout.js";
import type { ReferenceResumeLayout } from "./reference-resume-templates.js";

type RecordValue = Record<string, any>;
type Face = "regular" | "bold" | "italic";
type Run = { text: string; face: Face };
type Line = Run[];
const clean = (value: unknown) => String(value ?? "").trim();
const list = (value: unknown): any[] => Array.isArray(value) ? value : [];
const date = (value: any) => value?.year ? (value.month ? `${String(value.month).padStart(2,"0")}/${value.year}` : String(value.year)) : "";
const dates = (value: any) => [date(value.start_date), value.is_current ? "Present" : date(value.end_date)].filter(Boolean).join(" – ");
const fonts = new Map<string, Promise<Buffer[]>>();
function loadFonts(family: string) {
  if (!fonts.has(family)) fonts.set(family, Promise.all(["400-normal", "700-normal", "400-italic"].map(variant =>
    readFile(new URL(`../../assets/resume-fonts/${family}-${variant}.woff`, import.meta.url)))));
  return fonts.get(family)!;
}

/** Reference layouts use real embedded fonts and measured, text-based drawing.
 * Pagination is explicit: PDFKit never gets an unbounded text block that can add a trailing page.
 * The approved preview is read-only, and no text is synthesized to fill empty sections.
 */
export async function renderReferenceResumePdf(input: RecordValue, spec: Readonly<ReferenceResumeLayout>): Promise<Buffer> {
  const buffers = await loadFonts(spec.fontAsset);
  const doc = new PDFDocument({size:"LETTER",margin:0,autoFirstPage:true,bufferPages:true,
    info:{Title:`Resume for Application #${input.applicationNumber}`,Author:"Resume JD Operations",Subject:`Resume layout ${spec.key}`}});
  (["regular","bold","italic"] as Face[]).forEach((face,index) => doc.registerFont(face,buffers[index]));
  const chunks: Buffer[] = [];
  const complete = new Promise<Buffer>((resolve,reject) => {doc.on("data",chunk=>chunks.push(Buffer.from(chunk)));doc.on("end",()=>resolve(Buffer.concat(chunks)));doc.on("error",reject);});
  const left=spec.margin, width=612-left*2, bottom=792-spec.margin, top=spec.margin;
  const blue="#0B6082", black="#111111";
  let y=spec.top;
  const setFont=(face:Face,size:number)=>doc.font(face).fontSize(size);
  const measure=(value:string,face:Face="regular",size=spec.body)=>setFont(face,size).widthOfString(value);
  const lineWidth=(line:Line,size=spec.body)=>line.reduce((sum,run)=>sum+measure(run.text,run.face,size),0);
  function rich(value: string, face: Face = "regular"): Run[] {
    return value.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map(part=>({text:part.startsWith("**")&&part.endsWith("**")?part.slice(2,-2):part,face:part.startsWith("**")&&part.endsWith("**")?"bold":face}));
  }
  function wrap(runs: Run[], maxWidth: number, size=spec.body): Line[] {
    const lines:Line[]=[], current:Line=[]; let used=0;
    const flush=()=>{while(current.length&&/^\s+$/.test(current[current.length-1].text))current.pop();lines.push(current.splice(0));used=0;};
    for(const run of runs) for(const token of run.text.split(/(\n|[^\S\n]+)/).filter(Boolean)) {
      if(token==="\n"){flush();continue;}
      const whitespace=/^\s+$/.test(token), tokenWidth=measure(token,run.face,size);
      if(whitespace&&!current.length)continue;
      if(used+tokenWidth>maxWidth&&current.length)flush();
      if(whitespace&&!current.length)continue;
      if(tokenWidth>maxWidth){
        for(const char of token){const w=measure(char,run.face,size);if(used+w>maxWidth&&current.length)flush();current.push({text:char,face:run.face});used+=w;}
      }else{current.push({text:token,face:run.face});used+=tokenWidth;}
    }
    if(current.length)flush();
    return lines;
  }
  function draw(line:Line,x:number,at:number,size=spec.body,color=black){
    for(const run of line){setFont(run.face,size).fillColor(color).text(run.text,x,at+size*.82,{lineBreak:false,baseline:"alphabetic"});x+=measure(run.text,run.face,size);}
  }
  function newPage(){doc.addPage();y=top;}
  function ensure(height:number){if(y+height>bottom&&y>top)newPage();}
  function paragraph(value:string,face:Face="regular",indent=0,size=spec.body,leading=spec.leading,color=black){
    for(const line of wrap(rich(value,face),width-indent,size)){ensure(leading);draw(line,left+indent,y,size,color);y+=leading;}
  }
  function icon(kind:string,x:number,at:number,size:number,color:string){
    doc.save().translate(x,at).scale(size/12).lineWidth(1).strokeColor(color).fillColor(color);
    if(kind==="mail"){doc.rect(1,3,10,7).stroke();doc.moveTo(1,3).lineTo(6,7).lineTo(11,3).stroke();}
    else if(kind==="phone"){doc.path("M2 1 L4 1 L5 4 L3.5 5 Q5 8 7 8.5 L8 7 L11 8 L11 10 Q7 13 2 6 Q0 3 2 1 Z").fill();}
    else if(kind==="location"){doc.circle(6,4,3).stroke();doc.moveTo(3.5,6).lineTo(6,11).lineTo(8.5,6).stroke();doc.circle(6,4,1).fill();}
    else if(kind==="link"){doc.roundedRect(1,1,10,10,1).stroke();doc.circle(3,4,.6).fill();doc.moveTo(3,6).lineTo(3,9).moveTo(6,9).lineTo(6,5).bezierCurveTo(10,4,9,7,9,9).stroke();}
    else if(kind==="experience"){doc.rect(1,4,10,7).stroke();doc.rect(4,1,4,3).stroke();doc.moveTo(1,7).lineTo(11,7).stroke();}
    else if(kind==="education"){doc.moveTo(0,4).lineTo(6,1).lineTo(12,4).lineTo(6,7).closePath().fill();doc.moveTo(3,7).lineTo(3,9).lineTo(9,9).lineTo(9,7).stroke();}
    else if(kind==="skills"){doc.circle(6,4.5,4).stroke();doc.moveTo(4,8).lineTo(4,11).lineTo(8,11).lineTo(8,8).moveTo(6,2).lineTo(6,7).moveTo(4,4).lineTo(8,4).stroke();}
    else{doc.rect(1,2,10,8).stroke();doc.moveTo(3,4).lineTo(9,4).moveTo(3,6).lineTo(9,6).moveTo(3,8).lineTo(7,8).stroke();}
    doc.restore();
  }
  function section(title:string,kind:string,firstHeight:number){
    const band=spec.heading!=="rule",headingHeight=spec.headingSize+5;
    ensure(spec.sectionGap+headingHeight+5+Math.min(firstHeight,bottom-top-headingHeight-spec.sectionGap-5));
    y+=spec.sectionGap;
    const label=spec.uppercase?title.toUpperCase():title, labelWidth=measure(label,"bold",spec.headingSize);
    if(band){doc.rect(left,y-2,width,headingHeight).fill(spec.heading==="blue-band"?"#ECF3F6":"#ECECEC");
      const withIcon=spec.heading==="blue-band",x=left+(width-labelWidth-(withIcon?16:0))/2;
      if(withIcon)icon(kind,x,y+1,10,blue);
      draw([{text:label,face:"bold"}],x+(withIcon?16:0),y+1,spec.headingSize,withIcon?blue:black);
    }else{draw([{text:label,face:"bold"}],left,y,spec.headingSize);doc.moveTo(left,y+headingHeight-2).lineTo(left+width,y+headingHeight-2).lineWidth(spec.key==="ALEGREYA_CLASSIC_V1"?1.1:.5).strokeColor(black).stroke();}
    y+=headingHeight+4;
  }
  function header(){
    const candidate=input.candidate||{},name=clean(candidate.name)||"Candidate",headline=resolveResumeHeadline(input)||"";
    const contacts=[{kind:"mail",text:clean(candidate.email)},{kind:"phone",text:clean(candidate.phone)},
      {kind:"location",text:[candidate.city,candidate.stateRegion,candidate.country].map(clean).filter(Boolean).join(", ")},
      ...[candidate.linkedinUrl,candidate.githubUrl,candidate.portfolioUrl].map(value=>({kind:"link",text:clean(value)}))].filter(item=>item.text);
    const banner=spec.header==="banner",color=banner?"#FFFFFF":black;
    const inline=spec.header==="inline"||banner;
    const names=wrap([{text:name,face:spec.key==="CRIMSON_BANDS_V1"?"regular":"bold"}],width,spec.nameSize);
    const headlineLines=wrap([{text:headline,face:spec.header==="centered"||spec.key==="CRIMSON_BANDS_V1"?"italic":"regular"}],width,spec.headlineSize);
    const inlineName=inline&&names.length===1&&headlineLines.length<=1&&lineWidth(names[0],spec.nameSize)+12+measure(headline,"regular",spec.headlineSize)<=width;
    const titleHeight=names.length*spec.nameSize*1.15+(headline&&!inlineName?headlineLines.length*spec.headlineSize*1.25:0);
    const contactSize=spec.key==="AMIRI_COMPACT_V1"?8.5:spec.body;
    const useIcons=spec.key!=="AMIRI_COMPACT_V1",gridContacts=spec.header==="stacked";
    const contactWidth=gridContacts?(width-22)/2:width;
    // Centered reference reserves the social links for a separate contact row.
    const rows: typeof contacts[]=[];let row:typeof contacts=[];let rowWidth=0;
    for(const item of contacts){
      const itemWidth=Math.min(contactWidth,measure(item.text,"regular",contactSize)+(useIcons?16:0));
      if(row.length&&((!gridContacts&&rowWidth+18+itemWidth>width)||(spec.header==="centered"&&item.kind==="link")||(gridContacts&&row.length===2))){rows.push(row);row=[];rowWidth=0;}
      row.push(item);rowWidth+=(row.length>1?18:0)+itemWidth;
    }
    if(row.length)rows.push(row);
    const contactHeights=rows.map(items=>Math.max(...items.map(item=>wrap([{text:item.text,face:"regular"}],Math.max(25,contactWidth-(useIcons?16:0)),contactSize).length))*contactSize*1.35);
    if(banner)doc.rect(0,0,612,y+titleHeight+12+contactHeights.reduce((a,b)=>a+b,0)+18).fill(blue);
    for(const line of names){draw(line,spec.header==="centered"?left+(width-lineWidth(line,spec.nameSize))/2:left,y,spec.nameSize,color);y+=spec.nameSize*1.15;}
    if(headline){if(inlineName){draw(headlineLines[0],left+lineWidth(names[0],spec.nameSize)+12,y-spec.nameSize*1.15+(spec.nameSize-spec.headlineSize)*.82,spec.headlineSize,color);}
      else for(const line of headlineLines){draw(line,spec.header==="centered"?left+(width-lineWidth(line,spec.headlineSize))/2:left,y,spec.headlineSize,color);y+=spec.headlineSize*1.25;}}
    y+=9;
    rows.forEach((items,index)=>{
      const total=items.reduce((sum,item)=>sum+Math.min(width,measure(item.text,"regular",contactSize)+(useIcons?16:0)),0)+(items.length-1)*18;
      let x=spec.header==="centered"?left+(width-total)/2:left;
      for(const item of items){if(useIcons)icon(item.kind,x,y+1,10,color);
        const lines=wrap([{text:item.text,face:"regular"}],contactWidth-(useIcons?16:0),contactSize);
        lines.forEach((line,n)=>draw(line,x+(useIcons?16:0),y+n*contactSize*1.35,contactSize,color));
        x+=gridContacts?contactWidth+22:Math.min(width,measure(item.text,"regular",contactSize)+(useIcons?16:0))+18;
      }
      y+=contactHeights[index];
    });
    if(banner)y+=21;
  }
  const preview=input.approvedPreview||{},structured=input.sourceStructuredContent||{};
  const details=new Map(list(preview.professionalExperience).map(item=>[clean(item.sourceExperienceId),clean(item.tailoredDetails)]));
  const bulletLines=(value:string)=>value.split(/\r?\n/).map(line=>line.replace(/^\s*[•*\-]\s*/,"").trim()).filter(Boolean);
  function bullet(value:string){
    let runs=rich(value);
    if(spec.boldLead&&!value.includes("**")){const match=value.match(/^(\S+)(.*)$/s);if(match)runs=[{text:match[1],face:"bold"},{text:match[2],face:"regular"}];}
    const lines=wrap(runs,width-9);
    ensure(Math.min(lines.length,2)*spec.leading);
    lines.forEach((line,index)=>{ensure(spec.leading);if(index===0)draw([{text:spec.header==="banner"?"-":"•",face:"regular"}],left,y);draw(line,left+9,y);y+=spec.leading;});
  }
  function titleRow(runs:Run[],range:string){
    const dateWidth=range?measure(range,"regular")+14:0, titleWidth=width-dateWidth;
    const lines=wrap(runs,titleWidth);
    if(range)draw([{text:range,face:"regular"}],left+width-measure(range),y,spec.body,spec.header==="banner"?blue:black);
    for(const line of lines){ensure(spec.leading);draw(line,left,y);y+=spec.leading;}
  }
  function experience(){
    const roles=list(structured.professional_experience);if(!roles.length)return;
    const roleHeight=(item:RecordValue)=>{
      const title=clean(item.job_title)+(spec.inlineEmployer&&clean(item.company)?`, ${clean(item.company)}`:"");
      const h=wrap(rich(title,"bold"),width-(dates(item)?measure(dates(item))+14:0)).length*spec.leading;
      return h+(!spec.inlineEmployer&&clean(item.company)?spec.leading:0)+(clean(item.location)?spec.leading:0)+Math.min(2,wrap(rich(bulletLines(details.get(clean(item.id))||"")[0]||""),width-9).length)*spec.leading;
    };
    section("Professional Experience","experience",roleHeight(roles[0]));
    roles.forEach((item,index)=>{
      if(index)y+=spec.roleGap;
      ensure(roleHeight(item));
      const runs:Run[]=[{text:clean(item.job_title),face:"bold"}];
      if(spec.inlineEmployer&&clean(item.company))runs.push({text:`, ${clean(item.company)}`,face:spec.key==="AMIRI_COMPACT_V1"?"italic":"regular"});
      titleRow(runs,dates(item));
      if(!spec.inlineEmployer&&clean(item.company))paragraph(clean(item.company),spec.header==="banner"?"regular":"italic");
      if(clean(item.location))paragraph(clean(item.location),"italic");
      for(const line of bulletLines(details.get(clean(item.id))||""))bullet(line);
    });
  }
  function skills(){
    const groups=renderedSkillGroups(preview.skills,preview.skillGroups);if(!groups.length)return;
    const count=Math.min(spec.skillColumns,groups.length),gap=22,colWidth=(width-gap*(count-1))/count;
    const blocks=groups.map(group=>{const label=wrap([{text:group.name,face:"bold"}],colWidth);return {labelLines:label.length,lines:[...label,...wrap([{text:group.skills.join(", "),face:"regular"}],colWidth)]};});
    const columns:typeof blocks[]=Array.from({length:count},()=>[]);let remaining=blocks.reduce((sum,block)=>sum+block.lines.length*spec.leading+spec.groupGap,0),cursor=0;
    for(let c=0;c<count;c++){
      const target=remaining/(count-c);let height=0;
      while(cursor<blocks.length){const block=blocks[cursor],h=block.lines.length*spec.leading+spec.groupGap;
        if(c<count-1&&columns[c].length&&(blocks.length-cursor<=count-c-1||Math.abs(height-target)<=Math.abs(height+h-target)))break;
        columns[c].push(block);height+=h;cursor++;
      }
      remaining-=height;
    }
    section("Skills","skills",Math.max(...columns.map(column=>(column[0]?.labelLines||1)+1))*spec.leading);
    const queues=columns.map(blocks=>blocks.flatMap((block,index)=>[...block.lines.map(line=>({line,height:spec.leading})),...(index<blocks.length-1?[{line:[] as Line,height:spec.groupGap}]:[])]));
    while(queues.some(queue=>queue.length)){
      const start=y;let maxY=start;
      queues.forEach((queue,column)=>{
        let localY=start;
        while(queue.length){const next=queue[0];
          // Keep a group label with at least its first skill line.
          const label=next.line.length&&next.line.every(run=>run.face==="bold");
          if(localY+next.height+(label&&queue.length>1?queue[1].height:0)>bottom)break;
          queue.shift();if(next.line.length)draw(next.line,left+column*(colWidth+gap),localY);localY+=next.height;
        }
        while(queue[0]&&!queue[0].line.length)queue.shift();
        maxY=Math.max(maxY,localY);
      });
      y=maxY;
      if(queues.some(queue=>queue.length))newPage();
    }
  }
  function education(){
    const items=list(structured.education),legacy=clean(structured.education_legacy_text);if(!items.length&&!legacy)return;
    const blocks=items.map(item=>{
      const degree=[item.degree,item.field_of_study,item.gpa?`GPA: ${item.gpa}`:""].map(clean).filter(Boolean).join(", ");
      const primary=spec.degreeFirst?degree||clean(item.institution):clean(item.institution)||degree;
      const secondary=spec.degreeFirst&&degree?clean(item.institution):!spec.degreeFirst&&clean(item.institution)?degree:"";
      const inline=spec.inlineEmployer&&Boolean(secondary),runs:Run[]=[{text:primary,face:"bold"}];
      if(inline)runs.push({text:`, ${secondary}`,face:spec.key==="AMIRI_COMPACT_V1"?"italic":"regular"});
      const height=wrap(runs,width-(dates(item)?measure(dates(item))+14:0)).length*spec.leading+(secondary&&!inline?spec.leading:0);
      return {item,runs,secondary,inline,height};
    });
    section("Education","education",blocks[0]?.height||Math.min(2,wrap(rich(legacy),width).length)*spec.leading);
    if(!items.length){paragraph(legacy);return;}
    blocks.forEach(({item,runs,secondary,inline,height},index)=>{
      if(index)y+=spec.roleGap;
      ensure(height);
      titleRow(runs,dates(item));
      if(secondary&&!inline)paragraph(secondary,spec.header==="banner"?"regular":"italic");
      if(clean(item.details))paragraph(clean(item.details));
    });
  }
  header();
  for(const name of spec.sections){
    if(name==="summary"&&clean(preview.summary)){section("Summary","summary",Math.min(2,wrap(rich(clean(preview.summary)),width).length)*spec.leading);paragraph(clean(preview.summary));}
    else if(name==="skills")skills();else if(name==="experience")experience();else if(name==="education")education();
  }
  const certifications=list(structured.certifications).map(item=>clean(item.name??item)).filter(Boolean);
  if(certifications.length){section("Certifications","education",spec.leading);for(const item of certifications)bullet(item);}
  // No invented Professional Highlights, environment rows, or extra footer absent from references.
  doc.end();
  return complete;
}
