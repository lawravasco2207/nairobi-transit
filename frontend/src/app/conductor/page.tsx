"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Legacy route — redirects to /crew */
export default function ConductorRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/crew"); }, [router]);
  return null;
}
