const MAX_TAILORING_CONCURRENCY=3;

export function tailoringBatchConcurrency(cliValue?:string,environment:NodeJS.ProcessEnv=process.env){
  const raw=String(cliValue||environment.TAILORING_BATCH_CONCURRENCY||"2").trim();
  if(!/^[1-3]$/.test(raw))throw new Error(`Tailoring batch concurrency must be between 1 and ${MAX_TAILORING_CONCURRENCY}.`);
  return Number(raw);
}
