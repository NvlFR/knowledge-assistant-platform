"use client";

import Image from "next/image";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

// The purple mark (light) is a square icon; the white mark (dark) is a full
// wordmark that already contains the product name, so we swap layout with it.
export function BrandLogo({ size = "sm" }: { size?: "sm" | "lg" }) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDark = mounted && resolvedTheme === "dark";
  const className = size === "lg" ? "mx-auto h-12 w-auto" : "h-7 w-auto";

  return isDark ? (
    <Image
      src="/ai-logo-text-white.svg"
      alt="Knowledge Assistant"
      width={246}
      height={83}
      className={className}
      priority
    />
  ) : (
    <Image
      src="/ai-logo-purple.png"
      alt="Knowledge Assistant"
      width={246}
      height={83}
      className={className}
      priority
    />
  );
}
