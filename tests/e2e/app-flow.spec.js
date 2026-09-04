import { test, expect } from '@playwright/test';

test('public help is available before login', async ({ page }) => {
  await page.goto('/help');

  await expect(page.getByRole('heading', { name: 'Make every number explainable.' })).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Search help' })).toBeVisible();
  await expect(page.locator('#start')).toBeVisible();
  await expect(page.locator('a[href="#import"]')).toBeVisible();

  await page.getByRole('searchbox', { name: 'Search help' }).fill('backup');
  await expect(
    page.getByRole('heading', { name: 'Settings, backups, sharing, and notifications' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Import a bank statement' })).not.toBeVisible();
});

test('login, import, review, and dashboard flow', async ({ page }) => {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Gulden' })).toBeVisible();
  await page.getByPlaceholder('Username').fill('e2e_user');
  await page.getByPlaceholder('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Create account & start' }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('Monthly check-in')).toBeVisible();

  await page.getByRole('link', { name: /Import$/ }).click();
  await expect(page.getByRole('heading', { name: 'Import statement' })).toBeVisible();

  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: 'statement.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        `Started Date,Description,Amount,Currency\n${month}-01,Coffee,-4.50,EUR\n`,
      ),
    });

  await expect(page.getByText('Coffee')).toBeVisible();
  await expect(page.getByText('Need a category', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: /Confirm import \(1\)/ }).click();

  await expect(page.getByText('Imported 1 transaction(s)')).toBeVisible();
  await page.getByRole('link', { name: /need review/ }).click();
  await expect(page).toHaveURL(/\/transactions\?review=1$/);
  await expect(page.getByRole('heading', { name: /Needs review/ })).toBeVisible();
  await expect(page.getByText('Coffee')).toBeVisible();

  // Assign a category so the dashboard drill-down has something to show.
  const reviewRow = page.getByRole('row', { name: /Coffee/ });
  await reviewRow.locator('select').first().selectOption({ label: 'Dining out' });
  await expect(page.getByText('Coffee')).toBeHidden();

  await page.getByRole('link', { name: /Dashboard$/ }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('Monthly check-in')).toBeVisible();

  // Dashboard category rows drill down into the filtered Transactions view.
  await page
    .getByRole('link', { name: /Dining out/ })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`/transactions\\?month=${month}&category_id=\\d+$`));
  await expect(page.getByText('Filters:')).toBeVisible();
  await expect(page.getByText('Coffee')).toBeVisible();
  await expect(page.getByText('Showing all 1 transaction on one page.')).toBeVisible();
});

test('themes, responsive settings, and projection controls work', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 900 });
  await page.goto('/login');
  await page.getByPlaceholder('Username').fill('e2e_user');
  await page.getByPlaceholder('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/settings') && response.request().method() === 'PUT',
    ),
    page.getByRole('button', { name: 'Midnight' }).click(),
  ]);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'midnight');
  expect(
    await page.evaluate(
      () => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth,
    ),
  ).toBe(true);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'midnight');

  await page.goto('/projection');
  await expect(page.getByRole('heading', { name: 'Projection horizon' })).toBeVisible();
  await page.getByRole('spinbutton', { name: 'Months', exact: true }).fill('12');
  await page.getByRole('button', { name: 'Update projection' }).click();
  await expect(page.getByRole('heading', { name: /Projection to/ })).toBeVisible();
  await page.getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText('No scenarios configured')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Compare scenarios' })).toBeDisabled();
  await page.getByRole('button', { name: '+ Add scenario' }).click();
  await expect(page.getByRole('button', { name: 'Remove' })).toBeVisible();

  await page.goto('/income');
  await expect(page.getByRole('heading', { name: 'Income sources' })).toBeVisible();
  await page.getByPlaceholder('Source name, e.g. Salary').fill('Future salary');
  await page.getByLabel('Income source start month').fill('2099-01');
  await page.getByLabel('Income source end month').fill('2099-12');
  await page.getByRole('button', { name: 'Add source' }).click();
  await expect(page.getByLabel('Future salary start month')).toHaveValue('2099-01');
  await expect(page.getByLabel('Future salary end month')).toHaveValue('2099-12');
});
