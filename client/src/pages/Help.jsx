import React from 'react';

const PAGES = [
  {
    title: 'Dashboard',
    items: [
      ['Transfer to Revolut', 'The amount that should move from your bank account(s) to your spending card this month — the sum of every budget line tagged to the card account. This is your main operational number.'],
      ['Income (actual)', 'Real income for the month, from the Income page. The projection uses these figures, not assumptions.'],
      ['Planned / Actual spend', 'What you budgeted vs. what actually happened. Actual is net of refunds — a return reduces the spend of its category.'],
      ['Month result', 'One figure for the whole month: planned minus actual, covering all seven groups including Savings.'],
      ['Warnings', 'Untagged categories (spending on them reaches no account total) and transactions that still need a category.'],
      ['Insights', 'Generated cards: review backlog, categories over budget, spending ahead of the month\u2019s pace, fund goals behind or overdue, and recurring items due within seven days. They never change your data — the link opens the relevant page.'],
      ['Alerts pill', 'The count beside the month selector is the number of current insight cards.'],
      ['Category tables', 'Grouped by block (Housing, Food, …). Difference = planned − actual. Positive means under budget.'],
      ['← / Today / →', 'Move between months. All figures on the page follow the selected month.'],
    ],
  },
  {
    title: 'Import',
    items: [
      ['Choose CSV / XLSX file', 'Standard import for Revolut-style exports. Handles the ".csv that is really Excel" quirk, keeps only COMPLETED rows, treats pendings from previous months as completed, skips current-month pendings and REVERTED rows, and blocks duplicates (same date + amount + description).'],
      ['Analyze format with AI', 'For any other bank export: the AI inspects the raw file, detects columns, date format and decimal style, and converts it to the standard schema. You always see a full preview before anything is saved.'],
      ['Import into account', 'Pick which account the statement belongs to (usually Revolut).'],
      ['Confirm import', 'Writes the previewed transactions to your database. Nothing is saved before this.'],
    ],
  },
  {
    title: 'Transactions',
    items: [
      ['Month filter', 'Show only one month.'],
      ['Show needs-review only', 'Unknown merchants that the rules could not categorize.'],
      ['Assign category…', 'Pick a category for an unknown transaction — choosing one automatically creates a keyword rule, so the same merchant is categorized instantly next time (and old unmatched rows with the same name are fixed retroactively).'],
      ['Suggest categories with AI', 'The AI proposes a category + confidence for every pending transaction.'],
      ['Apply all / Apply ≥80%', 'Accept all suggestions, or only confident ones (80%+). Applied suggestions become learned rules too.'],
      ['Split', 'Divide one purchase across two or more categories (e.g. groceries + household). Parts must add up to the original. The original stops counting anywhere; only the parts do. Unsplit restores it.'],
      ['Paperclip / attachments', 'Attach receipts and documents to any transaction (PDF, PNG, JPEG, WebP, CSV; max 10 MB). Files live in data/uploads and stay on this machine.'],
    ],
  },
  {
    title: 'Budgets',
    items: [
      ['Standing plan', 'The normal monthly amount for a category. Used by every month unless overridden.'],
      ['Plan for <month>', 'A one-month override. The ↺ button removes it and falls back to the standing plan.'],
      ['Account column', 'Which account the category is paid from. Every category should have one — untagged spending disappears from account totals (the dashboard warns you).'],
      ['Roll over underspend', 'When enabled for a category, last month\u2019s unused plan carries into this month — but only if that month had actual activity in the category. Overspend never carries negative.'],
    ],
  },
  {
    title: 'Income',
    items: [
      ['Usual', 'The recurring amount used by the projection for months without an actual entry.'],
      ['Enter actual', 'The real income for that month. Actual income must be entered, never assumed — this is a deliberate rule of the system.'],
    ],
  },
  {
    title: 'Recurring',
    items: [
      ['What they are', 'Expected monthly transactions — rent, subscriptions, salary. Define them once with name, signed amount, day of month (1–28), account and category.'],
      ['Upcoming panel', 'Shows the next occurrences for this and next month; post one early with "Post now", or let it auto-post on its day. Duplicate posts are blocked automatically.'],
      ['Auto / manual toggle', 'Auto items post themselves when due. Pause hides an item from upcoming without deleting it.'],
    ],
  },
  {
    title: 'Funds (sinking funds)',
    items: [
      ['Balance', 'Opening balance + monthly contributions since the start month + recorded movements. Contributions accrue automatically every month; you only record withdrawals when a bill lands.'],
      ['Monthly contribution', 'How much accrues each month. Edit inline with the check button.'],
      ['In / Out', 'Record a one-off deposit or a withdrawal (the actual bill). A fund may go negative — that is a warning signal, never hidden.'],
    ],
  },
  {
    title: 'Commitments',
    items: [
      ['What they are', 'Fixed dated obligations: loans, instalments, kindergarten. Name, monthly amount, start month, end month.'],
      ['End column', 'The whole point: when a commitment ends, the projection automatically stops charging it, so you see the relief arrive. Edit the end month inline.'],
    ],
  },
  {
    title: 'Balances',
    items: [
      ['Record', 'Type in the real bank balance for an account and month.'],
      ['Reconciliation', 'The projection compares its prediction against your entry and shows the variance — then re-anchors to reality instead of letting drift compound silently.'],
    ],
  },
  {
    title: 'Projection',
    items: [
      ['How it works', 'Income minus outgoings rolled forward month by month. Outgoings = active commitments + category plans not already covered by a commitment (no double counting). Commitments drop out at their end dates.'],
      ['Free vs committed savings', 'Free = accumulated surplus, spendable. Committed = sitting in sinking funds, already spoken for by future bills.'],
    ],
  },
  {
    title: 'Reports',
    items: [
      ['Exports', 'Download any month or year as CSV or Excel (.xlsx). Excel workbooks include a transactions sheet plus summaries. Exports always show original statement amounts and currencies.'],
      ['Month-end history', 'When a month closes, it is snapshotted automatically — frozen forever, even if you later edit or delete its transactions. The chart tracks how your plan versus reality looked at each month\u2019s end.'],
    ],
  },
  {
    title: 'AI Chat',
    items: [
      ['Finance tab (read-only)', 'Ask about your data. The AI can only run read-only SELECT queries — it cannot change anything.'],
      ['Dev mode tab', 'The AI proposes changes (budgets, rules, commitments, funds, income, balances) from a fixed whitelist. Nothing is applied until you press Apply. No raw SQL, no deletions, everything logged in an audit trail.'],
      ['Requirements', 'Configure a provider + key + model on the Settings page first.'],
    ],
  },
  {
    title: 'Settings',
    items: [      ['Provider / API key / Model', 'Choose an AI provider, enter your key, load the models available to your key, pick one. Stored in your own database only.'],
      ['Test connection', 'Sends a trivial request to verify the setup works.'],
      ['Exchange rates', 'Monthly conversion rates from foreign currencies into your display currency. Fetch them from the ECB with one click or type any rate manually. Transactions without a rate count 1:1 and show a dashboard warning.'],
    ],
  },
  {
    title: 'Categories',
    items: [
      ['Account & group', 'Every category belongs to one group (budget block) and one account.'],
      ['Retire', 'Retiring a category clears its plan and rules so nothing phantom survives. Reactivate any time.'],
      ['Categorization rules', 'Learned automatically when you assign categories; you can also add keyword rules manually.'],
      ['Advanced rules', 'Combine conditions: description contains, absolute amount range, account, transaction type, priority. Higher priority wins. Retiring a category removes its rules too.'],
      ['Rule tester', 'Type a sample description/amount/type and see which rule would fire. Testing never writes anything.'],
    ],
  },
  {
    title: 'Accounts & users',
    items: [
      ['Accounts', 'You define your own accounts (e.g. a main bank account and a daily-spending card). Salaries land in the bank account; one monthly transfer funds the card — the Dashboard shows the exact amount.'],
      ['Add user', 'Each user gets a completely separate database. Use the sidebar button while logged in.'],
    ],
  },
];

export default function Help() {
  return (
    <div>
      <h1>Help</h1>
      <p className="muted">
        Short guide to every page and button. The full manual and the math behind the
        numbers live in <code>README.md</code> and <code>docs/</code> in the project folder.
      </p>
      {PAGES.map((p) => (
        <div key={p.title} className="help-section card" style={{ marginBottom: 14 }}>
          <h2>{p.title}</h2>
          {p.items.map(([name, desc]) => (
            <div key={name} className="help-item">
              <b>{name}</b>
              <span className="muted">{desc}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
