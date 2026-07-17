import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { capabilityCoverage, course } from "../apps/help/technical-academy/content/course.mjs";
import { technicalJourneyTypes } from "../apps/help/technical-academy/content/journey-lessons.mjs";

const root = new URL("../", import.meta.url);
function run(command,args){return new Promise((resolve,reject)=>{const child=spawn(command,args,{cwd:root,stdio:"pipe"});let stderr="";child.stderr.on("data",d=>stderr+=d);child.on("close",code=>code?reject(new Error(stderr)):resolve());});}

test("technical academy contract covers the platform and all journey archetypes", async () => {
  assert.equal(course.modules.length, 12);
  assert.equal(course.modules.reduce((sum,module)=>sum+module.lessons.length,0), 71);
  assert.deepEqual(Object.keys(capabilityCoverage).map(Number), Array.from({length:33},(_,index)=>index+1));
  const engine = course.modules.find((module)=>module.id==="t04-rules-engine");
  assert.equal(engine.lessons.length, 6);
  assert.deepEqual(engine.lessons.map((lesson)=>lesson.id), ["engine-contract","model-expression","bundle-governance","evaluation","runtime-topology","replay-testing-operations"]);
  const journeys = course.modules.find((module)=>module.id==="t05-journeys");
  assert.equal(journeys.lessons.length, 25);
  assert.deepEqual(journeys.lessons.filter((lesson)=>lesson.journeyType).map((lesson)=>lesson.journeyType), technicalJourneyTypes);
  for (const lesson of journeys.lessons.filter((item)=>item.journeyType)) {
    assert.equal(lesson.sections.length, 8, `${lesson.journeyType} covers the complete lifecycle`);
    assert.ok(lesson.cases.length >= 17, `${lesson.journeyType} carries the exhaustive case matrix`);
  }
  for (const module of course.modules) for (const lesson of module.lessons) {
    assert.ok(lesson.objectives.length >= 2);
    assert.ok(lesson.sections.length >= 3);
    assert.ok(lesson.flow.length >= 4);
    assert.ok(lesson.sources.length >= 2);
  }
  const matrix=await readFile(new URL("docs/product/product-journey-support-matrix.md",root),"utf8");
  assert.equal([...matrix.matchAll(/^\| [^|]+ \| (?:Controlled first slice|Configurable pattern|Planned|Orchestration only)/gm)].length,21);
});

test("technical academy pages are generated, visual and current", async () => {
  await run("node",["scripts/build-technical-academy.mjs","--check"]);
  const html=await readFile(new URL("apps/help/technical-academy/index.html",root),"utf8");
  const lesson=await readFile(new URL("apps/help/technical-academy/t01-system/platform-map.html",root),"utf8");
  assert.match(html,/LoanOS Technical Academy/);
  assert.match(html,/The Rules Engine/);
  assert.match(html,/Explore the enterprise architecture/);
  assert.match(html,/<strong>463<\/strong> (?:capability records|capabilities)/);
  assert.match(lesson,/<svg/);
  assert.match(lesson,/System sources/);
  assert.doesNotMatch(lesson,/localStorage|sessionStorage|indexedDB/);
  const journey=await readFile(new URL("apps/help/technical-academy/t05-journeys/personal-loan.html",root),"utf8");
  assert.match(journey,/Complete case matrix/);
  assert.match(journey,/Maturity and production boundary/);
  assert.match(journey,/Provider timeout/);
});

test("enterprise architecture explorer links every layer to role-relevant learning", async () => {
  const html=await readFile(new URL("apps/help/technical-academy/architecture/index.html",root),"utf8");
  assert.equal((html.match(/class="architecture-layer/g)??[]).length,6);
  assert.match(html,/View by responsibility/);
  assert.match(html,/Study this subsystem/);
  assert.match(html,/architecture-explorer\.js/);
  assert.doesNotMatch(html,/3D|HUD|sci-fi/i);
});

test("capability atlas renders every individual catalogue record", async () => {
  const atlas=await readFile(new URL("apps/help/technical-academy/capability-atlas/index.html",root),"utf8");
  assert.equal((atlas.match(/class="atlas-family-card"/g)??[]).length,33);
  let records=0;
  for(let number=1;number<=33;number++){
    const page=await readFile(new URL(`apps/help/technical-academy/capability-atlas/family-${String(number).padStart(2,"0")}.html`,root),"utf8");
    records+=(page.match(/class="capability-writeup"/g)??[]).length;
    assert.match(page,/Open the primary technical lesson/);
    assert.match(page,/Acceptance boundary/);
    assert.match(page,/Current maturity and gap/);
    assert.match(page,/Implementation and verification evidence/);
  }
  assert.equal(records,463);
});

test("integration atlas renders every external boundary with safe-failure guidance", async () => {
  const atlas=await readFile(new URL("apps/help/technical-academy/integration-atlas/index.html",root),"utf8");
  assert.equal((atlas.match(/class="atlas-family-card"/g)??[]).length,12);
  let records=0;
  for(const prefix of ["cus","los","rsk","lws","lms","col","colat","fin","reg","prt","plt","adm"]){
    const page=await readFile(new URL(`apps/help/technical-academy/integration-atlas/${prefix}.html`,root),"utf8");
    records+=(page.match(/class="integration-writeup"/g)??[]).length;
    assert.match(page,/Required external contract/);
    assert.match(page,/Current implementation boundary/);
    assert.match(page,/Mandatory failure behavior/);
    assert.match(page,/Certification and production checklist/);
  }
  assert.equal(records,115);
});

test("all 21 journeys render the complete visual and regulatory blueprint", async () => {
  const journeyModule=course.modules.find((module)=>module.id==="t05-journeys");
  for (const lesson of journeyModule.lessons.filter((item)=>item.journeyType)) {
    const html=await readFile(new URL(`apps/help/technical-academy/t05-journeys/${lesson.id}.html`,root),"utf8");
    assert.match(html,/class="journey-hero"/,`${lesson.journeyType}: visual hero`);
    assert.match(html,/class="journey-nav"/,`${lesson.journeyType}: compact navigation`);
    assert.match(html,/class="blueprint-grid"/,`${lesson.journeyType}: blueprint summary`);
    assert.match(html,/class="requirements-grid"/,`${lesson.journeyType}: facts and evidence`);
    assert.match(html,/class="reg-grid"/,`${lesson.journeyType}: regulatory map`);
    assert.equal((html.match(/class="reg-card"/g)??[]).length,lesson.regulations.length,`${lesson.journeyType}: all regulations rendered`);
    assert.equal((html.match(/class="stage-card"/g)??[]).length,6,`${lesson.journeyType}: six visual lifecycle stages`);
    assert.equal((html.match(/class="case-card"/g)??[]).length,17,`${lesson.journeyType}: expandable cases`);
    assert.match(html,/Maturity and production boundary/,`${lesson.journeyType}: honest maturity`);
    assert.doesNotMatch(html,/class="toc"/,`${lesson.journeyType}: old crowded sidebar removed`);
    assert.doesNotMatch(html,/<table/,`${lesson.journeyType}: wide case table removed`);
  }
});

test("journey catalogue exposes all products as scannable cards", async () => {
  const html=await readFile(new URL("apps/help/technical-academy/t05-journeys/index.html",root),"utf8");
  assert.equal((html.match(/class="journey-card"/g)??[]).length,21);
  assert.match(html,/<strong>21<\/strong> product blueprints/);
  assert.match(html,/<strong>17<\/strong> cases each/);
  assert.match(html,/Contract-generated/);
});
