type AuthFailure={status?:number;name?:string;code?:string};
// A temporary Auth outage/rate limit is not evidence that the user signed out.
export function sessionFailureStatus(error:AuthFailure|null|undefined):401|503{
 if(!error)return 401;
 if(error.name==="AuthSessionMissingError"||error.status===401||error.status===403||["session_not_found","session_expired","refresh_token_not_found","refresh_token_already_used","bad_jwt"].includes(error.code??""))return 401;
 return 503;
}
