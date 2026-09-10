"use client";

import { useState, useTransition } from "react";
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
import { companySizes, contactTopics, site } from "@/config/marketing";
import { submitContactAction } from "@/lib/actions/contact";
import { contactSchema, type ContactInput } from "@/lib/marketing/schema";

/**
 * The public enquiry form (design spec §26, §27, §28).
 *
 * Product form conventions, unchanged: label above the field, one column, the
 * error under the field it belongs to, and the submit button full width on the
 * narrow layout. A visitor who later becomes a user has already met the form
 * design they will work in every day.
 */
export function ContactForm() {
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ContactInput>({
    resolver: zodResolver(contactSchema),
    defaultValues: {
      name: "",
      email: "",
      company: "",
      size: companySizes[1].value,
      topic: contactTopics[0].value,
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
        <h2 className="mt-5 font-serif text-section text-fg">Message received.</h2>
        <p className="mt-2 max-w-md text-body leading-relaxed text-fg-muted">
          {site.contact.replyTime} If it is urgent, write to{" "}
          <a
            href={`mailto:${site.contact.sales}`}
            className="text-accent-strong underline underline-offset-4"
          >
            {site.contact.sales}
          </a>{" "}
          and it will reach the same people.
        </p>
        <Button variant="secondary" size="md" className="mt-6" onClick={() => setSent(false)}>
          Send another message
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
          <Label htmlFor="contact-name">Name</Label>
          <Input
            id="contact-name"
            autoComplete="name"
            placeholder="Sofia Almeida"
            aria-invalid={Boolean(errors.name)}
            {...register("name")}
          />
          {errors.name ? <p className="text-meta text-danger-strong">{errors.name.message}</p> : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="contact-email">Work email</Label>
          <Input
            id="contact-email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
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
          <Label htmlFor="contact-company">Company</Label>
          <Input
            id="contact-company"
            autoComplete="organization"
            placeholder="Meridian Construction"
            aria-invalid={Boolean(errors.company)}
            {...register("company")}
          />
          {errors.company ? (
            <p className="text-meta text-danger-strong">{errors.company.message}</p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="contact-size">Company size</Label>
          <Controller
            control={control}
            name="size"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="contact-size" className="h-10">
                  <SelectValue placeholder="Choose a size" />
                </SelectTrigger>
                <SelectContent>
                  {companySizes.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="contact-topic">What is this about?</Label>
        <Controller
          control={control}
          name="topic"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="contact-topic" className="h-10">
                <SelectValue placeholder="Choose a topic" />
              </SelectTrigger>
              <SelectContent>
                {contactTopics.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="contact-message">Message</Label>
        <Textarea
          id="contact-message"
          rows={5}
          placeholder="What do you build, how many people need access, and what are you using today?"
          aria-invalid={Boolean(errors.message)}
          {...register("message")}
        />
        {errors.message ? (
          <p className="text-meta text-danger-strong">{errors.message.message}</p>
        ) : null}
      </div>

      {/* Honeypot — hidden from people, and never announced. */}
      <div aria-hidden="true" className="hidden">
        <label htmlFor="contact-website">Website</label>
        <input id="contact-website" type="text" tabIndex={-1} autoComplete="off" {...register("website")} />
      </div>

      <div className="flex flex-wrap items-center gap-4 pt-1">
        <Button type="submit" size="lg" disabled={isPending} className="w-full sm:w-auto">
          {isPending ? "Sending…" : "Send message"}
        </Button>
        <p className="text-meta text-fg-subtle">{site.contact.replyTime}</p>
      </div>
    </form>
  );
}
