import * as React from "react";
import Link from "next/link";

import { parseBody, type Inline } from "@/lib/modules/announcements/announcement.body";
import { cn } from "@/lib/utils/cn";

/**
 * An announcement body as editorial text (PRD #45 §17, §62, §206). Every node
 * is a React element built from the parsed tree: markup a person typed is
 * shown as the characters they typed, and only safe links become links.
 */

function InlineNodes({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((node, index) => {
        switch (node.type) {
          case "text":
            return <React.Fragment key={index}>{node.text}</React.Fragment>;
          case "strong":
            return (
              <strong key={index} className="font-semibold text-fg">
                <InlineNodes nodes={node.children} />
              </strong>
            );
          case "em":
            return (
              <em key={index}>
                <InlineNodes nodes={node.children} />
              </em>
            );
          case "link":
            return node.href.startsWith("/") ? (
              <Link key={index} href={node.href} className="font-medium text-accent-strong underline decoration-accent/30 underline-offset-2 hover:decoration-accent">
                <InlineNodes nodes={node.children} />
              </Link>
            ) : (
              <a key={index} href={node.href} target="_blank" rel="noopener noreferrer nofollow" className="font-medium text-accent-strong underline decoration-accent/30 underline-offset-2 hover:decoration-accent">
                <InlineNodes nodes={node.children} />
              </a>
            );
        }
      })}
    </>
  );
}

export function AnnouncementBody({ body, className }: { body: string; className?: string }) {
  const blocks = parseBody(body);
  return (
    <div className={cn("space-y-4 text-[15.5px] leading-7 text-fg/90", className)} data-testid="announcement-body">
      {blocks.map((block, index) => {
        switch (block.type) {
          case "heading": {
            const Tag = block.level === 1 ? "h2" : block.level === 2 ? "h3" : "h4";
            return (
              <Tag key={index} className={cn("pt-2 font-semibold tracking-tight text-fg", block.level === 1 ? "text-section" : block.level === 2 ? "text-card" : "text-body")}>
                <InlineNodes nodes={block.children} />
              </Tag>
            );
          }
          case "paragraph":
            return (
              <p key={index}>
                <InlineNodes nodes={block.children} />
              </p>
            );
          case "list": {
            const Tag = block.ordered ? "ol" : "ul";
            return (
              <Tag key={index} className={cn("space-y-1.5 pl-6", block.ordered ? "list-decimal" : "list-disc marker:text-fg-subtle")}>
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex} className="pl-1">
                    <InlineNodes nodes={item} />
                  </li>
                ))}
              </Tag>
            );
          }
          case "callout":
            return (
              <p key={index} className="rounded-lg border-l-2 border-accent/60 bg-accent-soft/40 px-4 py-3 text-fg">
                <InlineNodes nodes={block.children} />
              </p>
            );
        }
      })}
    </div>
  );
}
