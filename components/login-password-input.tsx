"use client";
import {useState} from "react";
import {Eye,EyeOff,LockKeyhole} from "lucide-react";
export function LoginPasswordInput(){
 const[visible,setVisible]=useState(false);
 const Icon=visible?EyeOff:Eye;
 return <div className="login-input-wrap"><LockKeyhole size={18} aria-hidden="true"/><input id="login-password" name="password" type={visible?"text":"password"} placeholder="Enter your password" autoComplete="current-password" required/><button type="button" className="login-password-toggle" aria-label={visible?"Hide password":"Show password"} aria-pressed={visible} aria-controls="login-password" onClick={()=>setVisible(value=>!value)}><Icon size={17} aria-hidden="true"/></button></div>;
}
