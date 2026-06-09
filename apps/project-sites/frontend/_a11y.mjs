import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const KEY = process.env.E2E_API_KEY;
const ROUTE = '/admin/site-features';
const BPS = [375,390,768,1024,1280,1920];
const b = await chromium.launch();
const all = {};
let landed='';
for (const w of BPS) {
  const ctx = await b.newContext({ viewport:{width:w, height: w<500?812:900} });
  const pg = await ctx.newPage();
  await pg.addInitScript((k)=>{try{localStorage.setItem('ps_session',JSON.stringify({token:k,identifier:'test@megabyte.space',createdAt:Date.now()}))}catch{}}, KEY);
  await pg.goto('https://projectsites.dev'+ROUTE, { waitUntil:'domcontentloaded', timeout:45000 });
  await pg.waitForTimeout(3000);
  if(!landed) landed=pg.url();
  const res = await new AxeBuilder({ page: pg }).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();
  for (const v of res.violations) {
    all[v.id] = all[v.id] || { id:v.id, impact:v.impact, help:v.help, bps:new Set(), sample:'' };
    all[v.id].bps.add(w);
    if(!all[v.id].sample && v.nodes[0]) all[v.id].sample = (v.nodes[0].target||[]).join(' ');
  }
  await ctx.close();
}
console.log('landed:', landed);
const out = Object.values(all);
console.log('=== axe violations ('+out.length+' distinct) ===');
for (const v of out) console.log(` • [${v.impact}] ${v.id} @bp{${[...v.bps].join(',')}} :: ${v.help} :: ${v.sample.slice(0,80)}`);
if(out.length===0) console.log('  ZERO violations ✓');
await b.close();
