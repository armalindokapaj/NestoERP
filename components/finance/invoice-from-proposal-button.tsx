"use client";

import * as React from "react";
import { Receipt } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { invoiceFromProposalAction } from "@/lib/actions/finance";

/**
 * Raises the invoice and follows it (PRD #35 §180).
 *
 * The action redirects to the new invoice on success, so there is nothing to
 * report here except a refusal — a proposal that is no longer accepted, or a
 * permission that has changed since the page was rendered.
 */
export function InvoiceFromProposalButton({
  proposalId,
  label,
}: {
  proposalId: string;
  label: string;
}) {
  const toast = useToast();
  const [pending, startTransition] = React.useTransition();

  function raise() {
    startTransition(async () => {
      const result = await invoiceFromProposalAction(proposalId);
      // Only reached when the service refused; success redirects.
      if (result && !result.ok) toast({ title: result.error, tone: "danger" });
    });
  }

  return (
    <Button size="sm" variant="secondary" disabled={pending} onClick={raise}>
      <Receipt aria-hidden="true" />
      {pending ? "Raising…" : label}
    </Button>
  );
}
