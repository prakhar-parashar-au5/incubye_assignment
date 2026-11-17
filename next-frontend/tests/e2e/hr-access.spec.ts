import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const DEMO_PASSWORD = process.env.E2E_DEMO_PASSWORD ?? '';

async function signInDemo(page: import('@playwright/test').Page, name: 'Meera Iyer'|'Rohan Mehta') {
  await page.goto('/sign-in');
  const account=page.getByRole('radio',{name});
  await account.check();
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button',{name:'Sign in'}).click();
  await page.waitForURL('**/employees');
}
async function expectCleanA11y(page: import('@playwright/test').Page) {
  const results=await new AxeBuilder({page}).analyze();
  expect(results.violations.filter((v)=>v.impact==='serious'||v.impact==='critical').map((v)=>v.id)).toEqual([]);
}

test('Admin creates a Scoped HR account and the user signs in through Another HR account', async ({page,browser},testInfo)=>{
  await signInDemo(page,'Meera Iyer');
  // On mobile, open the Menu disclosure after the streamed shell has rendered.
  await page.getByRole('region',{name:'Signed-in HR account'}).filter({visible:true}).waitFor();
  await page.waitForLoadState('networkidle');
  const menu=page.locator('summary',{hasText:'Menu'}).filter({visible:true});
  if ((await menu.count())>0) await menu.click();
  await page.getByRole('navigation',{name:'Main'}).filter({visible:true}).getByRole('link',{name:'HR Access'}).click();
  await expect(page.getByRole('heading',{level:1,name:'HR Access'})).toBeVisible();
  if (testInfo.project.name==='desktop') {
    // Desktop sorts by column header; the default is Last updated, newest first.
    await expect(page.getByRole('columnheader',{name:/Last updated/})).toHaveAttribute('aria-sort','descending');
  } else {
    // Mobile has no table; sorting lives in the filter sheet, with the same default.
    await page.getByRole('button',{name:/Filters/}).click();
    const sheet=page.getByRole('dialog');
    await expect(sheet.getByLabel('Sort by')).toHaveValue('updatedAt');
    await expect(sheet.getByLabel('Order')).toHaveValue('desc');
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  }
  await expectCleanA11y(page);

  const email=`qa.hr.${Date.now()}.${testInfo.project.name}@example.com`;
  await page.getByRole('link',{name:'Add HR user'}).click();
  await page.getByLabel('Display name').fill('QA Scoped HR');
  await page.getByLabel('Email',{exact:true}).fill(email);
  await page.getByRole('radio',{name:'Scoped HR'}).check();
  await page.getByRole('checkbox',{name:'India'}).check();
  await page.getByRole('checkbox',{name:'Tech'}).check();
  await page.getByRole('button',{name:'Preview change'}).click();
  // The combination must be in the preview itself. Next.js keeps the previous list route mounted
  // but hidden, so an unscoped text query can match a hidden list row.
  const previewPanel=page.getByRole('region',{name:'Preview: nothing has changed yet'});
  await expect(previewPanel.getByRole('listitem').filter({hasText:/^India \+ Tech$/})).toBeVisible();
  await expect(previewPanel).toContainText('Estimated employees in access:');
  await expect(page.getByRole('button',{name:'Create HR user'})).toBeEnabled();
  await expectCleanA11y(page);
  await page.getByRole('button',{name:'Create HR user'}).click();
  await expect(page.getByRole('heading',{name:'Temporary password, shown once'})).toBeVisible();
  await page.getByRole('button',{name:'Show password'}).click();
  const temporaryPassword=(await page.getByLabel('Temporary password value').textContent())?.trim() ?? '';
  expect(temporaryPassword.length).toBeGreaterThan(0);
  expect(page.url()).not.toContain(temporaryPassword);
  expect(await page.evaluate(()=>localStorage.length+sessionStorage.length)).toBe(0);
  await page.getByRole('button',{name:'Hide password'}).click();
  await page.screenshot({path:testInfo.outputPath(`hr-access-password-masked-${testInfo.project.name}.png`),fullPage:true});
  await page.getByRole('button',{name:'Done, I have shared it'}).click();
  await page.waitForURL('**/hr-access/**');
  await page.reload();
  expect(await page.content()).not.toContain(temporaryPassword);

  const scopedContext=await browser.newContext({viewport:testInfo.project.name==='mobile'?{width:390,height:844}:{width:1440,height:900}});
  const scopedPage=await scopedContext.newPage();
  await scopedPage.goto(new URL('/sign-in',testInfo.project.use.baseURL as string).toString());
  await scopedPage.getByRole('radio',{name:'Another HR account'}).check();
  await scopedPage.getByLabel('Email',{exact:true}).fill(email);
  await scopedPage.getByLabel('Password').fill(temporaryPassword);
  await scopedPage.getByRole('button',{name:'Sign in'}).click();
  await scopedPage.waitForURL('**/employees');
  const identity=scopedPage.getByRole('region',{name:'Signed-in HR account'}).filter({visible:true});
  await expect(identity).toContainText('QA Scoped HR');
  await expect(identity).toContainText('Scoped HR');
  await expect(identity).toContainText('India and Tech');
  // Count the link in the DOM, not by visibility, so a link hidden inside the mobile Menu still counts.
  await expect(scopedPage.locator('a[href="/hr-access"]')).toHaveCount(0);
  await expectNoOverflow(scopedPage);
  await expectCleanA11y(scopedPage);
  await scopedPage.screenshot({path:testInfo.outputPath(`hr-access-created-scoped-${testInfo.project.name}.png`),fullPage:true});

  await scopedPage.goto('/hr-access');
  await expect(scopedPage.getByText('HR Access is available to Admin HR only.')).toBeVisible();
  await expect(scopedPage.getByText(email)).toHaveCount(0);
  await scopedContext.close();
});

// QA run 03 regressions (D1-D4). Each opens HR Access directly as the Admin demo account.
async function openHrAccess(page: import('@playwright/test').Page, search = '') {
  await signInDemo(page,'Meera Iyer');
  await page.goto(`/hr-access${search}`);
  await expect(page.getByRole('heading',{level:1,name:'HR Access'})).toBeVisible();
}
function hrUserNames(page: import('@playwright/test').Page, project: string) {
  // Desktop shows a table; mobile shows a list. Both are named "HR users".
  return project==='desktop'
    ? page.getByRole('region',{name:'HR users'}).locator('tbody td:first-child a')
    : page.getByRole('list',{name:'HR users'}).getByRole('listitem').locator('a');
}
function expectCleanListUrl(url: string) {
  const params = new URL(url).searchParams;
  const keys = [...params.keys()];
  expect(new Set(keys).size).toBe(keys.length);
  for (const [key, value] of params) expect(value, `${key} should not be blank`).not.toBe('');
}

test('D1: sorting switches to descending and stays there', async ({page},testInfo)=>{
  await openHrAccess(page);
  if (testInfo.project.name==='desktop') {
    const header=page.getByRole('columnheader',{name:/^Name/});
    await header.getByRole('link').click();
    await expect(header).toHaveAttribute('aria-sort','ascending');
    await expect(page).toHaveURL(/[?&]sort=name(&|$)/);
    await header.getByRole('link').click();
    await expect(header).toHaveAttribute('aria-sort','descending');
    await expect(page).toHaveURL(/[?&]sort=name&direction=desc(&|$)/);
    await expectNamesDescending(page,testInfo.project.name);
    await header.getByRole('link').click();
    await expect(header).toHaveAttribute('aria-sort','ascending');
  } else {
    await page.getByRole('button',{name:/Filters/}).click();
    const sheet=page.getByRole('dialog');
    await sheet.getByLabel('Sort by').selectOption('name');
    await expect(sheet.getByLabel('Order')).toHaveValue('asc');
    await sheet.getByLabel('Order').selectOption('desc');
    await sheet.getByRole('button',{name:'Apply'}).click();
    await expect(page).toHaveURL(/[?&]sort=name&direction=desc(&|$)/);
    await page.getByRole('button',{name:/Filters/}).click();
    await expect(page.getByRole('dialog').getByLabel('Order')).toHaveValue('desc');
    await page.keyboard.press('Escape');
    await expectNamesDescending(page,testInfo.project.name);
  }
});
async function expectNamesDescending(page: import('@playwright/test').Page, project: string) {
  const names=(await hrUserNames(page,project).allTextContents()).map((name)=>name.trim());
  expect(names.length).toBeGreaterThan(1);
  expect(names).toEqual([...names].sort((a,b)=>b.localeCompare(a,'en',{sensitivity:'base'})));
}

test('D2: a page step with no page is plain text, not a link', async ({page})=>{
  await openHrAccess(page,'?status=ALL&pageSize=100');
  const pages=page.getByRole('navigation',{name:'HR user pages'});
  await expect(pages).toContainText('Page 1 of 1');
  await expect(pages.getByRole('link')).toHaveCount(0);
  await expect(pages.locator('a')).toHaveCount(0);
  await expect(pages.getByText('Previous')).toHaveAttribute('aria-disabled','true');
  await expect(pages.getByText('Next')).toHaveAttribute('aria-disabled','true');

  await page.goto('/hr-access?status=ALL&pageSize=1');
  await expect(pages.getByText('Previous')).toHaveAttribute('aria-disabled','true');
  await expect(pages.getByRole('link',{name:'Previous'})).toHaveCount(0);
  await expect(pages.getByRole('link',{name:'Next'})).toHaveAttribute('href',/page=2/);
});

test('D3: search and filters return results with clean URLs, and a bad link says so', async ({page},testInfo)=>{
  await openHrAccess(page);
  const search=page.getByRole('search',{name:'Search and filter HR users'});
  await search.getByLabel('Search by name or exact email').fill('Rohan Mehta');
  await search.getByRole('button',{name:'Search'}).click();
  await expect(page).toHaveURL(/[?&]q=Rohan(\+|%20)Mehta/);
  expectCleanListUrl(page.url());
  await expect(hrUserNames(page,testInfo.project.name).filter({hasText:'Rohan Mehta'})).toHaveCount(1);
  await expect(page.getByText(/not responding/)).toHaveCount(0);

  await page.goto('/hr-access');
  if (testInfo.project.name==='desktop') {
    await search.getByLabel('Role').selectOption('ADMIN');
    await search.getByRole('button',{name:'Apply filters'}).click();
  } else {
    await page.getByRole('button',{name:/Filters/}).click();
    const sheet=page.getByRole('dialog');
    await sheet.getByLabel('Role').selectOption('ADMIN');
    await sheet.getByRole('button',{name:'Apply'}).click();
  }
  await expect(page).toHaveURL(/[?&]role=ADMIN(&|$)/);
  expectCleanListUrl(page.url());
  await expect(hrUserNames(page,testInfo.project.name).filter({hasText:'Meera Iyer'})).toHaveCount(1);
  await expect(hrUserNames(page,testInfo.project.name).filter({hasText:'Rohan Mehta'})).toHaveCount(0);
  if (testInfo.project.name==='mobile') {
    // A search after a sheet filter keeps that filter: the hidden desktop fields are not stale.
    await search.getByLabel('Search by name or exact email').fill('Meera');
    await search.getByRole('button',{name:'Search'}).click();
    await expect(page).toHaveURL(/[?&]q=Meera&role=ADMIN(&|$)/);
  }

  await page.goto('/hr-access?role=CEO');
  const alert=page.getByRole('alert').filter({hasText:'These filters could not be applied'});
  await expect(alert).toBeVisible();
  await expect(page.getByText(/not responding/)).toHaveCount(0);
  await alert.getByRole('link',{name:'Clear filters'}).click();
  await expect(page).toHaveURL(/\/hr-access$/);
  await expect(hrUserNames(page,testInfo.project.name).first()).toBeVisible();
  await expectCleanA11y(page);
});

test('D4: create and regenerate forms start blank on the next visit', async ({page},testInfo)=>{
  await openHrAccess(page);
  const email=`qa.reset.${Date.now()}.${testInfo.project.name}@example.com`;
  await page.getByRole('link',{name:'Add HR user'}).click();
  await page.getByLabel('Display name').fill('QA Reset HR');
  await page.getByLabel('Email',{exact:true}).fill(email);
  await page.getByRole('checkbox',{name:'India'}).check();
  await page.getByRole('checkbox',{name:'Tech'}).check();
  await page.getByRole('button',{name:'Preview change'}).click();
  await page.getByRole('button',{name:'Create HR user'}).click();
  await expect(page.getByRole('heading',{name:'Temporary password, shown once'})).toBeVisible();
  await page.getByRole('button',{name:'Done, I have shared it'}).click();
  await page.waitForURL(/\/hr-access\/\d+$/);
  const detailUrl=page.url();

  // Client-side navigation only: a reload would discard the hidden route and hide the defect.
  await page.getByRole('link',{name:'← HR Access'}).filter({visible:true}).click();
  await page.waitForURL(/\/hr-access(\?.*)?$/);
  await page.getByRole('link',{name:'Add HR user'}).click();
  await page.waitForURL('**/hr-access/new');
  const displayName=page.getByLabel('Display name').filter({visible:true});
  await expect(displayName).toHaveValue('');
  await expect(page.getByLabel('Email',{exact:true}).filter({visible:true})).toHaveValue('');
  await expect(page.getByRole('heading',{name:/complete$/})).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'Temporary password, shown once'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Preview change'})).toBeVisible();

  await page.goto(detailUrl);
  await page.getByRole('link',{name:'Regenerate temporary password'}).click();
  await page.getByLabel('Reason').fill('QA reset check');
  await page.getByRole('button',{name:'Preview change'}).click();
  await page.getByRole('button',{name:'Regenerate temporary password'}).click();
  await expect(page.getByRole('heading',{name:'Temporary password, shown once'})).toBeVisible();
  await page.getByRole('button',{name:'Done, I have shared it'}).click();
  await page.waitForURL(/\/hr-access\/\d+$/);
  await page.getByRole('link',{name:'Regenerate temporary password'}).click();
  await page.waitForURL(/\/regenerate-password$/);
  await expect(page.getByLabel('Reason').filter({visible:true})).toHaveValue('');
  await expect(page.getByRole('heading',{name:'Temporary password, shown once'})).toHaveCount(0);
  await expect(page.getByLabel('Temporary password value')).toHaveCount(0);
  await expect(page.getByRole('heading',{name:/complete$/})).toHaveCount(0);
});

async function expectNoOverflow(page: import('@playwright/test').Page){
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}
