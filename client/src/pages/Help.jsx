import { useState } from 'react';
import { Link } from 'react-router-dom';

const GITHUB = 'https://github.com/HamidrezaTg/gulden';

const SECTIONS = [
  {
    id: 'start',
    title: 'Start here',
    eyebrow: 'A reliable first setup',
    route: '/',
    summary:
      'Build the model before importing data. This prevents confusing totals and makes later automation useful.',
    steps: [
      'Create the first account on the server. The first account is the administrator; every later user receives a separate private budget database.',
      'Add the real bank, card, cash, and spending-pot accounts. Enter each opening balance and currency as of the date you begin tracking.',
      'Create budget groups and categories. Give spending categories a paying account and a standing monthly plan where appropriate.',
      'Add income sources, usual amounts, people, recurring items, funds, and commitments that affect your normal month.',
      'Import a statement, review unknown transactions, and reconcile observed account balances.',
      'Use Dashboard for the monthly check-in, then Projection and Reports for longer-term decisions.',
    ],
    notes: [
      'The server is the source of truth. Browsers, mobile apps, and desktop apps are clients that connect to it.',
      'The offline cache stores the application shell, not your financial data. A server outage does not delete your data.',
    ],
  },
  {
    id: 'navigation',
    title: 'Navigation and working month',
    eyebrow: 'Controls you use everywhere',
    route: '/',
    summary: 'The selected working month controls the period shown by most pages.',
    steps: [
      'Use the Working month selector in the sidebar to move through months. Dashboard, budgets, transactions, income, balances, and reports follow that selection.',
      'On mobile, open the menu from the top bar. On desktop, collapse the sidebar from the Gulden mark.',
      'Use the eye control to blur financial values in the current browser. Use the theme control to switch appearance; your selected theme is saved to your user account and follows you to other devices.',
      'Press ? for Help, or press g then d, t, or r for Dashboard, Transactions, or Reports. Shortcuts are disabled while typing.',
      'In a native client, use Switch server to change between saved server endpoints. HTTP is intended only for trusted LAN/VPN connections.',
    ],
    notes: [
      'Logging out ends the server session. It does not remove the local database or saved native server addresses.',
    ],
  },
  {
    id: 'accounts-categories',
    title: 'Accounts, people, and categories',
    eyebrow: 'Model your real money',
    route: '/accounts',
    summary:
      'Accounts say where money lives; categories say why it moves; people identify income sources.',
    steps: [
      'In Accounts, create bank, card, cash, or other accounts. Mark a spending pot when the account is used for day-to-day spending.',
      'Set the opening balance and account currency at the point tracking begins. Change it only when correcting the starting point, not to hide a later discrepancy.',
      'In Categories, organize categories into groups, choose a paying account, and add a standing plan. Categories may be left ungrouped or without an account, but the Dashboard will warn about missing account assignments.',
      'Retire a category when it should stop receiving new plans or rules. Its transaction history remains; its plan and categorization rules are cleared. Manage categorization rules separately on the Rules page. Reactivate a retired category when needed.',
      'Use People to connect an income source to a household member or other payer. Removing a person clears only that link.',
    ],
    notes: [
      'An account cannot be deleted while transactions or balance observations still reference it.',
    ],
  },
  {
    id: 'budgets-income',
    title: 'Budgets and income',
    eyebrow: 'Plan the month',
    route: '/budgets',
    summary:
      'Standing plans define normal spending; monthly overrides handle exceptions without changing the normal plan.',
    steps: [
      'Set a standing plan for each category that normally receives money.',
      'Use Plan for <month> for a one-month exception. The reset control removes the override and returns to the standing plan.',
      'Enable rollover when unused planned money should carry into a later month. Only qualifying underspend carries forward; overspend never becomes a negative rollover.',
      'On Income, set usual amounts for projection and enter actual income when it arrives. An actual monthly entry takes precedence over the usual amount.',
      'Review the Dashboard after changing plans. Positive planned-minus-actual difference means the category is under its plan.',
    ],
    notes: [
      'Budget, fund, commitment, and income planning figures use the global display currency.',
    ],
  },
  {
    id: 'rules',
    title: 'Categorization rules',
    eyebrow: 'Automate safely',
    route: '/rules',
    summary:
      'Use explicit rules for repeatable merchants while keeping ambiguous choices in review.',
    steps: [
      'Open Rules from the sidebar to create keyword, advanced, and category-choice rules.',
      'Use the search and filters to find rules by type, category, or enabled state.',
      'Disable an advanced or choice rule when it should stop matching without deleting its history.',
      'Use Rule tester to preview a match. Testing never changes transactions.',
    ],
    notes: [
      'Keyword rules are always enabled; learned rules can be removed from the transaction editor by unchecking Remember.',
    ],
  },
  {
    id: 'import',
    title: 'Import a bank statement',
    eyebrow: 'Bring in data safely',
    route: '/import',
    summary:
      'Import is a preview-first workflow. Nothing is written until you explicitly confirm it.',
    steps: [
      'Choose a CSV, XLS, XLSX, PDF, JPG, or PNG statement and select the account it belongs to. Revolut exports and CSV files containing Excel data are supported.',
      'Upload CSV or Excel runs built-in checks first. Clear exports can be imported directly; unfamiliar or ambiguous CSV/XLSX exports are staged and offer AI analysis without requiring another upload.',
      'Inspect the preview. Invalid rows show their source row and reason. Duplicates, cancelled rows, zero-value rows, and candidate transfer pairs are identified before saving.',
      'Confirm only after checking dates, signed amounts, currency, account, and duplicate counts. Confirmation is the only write step.',
      'Open Transactions and filter Needs review. Assign categories and resolve transfer candidates after import.',
    ],
    notes: [
      'Only explicitly cancelled rows are skipped. Zero-value, fee, refund, reverted, and pending rows remain available for review.',
      'Duplicate fingerprints use date, amount, description, and an occurrence index for legitimate identical same-day transactions. Changed merchant wording can still require manual review.',
      'Uploaded statement files are processed and removed. AI-approved CSV and XLSX mappings are saved privately per user, reused for matching files, and manageable from the Import page. PDF, JPG, and PNG text always goes through OCR and AI structuring before import.',
    ],
  },
  {
    id: 'transactions',
    title: 'Transactions, review, and attachments',
    eyebrow: 'Keep actuals accurate',
    route: '/transactions',
    summary:
      'Transactions are the actual record. Review unknown rows promptly so learned rules improve future imports.',
    steps: [
      'Filter by month or show only Needs review. Assigning a category can learn a keyword rule and retroactively fix matching unknown rows.',
      'Use the Rules page for description, absolute amount range, account, transaction type, and priority rules. The rule tester never changes data.',
      'Add a transaction manually when a statement is unavailable. Negative amounts normally represent spending; positive amounts represent income or refunds.',
      'Edit account, category, fund, commitment, description, or amount when a transaction needs correction. Delete only when the row is genuinely unwanted.',
      'Split a purchase across categories. Split amounts must equal the original signed amount; Unsplit restores the original transaction.',
      'Attach a PDF, PNG, JPEG, WebP, or CSV receipt/document up to 10 MB. Download or remove attachments from the transaction row.',
      'Use AI suggestions only as proposals. Apply all suggestions or only suggestions at least 80% confident, then review the result.',
    ],
    notes: [
      'Attachments are stored outside SQLite under the server data directory. A database backup alone does not include them.',
    ],
  },
  {
    id: 'transfers',
    title: 'Transfers',
    eyebrow: 'Move money without inflating spending',
    route: '/transactions',
    summary:
      'A paired transfer moves money between accounts and is excluded from income and spending totals.',
    steps: [
      'Create a paired transfer manually when both sides of the movement are known.',
      'During import, inspect candidate pairs and choose the matches that represent the same movement between accounts. If only one side is present, mark it as awaiting transfer; it is excluded until the counterpart is imported.',
      'From Transactions, pair existing equal-and-opposite rows when the bank statements were imported separately.',
      'Unpair when a match was wrong. Delete a paired transfer together only when both rows should truly be removed.',
      'Check the Dashboard transfer guidance after categorizing spending-pot budget lines. It indicates the planned amount to move, not an additional expense.',
    ],
    notes: [
      'Transfers must use different accounts. Do not categorize an internal transfer as ordinary spending.',
    ],
  },
  {
    id: 'recurring-funds-commitments',
    title: 'Scheduled items, funds, and commitments',
    eyebrow: 'Automate predictable money',
    route: '/recurring',
    summary:
      'Use these tools for predictable events, irregular bills, and obligations with an end date.',
    steps: [
      'Create scheduled income or expenses with a signed amount, day 1–28, account, category, optional auto-post, and an optional schedule (start/end months, skip months). Post now creates the selected occurrence.',
      'Pause a scheduled item without deleting it. Posting is idempotent, so repeating the same action does not create duplicates. Split templates divide one item across categories. Skip months prevent posting and import folding.',
      'Create a fund for irregular bills. Set its start month, opening balance, monthly contribution, and optional target amount/date. Record deposits, withdrawals, and linked bills.',
      'Use Commitments for dated obligations such as loans or instalments. Set start/end month, monthly amount, account, and optional category/fund links.',
      'Review warnings for negative or underfunded funds and the Dashboard for scheduled items due soon.',
    ],
    notes: [
      'Commitments stop contributing after their end month. A fund balance can be negative temporarily; that is a visible warning, not hidden debt.',
    ],
  },
  {
    id: 'dashboard-balances',
    title: 'Dashboard and balance reconciliation',
    eyebrow: 'Compare the plan with reality',
    route: '/balances',
    summary: 'Reconciliation is how the forecast stays anchored to real account balances.',
    steps: [
      'Read Dashboard planned versus actual spend, income, month result, warnings, insights, and upcoming recurring items.',
      'Record the real closing or observed balance for each account and month on Balances.',
      'Use the variance to investigate missing imports, incorrect opening balances, uncategorized transactions, or unpaired transfers.',
      'Keep the observation when it is correct. Future projection months re-anchor from reality instead of compounding the discrepancy.',
      'Remove an observation only when it was entered incorrectly or is no longer useful.',
    ],
    notes: [
      'Positive budget difference means under plan. Account balance variance is a reconciliation signal, not automatically an error in the budget.',
    ],
  },
  {
    id: 'projection-reports',
    title: 'Projection and reports',
    eyebrow: 'Look ahead and explain the past',
    route: '/projection',
    summary: 'Projection models the future; Reports exports and compares what happened.',
    steps: [
      'Use Projection to inspect the 96-month baseline: income, commitments, category plans, free savings, committed fund savings, and total balance.',
      'Create up to three temporary scenarios with monthly income/outgoing changes and dated one-offs. Scenarios do not modify saved budgets.',
      'Use Reports for monthly/yearly totals, category breakdowns, account filters, month-over-month comparison, category trends, and charts.',
      'Export CSV/XLSX when you need data outside the app. Exports preserve original statement amounts and currency codes; Print/PDF uses the browser print dialog.',
      'Use month-end history to compare the plan with the frozen state captured after a month closes. Only months with activity appear.',
    ],
    notes: [
      'Projection avoids double-counting a category plan already covered by a commitment. Actual income replaces usual income only when entered for that month.',
    ],
  },
  {
    id: 'currency',
    title: 'Multi-currency',
    eyebrow: 'Keep source amounts intact',
    route: '/settings',
    summary:
      'Transactions retain their statement currency while planning and aggregate reporting use the global display currency.',
    steps: [
      'Choose the global display currency in Settings. Budgets, funds, commitments, and income use this currency.',
      'Set each account currency for opening balances, observations, and running account balances.',
      'Add monthly foreign-exchange rates manually or fetch missing ECB reference data. A rate means display-currency units per one foreign unit.',
      'Resolve the Exchange rates missing warning. Until a rate exists, the app counts that foreign amount 1:1 and labels the limitation.',
      'After changing the global display currency, refetch or re-enter rates because existing rates were relative to the previous base.',
    ],
    notes: [
      'CSV/XLSX exports preserve original amounts and currency codes even when summaries are converted.',
    ],
  },
  {
    id: 'settings-data',
    title: 'Settings, backups, sharing, and notifications',
    eyebrow: 'Protect and share deliberately',
    route: '/settings',
    summary:
      'Settings contains account identity, data safety, sharing, display, and optional integrations.',
    steps: [
      'Download a backup before upgrades or migrations. It contains the user SQLite database; copy the matching uploads directory separately for transaction attachments.',
      'Restore only a trusted backup. The app validates SQLite integrity and required references, creates a pre-restore copy, and rolls back a failed restore.',
      'Use the reset spending action only when you want to remove transactions and attachments while keeping planning configuration.',
      'Create a read-only share link for a selected month. It shows planned category/group totals, expires, and can be revoked; it does not expose transactions, balances, accounts, or settings.',
      'Configure ntfy only if you want daily warning/danger summaries. The configured ntfy server receives those notifications.',
      'Change username or password from Identity. Changing a password invalidates existing sessions; renaming moves the user database and uploads.',
    ],
    notes: [
      'A complete migration backup includes both the SQLite backup and the user uploads directory. Keep backups private because they contain financial data.',
    ],
  },
  {
    id: 'ai',
    title: 'AI assistant',
    eyebrow: 'Optional and user-controlled',
    route: '/chat',
    summary:
      'AI is optional. The planner works without it, and every write-capable action requires explicit confirmation.',
    steps: [
      'Configure one or more named provider profiles in Settings. Supported presets include 9Router, OpenCode Zen, OpenRouter, Ollama, and LM Studio, plus custom OpenAI-compatible endpoints.',
      'Every user owns private profiles. The administrator can share an administrator-owned profile with selected users; shared recipients can use it but never see its API key or private URL.',
      'Use Finance chat for read-only questions. It can query permitted budget data but cannot change your budget.',
      'Use format analysis on Import to understand unfamiliar statement columns, then verify the preview yourself.',
      'Use category suggestions as proposals. Apply them individually, all at once, or only at 80% confidence after reviewing the results.',
      'Dev mode creates a fixed-whitelist proposal for budgets, rules, commitments, funds, income, or balance anchors. Nothing changes until Apply is pressed; raw SQL, deletions, and authentication changes are not allowed.',
    ],
    notes: [
      'Local OCR is the private default. Explicit online vision OCR sends bounded PDF page renders or JPG/PNG bytes to the active AI provider; read the provider privacy policy before using it with financial data.',
    ],
  },
  {
    id: 'clients',
    title: 'Web, Android, desktop, and HTTPS',
    eyebrow: 'Connect your devices safely',
    route: '/settings',
    summary:
      'Install the server once, then connect clients to it. Android accepts HTTP or HTTPS; HTTPS is recommended outside a trusted private network.',
    steps: [
      'For a browser on the same machine or trusted LAN, open the server URL and port shown during installation. For public or hostile networks, put Caddy or another reverse proxy in front of it.',
      'For Android, download the signed APK from GitHub Releases. Enter a LAN/Tailscale HTTP address such as http://192.168.x.x:2026 or an HTTPS endpoint. The app warns before saving HTTP.',
      'For Linux, install the `.deb`, AUR package, or AppImage. The desktop client is a client only and remembers up to ten server addresses.',
      'For macOS, install the unsigned DMG from Releases and allow it under System Settings → Privacy & Security if Gatekeeper blocks it. The macOS client also contains no server.',
      'When a device cannot connect, first open the same URL in its browser, then check the server bind address, firewall, Wi-Fi client isolation, Tailscale membership, and HTTPS certificate.',
    ],
    notes: [
      'Mobile HTTP is intended only for trusted LAN/VPN use because session credentials and application traffic can be observed or modified on an untrusted network. HTTPS is recommended outside private networks; iOS still blocks arbitrary public HTTP through App Transport Security.',
      'Never expose the raw server port to the public internet without HTTPS and appropriate firewall controls.',
    ],
  },
  {
    id: 'admin',
    title: 'Administration and privacy',
    eyebrow: 'For server owners',
    route: '/users',
    summary:
      'The first account is an administrator. Administration is separate from the private budget data of each user.',
    steps: [
      'Create the first account only from localhost unless a SETUP_TOKEN was deliberately configured for remote setup.',
      'Use Admin → Users to create users, reset passwords, rename users, or delete another user and that user’s private database.',
      'Store the server data directory securely. It contains the master database, user databases, and uploads; filesystem access is equivalent to access to the data.',
      'Use a strong password, HTTPS for untrusted networks, regular backups, and a restricted firewall. Set SECURE_COOKIE=1 and TRUST_PROXY=1 behind an HTTPS reverse proxy.',
      'Optional outbound connections are limited to providers you configure, ECB/Frankfurter exchange-rate data, ntfy if configured, and the GitHub release check shown in Settings.',
    ],
    notes: [
      'Gulden has no third-party account, advertising, or telemetry service. It is self-hosted, but server and backup security remain your responsibility.',
    ],
  },
  {
    id: 'troubleshooting',
    title: 'Troubleshooting',
    eyebrow: 'When something looks wrong',
    route: '/settings',
    summary:
      'Most issues are either a server connection problem, an incorrect working month, or an unreviewed data row.',
    steps: [
      'If the app says the server is unreachable, start or restart the server and press Retry. The offline screen does not mean accounts were deleted.',
      'If two devices show different accounts, compare the complete server URL and numeric IP. They are connected to different servers.',
      'If totals are unexpected, check the working month, category/account assignments, duplicate preview, pending/reverted rows, transfers, refunds, and exchange-rate warnings.',
      'If an import row is missing, inspect the preview reason. Invalid dates, amounts, descriptions, current pending rows, and reverted rows are intentionally reported or skipped.',
      'For a server error, record the X-Request-Id response header and match it to the service logs. Do not post database files, passwords, or API keys in support requests.',
    ],
    notes: [
      'The full operational checklist is in the GitHub documentation, including service logs, firewall checks, migration, and reverse-proxy setup.',
    ],
  },
];

function matches(section, query) {
  if (!query.trim()) return true;
  const text = [
    section.title,
    section.eyebrow,
    section.summary,
    ...section.steps,
    ...section.notes,
  ].join(' ');
  return text.toLowerCase().includes(query.trim().toLowerCase());
}

function PageLink({ to, children }) {
  return (
    <Link className="help-open-link" to={to}>
      {children}
    </Link>
  );
}

export default function Help() {
  const [query, setQuery] = useState('');
  const visible = SECTIONS.filter((section) => matches(section, query));

  return (
    <div className="public-help">
      <header className="help-header">
        <Link className="help-brand" to="/" aria-label="Gulden home">
          <span className="brand-mark">
            <i></i>
            <i></i>
            <i></i>
          </span>
          <span>Gulden</span>
        </Link>
        <nav className="help-header-nav" aria-label="Help navigation">
          <a href={`${GITHUB}/releases`} target="_blank" rel="noreferrer">
            Downloads
          </a>
          <a href={`${GITHUB}/tree/main/docs`} target="_blank" rel="noreferrer">
            Documentation
          </a>
          <Link className="btn primary" to="/">
            Open app
          </Link>
        </nav>
      </header>

      <main className="help-layout">
        <section className="help-intro">
          <p className="eyebrow">Complete user guide</p>
          <h1>Make every number explainable.</h1>
          <p className="help-lede">
            Gulden is a self-hosted planner: your server stores the data, clients connect to it, and
            every import, forecast, and automation can be reviewed. Use this guide to set up the
            model, maintain actuals, and understand what the app is telling you.
          </p>
          <div className="help-intro-actions">
            <PageLink to="/accounts">Set up accounts</PageLink>
            <a
              className="btn subtle"
              href={`${GITHUB}/blob/main/docs/USER_GUIDE.md`}
              target="_blank"
              rel="noreferrer"
            >
              Read the manual on GitHub
            </a>
          </div>
        </section>

        <div className="help-toolbar">
          <label className="help-search">
            <span>Search help</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Try “backup”, “transfer”, or “currency”"
              aria-label="Search help"
            />
          </label>
          <span className="muted tiny">
            {visible.length} of {SECTIONS.length} topics
          </span>
        </div>

        <div className="help-body">
          <aside className="help-toc card" aria-label="Help topics">
            <strong>Topics</strong>
            {SECTIONS.map((section) => (
              <a
                key={section.id}
                className={visible.includes(section) ? '' : 'is-hidden'}
                href={`#${section.id}`}
              >
                {section.title}
              </a>
            ))}
            <a href={`${GITHUB}/issues`} target="_blank" rel="noreferrer">
              Report a problem
            </a>
          </aside>

          <div className="help-content">
            <div className="card shortcut-card">
              <p className="eyebrow">Quick reference</p>
              <h2>Keyboard shortcuts</h2>
              <div className="shortcut-list">
                <span>
                  <kbd>g</kbd> then <kbd>d</kbd> Dashboard
                </span>
                <span>
                  <kbd>g</kbd> then <kbd>t</kbd> Transactions
                </span>
                <span>
                  <kbd>g</kbd> then <kbd>r</kbd> Reports
                </span>
                <span>
                  <kbd>?</kbd> Help
                </span>
              </div>
              <p className="muted tiny">Shortcuts are inactive while typing in a form field.</p>
            </div>

            {visible.length === 0 && (
              <div className="card help-empty">
                <h2>No matching help topics</h2>
                <p className="muted">
                  Try a shorter phrase, or clear the search to browse every workflow.
                </p>
              </div>
            )}

            {visible.map((section) => (
              <section id={section.id} key={section.id} className="help-section card">
                <div className="help-section-heading">
                  <div>
                    <p className="eyebrow">{section.eyebrow}</p>
                    <h2>{section.title}</h2>
                  </div>
                  <PageLink to={section.route}>Open page</PageLink>
                </div>
                <p className="help-summary">{section.summary}</p>
                <ol className="help-steps">
                  {section.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                <div className="help-notes">
                  {section.notes.map((note) => (
                    <p key={note}>
                      <strong>Important:</strong> {note}
                    </p>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </main>

      <footer className="help-footer">
        <span>Gulden · Self-hosted help</span>
        <a href={`${GITHUB}/blob/main/SECURITY.md`} target="_blank" rel="noreferrer">
          Security
        </a>
        <a href={`${GITHUB}/blob/main/docs/TROUBLESHOOTING.md`} target="_blank" rel="noreferrer">
          Troubleshooting
        </a>
        <a href={`${GITHUB}/blob/main/LICENSE`} target="_blank" rel="noreferrer">
          AGPL-3.0 License
        </a>
      </footer>
    </div>
  );
}
