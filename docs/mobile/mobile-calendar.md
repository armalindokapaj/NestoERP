# Mobile calendar (MOB-06)

`/calendar` uses the provider aggregator. Phones default to **Agenda**; Month, Week and Day are available. Every event links to its canonical record (`event.href`).

My Day reads the aggregator with `myOnly` for today and tomorrow in the company's time zone, so "today" is the company's day. In the Group workspace events are not read (they belong to one company) and My Day says to open a company.
