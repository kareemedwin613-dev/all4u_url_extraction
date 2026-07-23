import {normalizeError} from "../shared/errors.js";
export async function getSession(client){const {data,error}=await client.auth.getSession();if(error)throw normalizeError(error,"Unable to restore your session.");return data.session;}
export async function signIn(client,email,password){const {data,error}=await client.auth.signInWithPassword({email:email.trim(),password});if(error){if(/invalid login credentials/i.test(error.message))throw {code:"AUTH_INVALID_CREDENTIALS",message:"The email or password is incorrect.",retryable:false};throw normalizeError(error,"Unable to sign in.");}return data.session;}
export async function signOut(client){const {error}=await client.auth.signOut();if(error)throw normalizeError(error,"Unable to sign out.");}
