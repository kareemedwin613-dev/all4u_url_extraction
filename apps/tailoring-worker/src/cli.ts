import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadFixture, runTailoringProof } from "./codex-runner.js";

function argumentsFrom(values:string[]){
  const result:Record<string,string|boolean>={};
  for(let index=0;index<values.length;index++){
    const value=values[index];
    if(value==="--keep-workspace")result.keepWorkspace=true;
    else if(value.startsWith("--")){const next=values[index+1];if(!next||next.startsWith("--"))throw new Error(`${value} requires a value.`);result[value.slice(2)]=next;index++;}
    else throw new Error(`Unknown argument: ${value}.`);
  }
  return result;
}

async function main(){
  const args=argumentsFrom(process.argv.slice(2)),fixture=String(args.fixture||""),applicationId=String(args["application-id"]||""),output=String(args.output||"");
  if(!fixture||!applicationId||!output)throw new Error("Usage: npm run proof -- --fixture <file> --application-id <uuid> --output <new-json-file> [--keep-workspace]");
  const invocationDirectory=resolve(process.env.INIT_CWD||process.cwd()),fixturePath=resolve(invocationDirectory,fixture),outputPath=resolve(invocationDirectory,output);
  await mkdir(dirname(outputPath),{recursive:true});
  const preview=await runTailoringProof(await loadFixture(fixturePath,applicationId),{outputPath,keepWorkspace:Boolean(args.keepWorkspace)});
  process.stdout.write(`Tailoring preview created for Application #${preview.applicationNumber} from Resume #${preview.sourceResumeNumber}: ${outputPath}\n`);
}

main().catch(error=>{process.stderr.write(`${error instanceof Error?error.message:String(error)}\n`);process.exitCode=1;});
