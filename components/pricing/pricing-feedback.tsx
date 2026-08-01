"use client";

import { CheckCircle2, CircleAlert, X } from "lucide-react";

import { Button } from "@/components/ui/button";

export interface PricingNotice {
  kind: "success" | "error";
  message: string;
}

export function PricingFeedback({ notice, onDismiss }: { notice: PricingNotice | null; onDismiss: () => void }) {
  if (!notice) return null;
  const Icon = notice.kind === "success" ? CheckCircle2 : CircleAlert;
  return (
    <div role={notice.kind === "error" ? "alert" : "status"} aria-live="polite" className={`fixed bottom-16 right-4 z-50 flex max-w-sm items-start gap-2 rounded-lg border bg-background p-3 shadow-lg md:bottom-4 ${notice.kind === "error" ? "border-destructive/50" : "border-success/50"}`}>
      <Icon aria-hidden="true" className={`mt-0.5 size-4 shrink-0 ${notice.kind === "error" ? "text-destructive" : "text-success"}`} />
      <p className="flex-1 text-sm text-foreground">{notice.message}</p>
      <Button type="button" variant="ghost" size="icon-xs" aria-label="Dismiss pricing notification" onClick={onDismiss}><X aria-hidden="true" /></Button>
    </div>
  );
}
