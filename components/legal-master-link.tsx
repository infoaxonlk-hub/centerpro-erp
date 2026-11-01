"use client";
import Link from "next/link";
import {legalText} from "@/lib/legal-messages";
export function LegalMasterLink({href}:{href:string}){return <Link className="soft" href={href}>{legalText("en","link")}</Link>;}
