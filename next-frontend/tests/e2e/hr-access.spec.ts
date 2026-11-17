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

async function expectNoOverflow(page: import('@playwright/test').Page){
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}
