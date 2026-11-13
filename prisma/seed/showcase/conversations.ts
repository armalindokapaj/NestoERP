/**
 * The conversations the selling demo opens on: a thread on each project,
 * people writing to each other and @mentioning colleagues (2026-11-13).
 *
 * `{0}`, `{1}` in a text are the people in `mentions`, in order — written as
 * the comment editor writes a mention. Every author and everyone mentioned is
 * a member of the project's company. Invented content.
 */

export type ShowcaseComment = { author: string; daysAgo: number; text: string; mentions: string[] };
export type ShowcaseConversation = { projectId: string; comments: ShowcaseComment[] };

export const SHOWCASE_CONVERSATIONS: ShowcaseConversation[] = [
  {
    // Kalaja Residence — Arvela Ndërtim
    projectId: "project_a",
    comments: [
      { author: "user_pm", daysAgo: 9, mentions: ["user_engineer"], text: "Block B level 7 slab poured this morning. {0} can you confirm the formwork strike times before Monday?" },
      { author: "user_engineer", daysAgo: 9, mentions: ["user_pm"], text: "{0} seven days at these temperatures. I'll put the cube results in the daily log tomorrow." },
      { author: "user_architect", daysAgo: 6, mentions: ["user_ceo", "user_owner"], text: "The facade mock-up on the street side is ready for review on site. {0} {1} does Thursday 10:00 work?" },
      { author: "user_ceo", daysAgo: 6, mentions: ["user_sales"], text: "Thursday is fine. {0} bring the two buyers who asked about the corner apartments." },
      { author: "user_sales", daysAgo: 5, mentions: [], text: "Both confirmed. Reservation forms are ready in case they decide on the day." },
      { author: "user_finance_a", daysAgo: 3, mentions: ["user_pm"], text: "{0} last week's steel invoice is 3% over the commitment. Can you approve the variation, or should I hold it?" },
      { author: "user_pm", daysAgo: 2, mentions: ["user_finance_a"], text: "{0} approved. It's the extra reinforcement on the transfer level; the variation is with procurement." },
    ],
  },
  {
    // Porta Tower — Arvela Developments
    projectId: "project_b",
    comments: [
      { author: "user_pm_b", daysAgo: 8, mentions: ["user_qaqc_b"], text: "Ground-floor lobby handed over to the fit-out contractor today. {0} please book the waterproofing inspection on the podium." },
      { author: "user_qaqc_b", daysAgo: 8, mentions: ["user_pm_b"], text: "{0} booked for Wednesday 9:00. If the membrane overlaps aren't fixed by then I'll raise an NCR." },
      { author: "user_architecture_manager_b", daysAgo: 5, mentions: ["user_sales_manager"], text: "Floors 9–11 are re-planned as smaller office suites, as leasing asked. {0} do they match what tenants want?" },
      { author: "user_sales_manager", daysAgo: 4, mentions: ["user_architecture_manager_b"], text: "{0} that's the mix. Three of the new suites already have tenants waiting." },
      { author: "user_ceo_b", daysAgo: 1, mentions: ["user_finance_b"], text: "Good week on site. {0} send me the cash-flow update before Friday's board meeting." },
    ],
  },
  {
    // Nyja Logistics Park — Arvela Infrastruktura
    projectId: "project_c",
    comments: [
      { author: "user_pm_c", daysAgo: 10, mentions: ["user_engineer_c"], text: "Yard excavation finished two days ahead of plan. {0} the piling rig arrives Monday." },
      { author: "user_engineer_c", daysAgo: 9, mentions: ["user_pm_c"], text: "{0} the test pile results are fine; we keep the original pile length." },
      { author: "user_hse_c", daysAgo: 6, mentions: ["user_pm_c"], text: "Toolbox talk on excavation edges done with every crew. {0} we need two more barriers on the north side before the rain." },
      { author: "user_pm_c", daysAgo: 6, mentions: ["user_hse_c"], text: "{0} ordered; they're on site tomorrow morning." },
      { author: "user_ceo_c", daysAgo: 2, mentions: ["user_finance_c", "user_finance"], text: "{0} please prepare the phase 2 budget forecast. I'd like to go through it with {1} next week." },
    ],
  },
  {
    // Lungomare Apartments — Arvela Inxhinieri
    projectId: "project_d",
    comments: [
      { author: "user_pm_d", daysAgo: 7, mentions: ["user_qaqc_d"], text: "Block B core reached level 8. {0} pour inspection for level 9 tomorrow at 8:00?" },
      { author: "user_qaqc_d", daysAgo: 7, mentions: ["user_pm_d"], text: "{0} confirmed, I'll be there at 7:45." },
      { author: "user_architect_d", daysAgo: 4, mentions: ["user_multicompany"], text: "{0} can you take the lobby interiors while I finish the promenade details?" },
      { author: "user_multicompany", daysAgo: 4, mentions: ["user_architect_d"], text: "{0} yes. First options on Friday." },
      { author: "user_ceo_d", daysAgo: 1, mentions: ["user_finance_manager_d"], text: "{0} the bank needs the updated drawdown schedule this week." },
    ],
  },
  {
    // Ksamil Bay Hotel & Residences — Arvela Hospitality
    projectId: "project_e",
    comments: [
      { author: "user_pm_e", daysAgo: 9, mentions: ["user_hse_e"], text: "Residence foundations 1–4 complete. {0} the coastal access road needs a traffic plan before the concrete trucks start." },
      { author: "user_hse_e", daysAgo: 8, mentions: ["user_pm_e", "user_hse"], text: "{0} the plan is in Documents. {1} please sign it off." },
      { author: "user_legal_manager_e", daysAgo: 5, mentions: ["user_ceo_e"], text: "The hotel operator's lawyers sent back the management agreement. {0} two clauses need your decision." },
      { author: "user_ceo_e", daysAgo: 5, mentions: ["user_legal_manager_e"], text: "{0} let's go through them tomorrow at 11:00." },
      { author: "user_sales_e", daysAgo: 2, mentions: ["user_ceo_e"], text: "Six new residence reservations this month, most of them from buyers abroad. {0} the price list for the second release is ready for your review." },
    ],
  },
];
