import { test, expect } from '@playwright/test';

test('login, import, review, and dashboard flow', async ({ page }) => {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Budget Planner' })).toBeVisible();
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
  await expect(page.getByText('Needs review', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: /Confirm import \(1\)/ }).click();

  await expect(page.getByText('Imported 1 transaction(s)')).toBeVisible();
  await page.getByRole('link', { name: /need review/ }).click();
  await expect(page).toHaveURL(/\/transactions\?review=1$/);
  await expect(page.getByRole('heading', { name: /Needs review/ })).toBeVisible();
  await expect(page.getByText('Coffee')).toBeVisible();

  await page.getByRole('link', { name: /Dashboard$/ }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('Monthly check-in')).toBeVisible();
});
