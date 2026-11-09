"use client";
import type {ReactNode} from "react";

export default function AnimatedCollapse({open,id,className="",children}:{open:boolean;id?:string;className?:string;children:ReactNode}) {
  return <div id={id} className={`animated-collapse ${open?"is-open":""} ${className}`} aria-hidden={!open} inert={!open?true:undefined}>
    <div className="animated-collapse-inner">{children}</div>
  </div>;
}
