"use client";

import { useMemo, useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { companySizes, contactTopics, siteContact } from "@/config/marketing";
import { submitContactAction } from "@/lib/actions/contact";
import type { SiteCopy } from "@/lib/i18n/site";
import { createContactSchema, type ContactInput } from "@/lib/marketing/schema";

/**
 * The public enquiry form (design spec §26, §27, §28).
 *
 * Product form conventions, unchanged: label above the field, one column, the
 * error under the field it belongs to, and the submit button full width on the
 * narrow layout. A visitor who later becomes a user has already met the form
 * design they will work in every day.
 *
 * Its words, validation messages included, come from the server page in the
 * reader's language.
 */
export function ContactForm({
  copy,
  replyTime,
}: {
  copy: SiteCopy["contact"]["form"];
  replyTime: string;
}) {
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const schema = useMemo(() => createContactSchema(copy.errors), [copy.errors]);

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ContactInput>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      email: "",
      company: "",
      size: companySizes[1],
      topic: contactTopics[0],
      message: "",
      website: "",
    },
  });

  const onSubmit = handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const result = await submitContactAction(values);
      if (result.ok) {
        reset();
        setSent(true);
      } else {
        setFormError(result.error);
      }
    });
  });

  if (sent) {
    return (
      <div className="nesto-card p-6 sm:p-8">
        <span
          aria-hidden="true"
          className="grid size-10 place-items-center rounded-full bg-success-soft text-success-strong"
        >
          <Check className="size-5" />
        </span>
        <h2 className="mt-5 font-serif text-section text-fg">{copy.sentTitle}</h2>
        <p className="mt-2 max-w-md text-body leading-relaxed text-fg-muted">
          {replyTime} {copy.urgentBefore}{" "}
          <a
            href={`mailto:${siteContact.sales}`}
            className="text-accent-strong underline underline-offset-4"
          >
            {siteContact.sales}
          </a>{" "}
          {copy.urgentAfter}
        </p>
        <Button variant="secondary" size="md" className="mt-6" onClick={() => setSent(false)}>
          {copy.sendAnother}
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="nesto-card space-y-5 p-6 sm:p-8" noValidate>
      {formError ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-danger/25 bg-danger-soft px-3 py-2.5 text-table text-danger-strong"
        >
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{formError}</span>
        </div>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="contact-name">{copy.name}</Label>
          <Input
            id="contact-name"
            autoComplete="name"
            placeholder={copy.namePlaceholder}
            aria-invalid={Boolean(errors.name)}
            {...register("name")}
          />
          {errors.name ? <p className="text-meta text-danger-strong">{errors.name.message}</p> : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="contact-email">{copy.email}</Label>
          <Input
            id="contact-email"
            type="email"
            autoComplete="email"
            placeholder={copy.emailPlaceholder}
            aria-invalid={Boolean(errors.email)}
            {...register("email")}
          />
          {errors.email ? (
            <p className="text-meta text-danger-strong">{errors.email.message}</p>
          ) : null}
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="contact-company">{copy.company}</Label>
          <Input
            id="contact-company"
            autoComplete="organization"
            placeholder={copy.companyPlaceholder}
            aria-invalid={Boolean(errors.company)}
            {...register("company")}
          />
          {errors.company ? (
            <p className="text-meta text-danger-strong">{errors.company.message}</p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="contact-size">{copy.size}</Label>
          <Controller
            control={control}
            name="size"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="contact-size" className="h-10">
                  <SelectValue placeholder={copy.sizePlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  {companySizes.map((option) => (
                    <SelectItem key={option} value={option}>
                      {copy.sizes[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="contact-topic">{copy.topic}</Label>
        <Controller
          control={control}
          name="topic"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="contact-topic" className="h-10">
                <SelectValue placeholder={copy.topicPlaceholder} />
              </SelectTrigger>
              <SelectContent>
                {contactTopics.map((option) => (
                  <SelectItem key={option} value={option}>
                    {copy.topics[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="contact-message">{copy.message}</Label>
        <Textarea
          id="contact-message"
          rows={5}
          placeholder={copy.messagePlaceholder}
          aria-invalid={Boolean(errors.message)}
          {...register("message")}
        />
        {errors.message ? (
          <p className="text-meta text-danger-strong">{errors.message.message}</p>
        ) : null}
      </div>

      {/* Honeypot — hidden from people, and never announced. */}
      <div aria-hidden="true" className="hidden">
        <label htmlFor="contact-website">{copy.website}</label>
        <input id="contact-website" type="text" tabIndex={-1} autoComplete="off" {...register("website")} />
      </div>

      <div className="flex flex-wrap items-center gap-4 pt-1">
        <Button type="submit" size="lg" disabled={isPending} className="w-full sm:w-auto">
          {isPending ? copy.sending : copy.submit}
        </Button>
        <p className="text-meta text-fg-subtle">{replyTime}</p>
      </div>
    </form>
  );
}
