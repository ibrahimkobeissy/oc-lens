"use client";

import { Archive, Bot, Brain, CircleAlert, Network, PackageOpen } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { SessionSummary } from "@/types/oc";

export interface SessionBadgeEvidence {
  key: string;
  label: string;
  evidence: string;
  tone: "outline" | "secondary" | "destructive";
  icon: typeof Brain;
}

export function sessionBadgeEvidence(session: SessionSummary): SessionBadgeEvidence[] {
  const badges: SessionBadgeEvidence[] = [];
  if (session.hasReasoning) badges.push({ key: "reasoning", label: "Reasoning", evidence: "At least one reasoning part was recorded.", tone: "secondary", icon: Brain });
  if (session.hasCompaction) badges.push({ key: "compaction", label: "Compacted", evidence: "At least one verified compaction part was recorded.", tone: "secondary", icon: PackageOpen });
  if (session.usesMcp) badges.push({ key: "mcp", label: "MCP", evidence: "At least one tool call resolved to a configured MCP server.", tone: "outline", icon: Network });
  if (session.parentId !== null) badges.push({ key: "subagent", label: "Subagent", evidence: `This session records parent session ${session.parentId}.`, tone: "outline", icon: Bot });
  if (session.errorCount > 0) badges.push({ key: "errors", label: `${session.errorCount} error${session.errorCount === 1 ? "" : "s"}`, evidence: `${session.errorCount} tool call${session.errorCount === 1 ? "" : "s"} failed.`, tone: "destructive", icon: CircleAlert });
  if (session.timeArchived !== null) badges.push({ key: "archived", label: "Archived", evidence: `Archived at ${new Date(session.timeArchived).toLocaleString()}.`, tone: "outline", icon: Archive });
  return badges;
}

export function SessionBadges({ session }: { session: SessionSummary }) {
  const badges = sessionBadgeEvidence(session);
  if (badges.length === 0) return null;
  return (
    <TooltipProvider>
      <div className="flex flex-wrap gap-1" aria-label="Session evidence badges">
        {badges.map((badge) => {
          const Icon = badge.icon;
          return (
            <Tooltip key={badge.key}>
              <TooltipTrigger asChild>
                <Badge variant={badge.tone} aria-label={`${badge.label}: ${badge.evidence}`} className="cursor-help">
                  <Icon aria-hidden="true" />{badge.label}
                </Badge>
              </TooltipTrigger>
              <TooltipContent><p>{badge.evidence}</p></TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
