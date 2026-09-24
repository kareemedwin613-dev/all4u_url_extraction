import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { promptTestRequest } from "./api-client.js";
import { runTailoringProof } from "./codex-runner.js";

export async function runPromptTest(apiBaseUrl:string,ticket:string,outputPath:string,
  dependencies:{request?:typeof promptTestRequest;generate?:typeof runTailoringProof}={}){
  const request=dependencies.request||promptTestRequest;
  const claim=await request(apiBaseUrl,ticket,"CLAIM");
  try{
    if(claim.input?.promptSnapshot?.isTest!==true)throw new Error("Expected an isolated draft-test snapshot.");
    await mkdir(dirname(outputPath),{recursive:true});
    const preview=await(dependencies.generate||runTailoringProof)(claim.input,{outputPath});
    const receipt=await request(apiBaseUrl,ticket,"SUBMIT",{result:preview.result});
    // Deliberately no materialization, assignment, or evaluation here.
    return receipt;
  }catch(error){
    await request(apiBaseUrl,ticket,"FAIL",{failureCode:"PROMPT_TEST_FAILED"}).catch(()=>undefined);
    throw error;
  }
}
