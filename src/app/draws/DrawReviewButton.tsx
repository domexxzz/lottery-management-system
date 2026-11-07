"use client";

import { useRouter } from "next/navigation";

export function DrawReviewButton({ href, label, drawName }: { href: string; label: string; drawName: string }) {
  const router = useRouter();

  return (
    <button
      type="button"
      className="draw-review-button"
      aria-label={`${label}งวด ${drawName}`}
      onClick={() => router.push(href)}
    >
      <span aria-hidden="true">✓</span>
      {label}
    </button>
  );
}
