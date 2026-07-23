import { AppError,safeError } from "../shared/errors.js";
export async function signIn(client,email,password){const {data,error}=await client.auth.signInWithPassword({email:String(email).trim(),password});if(error)throw new AppError("INVALID_CREDENTIALS","The email or password is incorrect.");return data;}
export async function signOut(client){const {error}=await client.auth.signOut();if(error)throw safeError(error,"SIGN_OUT_FAILED","Sign out could not be completed.");}
export async function currentSession(client){const {data,error}=await client.auth.getSession();if(error)throw safeError(error,"SESSION_EXPIRED","Your session could not be restored.");return data.session;}
