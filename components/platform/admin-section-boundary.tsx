"use client";

import * as React from "react";

import { useRouter } from "@/components/navigation/guarded-router";
import { Button } from "@/components/ui/button";

type State = { failed: boolean };

/**
 * Keeps one failed Dashboard section from taking the page with it (Dashboard
 * PRD §44, §79): the section says it could not load and offers Retry, which
 * refetches the page's server data; the other sections stay as they are.
 */
class Boundary extends React.Component<{ title: string; onRetry: () => void; children: React.ReactNode }, State> {
  state: State = { failed: false };
  static getDerivedStateFromError(): State { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface-muted px-4 py-3 text-table text-fg-muted">
        <span>Unable to load {this.props.title.toLowerCase()}.</span>
        <Button size="sm" variant="secondary" onClick={() => { this.setState({ failed: false }); this.props.onRetry(); }}>Retry</Button>
      </div>
    );
  }
}

export function AdminSectionBoundary({ title, children }: { title: string; children: React.ReactNode }) {
  const router = useRouter();
  return <Boundary title={title} onRetry={() => router.refresh()}>{children}</Boundary>;
}
