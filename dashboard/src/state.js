export const state={client:null,session:null,categories:null,lastJobsHash:"#/jobs",lastResumesHash:"#/resumes",requestId:0};
export function clearBusinessState(){state.categories=null;state.requestId++;state.lastJobsHash="#/jobs";state.lastResumesHash="#/resumes";}
