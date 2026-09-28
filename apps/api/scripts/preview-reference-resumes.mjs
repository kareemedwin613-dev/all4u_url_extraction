import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { renderTailoredResumePdf } from "../dist/platform/tailored-resume-pdf.renderer.js";
import { REFERENCE_RESUME_LAYOUTS } from "../dist/platform/reference-resume-templates.js";
import { referenceResumeFixture } from "../test/fixtures/reference-resume.mjs";

const root=fileURLToPath(new URL("../../../",import.meta.url)),output=resolve(root,"artifacts/template-previews");
await mkdir(output,{recursive:true});
const report=[];
for(const layout of REFERENCE_RESUME_LAYOUTS)for(const long of [false,true]){
  const name=`${layout.key}-${long?"long":"short"}`,bytes=await renderTailoredResumePdf({...referenceResumeFixture(long),renderTemplateKey:layout.key});
  await writeFile(resolve(output,`${name}.pdf`),bytes);
  const pdf=await getDocument({data:new Uint8Array(bytes)}).promise,pages=[];
  for(let n=1;n<=pdf.numPages;n++){
    const page=await pdf.getPage(n),viewport=page.getViewport({scale:1}),canvas=createCanvas(viewport.width,viewport.height);
    await page.render({canvasContext:canvas.getContext("2d"),viewport}).promise;pages.push(canvas);
  }
  const cols=Math.min(2,pages.length),sheet=createCanvas(cols*624,Math.ceil(pages.length/cols)*804),ctx=sheet.getContext("2d");
  ctx.fillStyle="#cccccc";ctx.fillRect(0,0,sheet.width,sheet.height);
  pages.forEach((page,index)=>ctx.drawImage(page,index%cols*624,Math.floor(index/cols)*804));
  await writeFile(resolve(output,`${name}.png`),sheet.toBuffer("image/png"));
  report.push({template:layout.key,variant:long?"long":"short",pages:pdf.numPages,bytes:bytes.length});await pdf.destroy();
}
await writeFile(resolve(output,"report.json"),JSON.stringify(report,null,2)+"\n");
console.log(`Generated 12 synthetic PDF previews and page contact sheets in ${output}`);
console.table(report);
