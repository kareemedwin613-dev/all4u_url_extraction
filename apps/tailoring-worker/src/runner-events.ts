export function workerEvent(event:string,fields:Record<string,unknown>={}){
  const value={type:"worker.event",event,...fields};
  try{if(process.connected)process.send?.(value);}catch{/* The supervisor may have stopped. */}
  process.stdout.write(`${JSON.stringify({event,...fields,timestamp:new Date().toISOString()})}\n`);
}
export function workerResult(status:string,fields:Record<string,unknown>={}){
  try{if(process.connected)process.send?.({type:"worker.result",status,...fields});}catch{/* Best effort on shutdown. */}
}
export function workerFailure(error:any){
  const code=typeof error?.code==="string"&&/^[A-Z][A-Z0-9_]{0,79}$/.test(error.code)?error.code:"TAILORING_WORKER_ERROR";
  return{code,retryable:error?.retryable===true};
}
