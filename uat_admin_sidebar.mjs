/**
 * UAT — Customer Portal Admin Sidebar
 * Runs via Playwright against the local dev server on port 5000
 */

import { chromium } from 'playwright';
import fs from 'fs';

const BASE = 'http://127.0.0.1:5000';
const SHOTS_DIR = 'uat_screenshots';
fs.mkdirSync(SHOTS_DIR, { recursive: true });

const MENUS = [
  { value: 'content',           label: 'Konten Website' },
  { value: 'services',          label: 'Kelola Layanan' },
  { value: 'products',          label: 'Kelola Produk' },
  { value: 'couriers',          label: 'Kurir' },
  { value: 'pricing',           label: 'Kelola Harga' },
  { value: 'armada-trucking',   label: 'Armada Trucking' },
  { value: 'vendor-catalog',    label: 'Katalog Vendor' },
  { value: 'produk-unggulan',   label: 'Produk Unggulan' },
  { value: 'mini-forms',        label: 'Mini Form' },
  { value: 'product-templates', label: 'Product Templates' },
  { value: 'vendor-marketplace',label: 'Vendor Marketplace' },
  { value: 'master-price',      label: 'Master Price' },
  { value: 'vendor-invitations',label: 'Undang Vendor' },
  { value: 'approvals',         label: 'Approvals' },
  { value: 'customers',         label: 'Pelanggan' },
  { value: 'wa-logs',           label: 'WhatsApp' },
  { value: 'bizportal-erp',     label: 'BizPortal ERP' },
  { value: 'paylabs-setting',   label: 'Paylabs Setting' },
  { value: 'utilities',         label: 'Utilitas' },
  { value: 'claim',             label: 'Aktivasi Admin' },
];

async function loginAsAdmin(page) {
  await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
  // If redirected to login, use dev login button
  if (page.url().includes('/login') || page.url().endsWith('/admin') === false ||
      await page.locator('text=Login sebagai admin').isVisible({ timeout: 3000 }).catch(() => false)) {
    // navigate to login page if not already there
    const hasDevLogin = await page.locator('text=Login sebagai admin').isVisible({ timeout: 5000 }).catch(() => false);
    if (!hasDevLogin) {
      await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    }
    await page.locator('text=Login sebagai admin').click();
    await page.waitForURL(`${BASE}/admin`, { timeout: 15000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  }
}

const results = {
  phase1: {},
  phase2_menus: [],
  phase3_mobile: {},
  phase4_tablet: {},
  phase5_parity: {},
  phase7_roles: {},
  phase8_console: { errors: [], warnings: [] },
  screenshots: [],
};

const consoleMessages = { errors: [], warnings: [] };

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });

  // ── PHASE 1 + 2 + 5 + 8  (Desktop 1280×800) ──────────────────────────────
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();

    page.on('console', msg => {
      if (msg.type() === 'error') consoleMessages.errors.push(msg.text().substring(0, 200));
      if (msg.type() === 'warning') consoleMessages.warnings.push(msg.text().substring(0, 200));
    });
    page.on('pageerror', err => consoleMessages.errors.push('[pageerror] ' + err.message.substring(0, 200)));

    // PHASE 1 — Login
    await loginAsAdmin(page);
    const url = page.url();
    const title = await page.title();
    const hasSidebar = await page.locator('[role="tablist"]').isVisible({ timeout: 5000 }).catch(() => false);
    const hasBlank = await page.locator('text=blank').isVisible({ timeout: 1000 }).catch(() => false);

    results.phase1 = {
      url,
      title,
      hasSidebar,
      hasBlank,
      pass: url.includes('/admin') && hasSidebar && !hasBlank,
    };

    // Phase 9 screenshot 1 — desktop sidebar open (default active tab)
    await page.screenshot({ path: `${SHOTS_DIR}/01_desktop_default.png`, fullPage: false });
    results.screenshots.push('01_desktop_default.png');

    // PHASE 2 — Click all 20 menus
    for (const menu of MENUS) {
      // Scroll the trigger into view
      const trigger = page.locator(`[role="tab"][data-value="${menu.value}"]`).first();
      const altTrigger = page.locator(`[role="tablist"] button`).filter({ hasText: menu.label }).first();

      let clicked = false;
      let contentVisible = false;
      let consoleErrorBefore = consoleMessages.errors.length;
      let errorOnClick = null;

      try {
        const el = (await trigger.isVisible({ timeout: 2000 }).catch(() => false)) ? trigger : altTrigger;
        await el.scrollIntoViewIfNeeded();
        await el.click({ timeout: 3000 });
        await page.waitForTimeout(600); // let content render

        // Check the tab panel is visible and non-empty
        const panel = page.locator(`[role="tabpanel"]`).first();
        contentVisible = await panel.isVisible({ timeout: 3000 }).catch(() => false);
        const panelText = await panel.innerText({ timeout: 2000 }).catch(() => '');
        const isBlank = panelText.trim().length < 5;

        const newErrors = consoleMessages.errors.slice(consoleErrorBefore);
        const hasNewError = newErrors.some(e =>
          e.includes('hook') || e.includes('Minified React') || e.includes('hydrat')
        );

        results.phase2_menus.push({
          value: menu.value,
          label: menu.label,
          clicked: true,
          contentVisible,
          isBlank,
          hasNewError,
          newErrors: newErrors.filter(e => e.includes('hook') || e.includes('Minified') || e.includes('hydrat')),
          pass: contentVisible && !isBlank && !hasNewError,
        });
        clicked = true;
      } catch (e) {
        results.phase2_menus.push({
          value: menu.value,
          label: menu.label,
          clicked: false,
          contentVisible: false,
          isBlank: true,
          hasNewError: false,
          pass: false,
          error: e.message.substring(0, 120),
        });
      }
    }

    // Phase 9 screenshot 2 — vendor-marketplace
    const vmTrigger = page.locator(`[role="tablist"] button`).filter({ hasText: 'Vendor Marketplace' }).first();
    await vmTrigger.scrollIntoViewIfNeeded().catch(() => {});
    await vmTrigger.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${SHOTS_DIR}/02_desktop_vendor_marketplace.png` });
    results.screenshots.push('02_desktop_vendor_marketplace.png');

    // Phase 9 screenshot 3 — master-price
    const mpTrigger = page.locator(`[role="tablist"] button`).filter({ hasText: 'Master Price' }).first();
    await mpTrigger.scrollIntoViewIfNeeded().catch(() => {});
    await mpTrigger.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${SHOTS_DIR}/03_desktop_master_price.png` });
    results.screenshots.push('03_desktop_master_price.png');

    // PHASE 5 — Parity: verify new menus have content
    const vmResult = results.phase2_menus.find(m => m.value === 'vendor-marketplace');
    const mpResult = results.phase2_menus.find(m => m.value === 'master-price');
    results.phase5_parity = {
      vendor_marketplace: vmResult,
      master_price: mpResult,
      pass: vmResult?.pass && mpResult?.pass,
    };

    // Sidebar layout checks
    const sidebarEl = page.locator('[role="tablist"]').first();
    const sidebarBox = await sidebarEl.boundingBox().catch(() => null);
    const noHorizScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

    results.phase2_layout = {
      sidebarOnLeft: sidebarBox ? sidebarBox.x < 200 : false,
      noHorizScroll,
      pass: (sidebarBox ? sidebarBox.x < 200 : false) && noHorizScroll,
    };

    await ctx.close();
  }

  // ── PHASE 3  (Mobile 390×844) ─────────────────────────────────────────────
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();

    page.on('console', msg => {
      if (msg.type() === 'error') consoleMessages.errors.push('[mobile] ' + msg.text().substring(0, 200));
    });
    page.on('pageerror', err => consoleMessages.errors.push('[mobile-pageerror] ' + err.message.substring(0, 200)));

    await loginAsAdmin(page);
    await page.waitForTimeout(800);

    // Check sidebar desktop is hidden
    const desktopSidebarHidden = await page.evaluate(() => {
      const tablist = document.querySelector('[role="tablist"]');
      if (!tablist) return true;
      const cs = window.getComputedStyle(tablist);
      return cs.display === 'none' || tablist.offsetParent === null;
    });

    // Check hamburger button
    const hamburger = page.locator('button[aria-label*="menu"], button.md\\:hidden, header button').first();
    const hamburgerVisible = await page.locator('header button').filter({ hasText: '' }).first().isVisible({ timeout: 3000 }).catch(() => false);

    // Screenshot — drawer closed
    await page.screenshot({ path: `${SHOTS_DIR}/05_mobile_drawer_closed.png` });
    results.screenshots.push('05_mobile_drawer_closed.png');

    // Open drawer — find hamburger button in header
    const headerButtons = page.locator('header button');
    const count = await headerButtons.count();
    let drawerOpened = false;
    for (let i = 0; i < count; i++) {
      const btn = headerButtons.nth(i);
      const box = await btn.boundingBox().catch(() => null);
      if (box && box.x < 100) { // left side of header
        await btn.click();
        await page.waitForTimeout(500);
        drawerOpened = await page.locator('[role="dialog"]').isVisible({ timeout: 3000 }).catch(() => false);
        if (drawerOpened) break;
      }
    }

    // Screenshot — drawer open
    await page.screenshot({ path: `${SHOTS_DIR}/06_mobile_drawer_open.png` });
    results.screenshots.push('06_mobile_drawer_open.png');

    // Count menu items in drawer
    let drawerMenuCount = 0;
    let drawerHasNewMenus = false;
    let selectedMenuClosesDrawer = false;

    if (drawerOpened) {
      const drawerButtons = page.locator('[role="dialog"] button[type="button"]');
      drawerMenuCount = await drawerButtons.count().catch(() => 0);
      drawerHasNewMenus = await page.locator('[role="dialog"]').locator('text=Vendor Marketplace').isVisible({ timeout: 2000 }).catch(() => false);

      // Click a menu and check drawer closes
      const firstMenu = drawerButtons.first();
      await firstMenu.click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(600);
      const drawerGone = !(await page.locator('[role="dialog"]').isVisible({ timeout: 2000 }).catch(() => false));
      selectedMenuClosesDrawer = drawerGone;

      // Screenshot — after menu selected
      await page.screenshot({ path: `${SHOTS_DIR}/07_mobile_menu_active.png` });
      results.screenshots.push('07_mobile_menu_active.png');
    }

    const noHorizScrollMobile = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

    results.phase3_mobile = {
      desktopSidebarHidden,
      drawerOpened,
      drawerMenuCount,
      drawerHasNewMenus,
      selectedMenuClosesDrawer,
      noHorizScrollMobile,
      pass: desktopSidebarHidden && drawerOpened && drawerMenuCount >= 18 && drawerHasNewMenus && selectedMenuClosesDrawer && noHorizScrollMobile,
    };

    await ctx.close();
  }

  // ── PHASE 4  (Tablet 820×1180) ────────────────────────────────────────────
  {
    const ctx = await browser.newContext({ viewport: { width: 820, height: 1180 } });
    const page = await ctx.newPage();
    await loginAsAdmin(page);
    await page.waitForTimeout(800);

    const hasSidebar = await page.locator('[role="tablist"]').isVisible({ timeout: 5000 }).catch(() => false);
    const hasDrawer = await page.locator('[role="dialog"]').isVisible({ timeout: 1000 }).catch(() => false);
    const noHorizScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

    await page.screenshot({ path: `${SHOTS_DIR}/04_tablet_820.png` });
    results.screenshots.push('04_tablet_820.png');

    results.phase4_tablet = {
      hasSidebar,
      hasDrawer,
      noHorizScroll,
      noDoubleNav: !(hasSidebar && hasDrawer),
      pass: hasSidebar && !hasDrawer && noHorizScroll,
    };

    await ctx.close();
  }

  // ── PHASE 7 — Role: non-admin ─────────────────────────────────────────────
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();

    // login as customer (non-admin)
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    const hasCustomerLogin = await page.locator('text=Login sebagai customer').isVisible({ timeout: 3000 }).catch(() => false);
    if (hasCustomerLogin) {
      await page.locator('text=Login sebagai customer').click();
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    }

    // Now try to access /admin directly
    await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle', timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(500);
    const adminUrl = page.url();
    const hasAdminSidebar = await page.locator('[role="tablist"]').isVisible({ timeout: 3000 }).catch(() => false);
    const redirectedAway = !adminUrl.includes('/admin') || !hasAdminSidebar;

    results.phase7_roles = {
      nonAdminUrl: adminUrl,
      hasAdminSidebar,
      redirectedAway,
      pass: redirectedAway,
    };

    await ctx.close();
  }

  await browser.close();

  // ── PHASE 8 — Consolidate console ────────────────────────────────────────
  const sidebarKeywords = ['sidebar', 'tab', 'sheet', 'drawer', 'radix', 'dialog', 'trigger', 'tablist'];
  const reactKeywords = ['hook', 'Minified React', 'hydrat'];

  // Separate new sidebar errors from pre-existing
  const newSidebarErrors = consoleMessages.errors.filter(e =>
    sidebarKeywords.some(k => e.toLowerCase().includes(k)) ||
    reactKeywords.some(k => e.toLowerCase().includes(k))
  );
  const preExisting = consoleMessages.errors.filter(e => !newSidebarErrors.includes(e));

  results.phase8_console = {
    all_errors: consoleMessages.errors,
    new_sidebar_errors: newSidebarErrors,
    pre_existing: preExisting,
    all_warnings: consoleMessages.warnings,
    pass: newSidebarErrors.length === 0,
  };

  // Output results JSON
  fs.writeFileSync('uat_results.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
})().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
