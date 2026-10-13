import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createProgrammeService} from './programme-service.mjs';
import {createState,planningRequest,receiveProposal,approveProposal,changeConstraints,makeSheetHtml} from './public/state.js';
import {STORAGE_KEY,createWorkspaceSnapshot,parseWorkspaceSnapshot,restoreWorkspace,createWorkspaceStorage,datasetSignature} from './public/persistence.js';

// Every title, artist and rank is invented; no server or provider is contacted.
const fixture=JSON.parse(await readFile(new URL('../release/synthetic-data.json',import.meta.url),'utf8'));
const base=createProgrammeService(fixture).bootstrap();
const time='2026-10-13T00:00:00.000Z';
const clone=value=>structuredClone(value);
function approvedState(data=base) {
  const service=createProgrammeService(data);
  let state=createState(data);
  state=receiveProposal(state,service.repairOptions(planningRequest(state)),state.revision);
  state=approveProposal(state);
  return {...state,seasonName:'Fictional autumn season',organiserNote:'Bring discussion notes.',locked:state.approved.selection.slice(0,2)};
}
function customEvidence(number=1,{complete=true}={}) {
  const evidenceId='rb-taste-'+String(number).repeat(32);
  const artists=base.profiles.map((profile,index)=>({id:`00000000-0000-4000-8000-${String(number*10+index).padStart(12,'0')}`,
    name:profile.reference,type:'artist',rankSource:complete?'cached':index===0?'cached':null,rankedAt:complete||index===0?time:null}));
  const raw=clone(fixture);raw.dataset.id=evidenceId;
  raw.profiles.forEach((profile,index)=>Object.assign(profile,{referenceEntityId:artists[index].id,rankSource:'cached',rankedAt:time}));
  const dataset=createProgrammeService(raw).bootstrap();
  const packet={schemaVersion:1,evidenceId,status:complete?'complete':'pending',completedProfiles:complete?3:1,
    profileCount:3,artists,qlooRequests:0,guard:{remainingRequests:12,nextAllowedAt:null},nextProfile:complete?null:{...artists[1],index:1},
    ...(complete?{source:'custom_taste',dataset}:{})};
  const selected=artists.map((artist,index)=>({artistId:artist.id,searchId:'search-'+String(number*10+index).padStart(32,'0'),name:artist.name}));
  return {evidenceId,artists,dataset,packet,selected};
}
function withCustomEvidence(evidence=customEvidence()) {
  const state=approvedState(evidence.dataset);
  return {...state,exampleData:base,evidenceId:evidence.evidenceId,
    taste:{...state.taste,evidenceId:evidence.evidenceId,selected:evidence.selected,packet:evidence.packet}};
}
function memoryStorage() {
  const values=new Map();
  return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
}

test('approved order, brief, locks, notes and export survive a safe example restore',async()=>{
  const original=approvedState();
  const snapshot=await createWorkspaceSnapshot(original,{now:Date.parse(time)});
  const parsed=parseWorkspaceSnapshot(JSON.stringify(snapshot));
  assert.equal(parsed.status,'ready');
  const restored=await restoreWorkspace(parsed.snapshot,{exampleData:base});
  assert.equal(restored.status,'restored');
  assert.deepEqual(restored.state.approved,original.approved);
  assert.deepEqual(restored.state.locked,original.locked);
  assert.equal(restored.state.maximumRuntime,110);
  assert.equal(restored.state.seasonName,original.seasonName);
  assert.equal(restored.state.organiserNote,original.organiserNote);
  assert.deepEqual(restored.issues,[]);
  assert.equal(makeSheetHtml(restored.state),makeSheetHtml(original),'restoring preserves the actual approved programme sheet');
});

test('reload keeps an unresolved cancellation and brief conflict visibly unresolved',async()=>{
  const approved=approvedState();
  const original=changeConstraints(approved,{excluded:[approved.approved.selection[2]],maximumRuntime:60,slots:2});
  const snapshot=await createWorkspaceSnapshot(original);
  const restored=await restoreWorkspace(snapshot,{exampleData:base});
  assert.equal(restored.status,'restored');
  assert.deepEqual(restored.state.approved,approved.approved,'old approval is kept rather than silently cleared or renewed');
  assert.deepEqual(restored.state.locked,approved.locked);
  assert.deepEqual(restored.state.excluded,original.excluded);
  assert.equal(restored.state.maximumRuntime,60);
  assert.equal(restored.state.slots,2);
  assert.ok(restored.issues.some(issue=>issue.includes('unavailable')));
  assert.ok(restored.issues.some(issue=>issue.includes('exceeds')));
  assert.ok(restored.issues.some(issue=>issue.includes('needs 2')));
  assert.throws(()=>makeSheetHtml(restored.state),/Review this programme before exporting/);
});

test('pending proposals, in-flight operations, assistant output and access state never persist',async()=>{
  const original={...approvedState(),busy:true,agentPending:true,agentStatusBusy:true,proposal:{secret:'UNAPPROVED_PROPOSAL'},
    agentResponse:{answer:'PRIVATE_ASSISTANT_OUTPUT'},trace:[{secret:'PRIVATE_TOOL_TRACE'}],ownerAuthenticated:true,
    judgePassword:'FICTIONAL_PASSWORD',guestRemainingInteractions:24};
  const snapshot=await createWorkspaceSnapshot(original);
  const serialized=JSON.stringify(snapshot);
  assert.doesNotMatch(serialized,/UNAPPROVED_PROPOSAL|PRIVATE_ASSISTANT_OUTPUT|PRIVATE_TOOL_TRACE|FICTIONAL_PASSWORD|guestRemaining|Authenticated/);
  const restored=await restoreWorkspace(snapshot,{exampleData:base});
  assert.equal(restored.state.proposal,null);
  assert.equal(restored.state.agentResponse,null);
  assert.equal(restored.state.busy,false);
  assert.equal(restored.state.agentPending,false);
  assert.equal(restored.state.agentStatusBusy,false);
  assert.equal(restored.state.agentStatus,null);
  assert.equal(restored.state.agentVerified,false);
  assert.deepEqual(restored.state.trace,[]);
});

test('custom programme restoration needs canonical completed server evidence and saves no raw rankings',async()=>{
  const evidence=customEvidence();
  const original=withCustomEvidence(evidence);
  const snapshot=await createWorkspaceSnapshot(original);
  assert.equal(snapshot.activeEvidenceId,evidence.evidenceId);
  assert.equal(snapshot.checkpointEvidenceId,evidence.evidenceId);
  assert.doesNotMatch(JSON.stringify(snapshot),/"ranks"|"dataset"|"guard"|remainingRequests/);
  const unavailable=await restoreWorkspace(snapshot,{exampleData:base});
  assert.equal(unavailable.status,'evidence_unavailable');
  assert.equal(unavailable.snapshot,snapshot,'the recoverable bookmark is retained');
  assert.equal(unavailable.state,undefined,'unverified custom evidence does not become an active programme');
  const restored=await restoreWorkspace(snapshot,{exampleData:base,activeEvidencePacket:evidence.packet});
  assert.equal(restored.status,'restored');
  assert.equal(restored.checkpointRestored,true);
  assert.equal(restored.state.evidenceId,evidence.evidenceId);
  assert.deepEqual(restored.state.approved,original.approved);
  assert.deepEqual(restored.state.locked,original.locked);
  assert.equal(restored.state.taste.status,null,'live readiness must be checked separately');
  assert.equal(restored.state.taste.needsStatusCheck,true);
  assert.equal(makeSheetHtml(restored.state),makeSheetHtml(original));
});

test('partially collected artist evidence resumes beside the existing approved programme without applying it',async()=>{
  const active=customEvidence(1);
  const pending=customEvidence(2,{complete:false});
  const original=withCustomEvidence(active);
  original.taste={...original.taste,open:true,evidenceId:pending.evidenceId,selected:pending.selected,
    packet:pending.packet,pending:{kind:'rank',secret:'IN_FLIGHT_REQUEST'}};
  const snapshot=await createWorkspaceSnapshot(original);
  const restored=await restoreWorkspace(snapshot,{exampleData:base,activeEvidencePacket:active.packet,checkpointPacket:pending.packet});
  assert.equal(restored.status,'restored');
  assert.equal(restored.checkpointRestored,true);
  assert.equal(restored.state.evidenceId,active.evidenceId,'new evidence is never applied automatically');
  assert.deepEqual(restored.state.approved,original.approved);
  assert.equal(restored.state.taste.open,true);
  assert.equal(restored.state.taste.evidenceId,pending.evidenceId);
  assert.equal(restored.state.taste.packet.completedProfiles,1);
  assert.equal(restored.state.taste.pending,null);
  assert.deepEqual(restored.state.taste.selected.map(artist=>artist.artistId),pending.artists.map(artist=>artist.id));
  assert.equal(restored.state.taste.needsStatusCheck,true);
});

test('missing or changed checkpoint leaves the approved programme intact and its recoverable bookmark retained',async()=>{
  const pending=customEvidence(2,{complete:false});
  const original=approvedState();
  original.taste={...original.taste,evidenceId:pending.evidenceId,selected:pending.selected};
  const snapshot=await createWorkspaceSnapshot(original);
  for(const packet of [null,{...pending.packet,evidenceId:'rb-taste-'+ '3'.repeat(32)}]) {
    const restored=await restoreWorkspace(snapshot,{exampleData:base,checkpointPacket:packet});
    assert.equal(restored.status,'restored');
    assert.equal(restored.checkpointUnavailable,true);
    assert.equal(restored.snapshot,snapshot);
    assert.deepEqual(restored.state.approved,original.approved);
  }
});

test('unprepared artist searches are discarded while the stable approved workspace survives',async()=>{
  const original=approvedState();
  original.taste={...original.taste,queries:['Unconfirmed artist','',''],searches:[{options:[{name:'RAW_SEARCH_RESULT'}]},null,null],
    selected:[{artistId:'unconfirmed',searchId:'not-verified'},null,null]};
  const snapshot=await createWorkspaceSnapshot(original);
  assert.equal(snapshot.checkpointEvidenceId,null);
  assert.equal(snapshot.checkpointArtists,null);
  assert.doesNotMatch(JSON.stringify(snapshot),/Unconfirmed|RAW_SEARCH_RESULT|unconfirmed/);
  const restored=await restoreWorkspace(snapshot,{exampleData:base});
  assert.deepEqual(restored.state.taste.selected,[null,null,null]);
  assert.deepEqual(restored.state.approved,original.approved);
});

test('catalogue, ranking and provenance changes invalidate a saved workspace instead of silently remapping it',async()=>{
  const snapshot=await createWorkspaceSnapshot(approvedState());
  const changedFilms=clone(base);changedFilms.films[0].runtime++;
  assert.equal((await restoreWorkspace(snapshot,{exampleData:changedFilms})).reason,'catalogue_changed');
  const changedRanks=clone(base);changedRanks.profiles[0].ranks[base.films[0].id]=20;
  assert.equal((await restoreWorkspace(snapshot,{exampleData:changedRanks})).reason,'evidence_changed');
  const changedSource=clone(base);changedSource.dataset.checkedAt=time;
  assert.equal((await restoreWorkspace(snapshot,{exampleData:changedSource})).status,'obsolete');
  const rankOrder=clone(base);rankOrder.profiles[0].ranks=Object.fromEntries(Object.entries(rankOrder.profiles[0].ranks).reverse());
  assert.equal(await datasetSignature(rankOrder),await datasetSignature(base),'property insertion order does not make identical evidence obsolete');
});

test('mismatched or incomplete canonical custom evidence never unlocks a restored programme',async()=>{
  const evidence=customEvidence();
  const snapshot=await createWorkspaceSnapshot(withCustomEvidence(evidence));
  const different=customEvidence(2);
  const changed=clone(evidence.packet);changed.dataset.profiles[0].ranks[base.films[0].id]=20;
  for(const packet of [different.packet,customEvidence(1,{complete:false}).packet,{...evidence.packet,source:'recorded'},changed]) {
    const result=await restoreWorkspace(snapshot,{exampleData:base,activeEvidencePacket:packet});
    assert.notEqual(result.status,'restored');
    assert.equal(result.state,undefined);
    assert.equal(result.snapshot,snapshot);
  }
});

test('corrupt, oversized, obsolete and structurally invalid snapshots are handled without exceptions',async()=>{
  const snapshot=await createWorkspaceSnapshot(approvedState());
  assert.equal(parseWorkspaceSnapshot(null).status,'empty');
  assert.equal(parseWorkspaceSnapshot('{').status,'invalid');
  assert.equal(parseWorkspaceSnapshot(' '.repeat(16385)).status,'invalid');
  assert.equal(parseWorkspaceSnapshot(JSON.stringify({...snapshot,schemaVersion:999})).status,'obsolete');
  for(const altered of [
    {...snapshot,judgePassword:'FICTIONAL_SECRET'},
    {...snapshot,savedAt:'not-a-date'},
    {...snapshot,programme:{...snapshot.programme,maximumRuntime:241}},
    {...snapshot,programme:{...snapshot.programme,locked:[base.films.at(-1).id]}},
    {...snapshot,programme:{...snapshot.programme,approved:{...snapshot.programme.approved,source:'recorded'}}},
    {...snapshot,programme:{...snapshot.programme,approved:{...snapshot.programme.approved,selection:[base.films[0].id,base.films[0].id]}}},
  ])assert.equal(parseWorkspaceSnapshot(JSON.stringify(altered)).status,'invalid');
  const unknown=clone(snapshot);unknown.programme.excluded=['not-in-current-catalogue'];
  assert.equal((await restoreWorkspace(unknown,{exampleData:base})).status,'invalid');
});

test('storage denial and quota failures do not throw or destroy an earlier saved programme',async()=>{
  const snapshot=await createWorkspaceSnapshot(approvedState());
  const denied=createWorkspaceStorage({getStorage:()=>{throw Error('SecurityError');}});
  assert.equal(denied.read().status,'unavailable');
  assert.equal(denied.write(snapshot).status,'unavailable');
  assert.equal(denied.clear().status,'unavailable');
  const memory=memoryStorage();const storage=createWorkspaceStorage({getStorage:()=>memory});
  assert.equal(storage.write(snapshot).status,'saved');
  const previous=memory.getItem(STORAGE_KEY);
  memory.setItem=()=>{throw Error('QuotaExceededError');};
  assert.equal(storage.write({...snapshot,savedAt:'2026-10-13T01:00:00.000Z'}).status,'unavailable');
  assert.equal(memory.getItem(STORAGE_KEY),previous);
});

test('expected storage value detects another tab before overwrite or reset; explicit reset clears the snapshot',async()=>{
  const snapshot=await createWorkspaceSnapshot(approvedState());
  const memory=memoryStorage();const storage=createWorkspaceStorage({getStorage:()=>memory});
  const first=storage.write(snapshot,{expectedSerialized:null});
  assert.equal(first.status,'saved');
  const next={...snapshot,savedAt:'2026-10-13T01:00:00.000Z'};
  const anotherTab=storage.write(next,{expectedSerialized:first.serialized});
  assert.equal(anotherTab.status,'saved');
  assert.equal(storage.write(snapshot,{expectedSerialized:first.serialized}).status,'conflict');
  assert.equal(storage.clear({expectedSerialized:first.serialized}).status,'conflict');
  assert.equal(storage.read().serialized,anotherTab.serialized);
  assert.equal(storage.clear({expectedSerialized:anotherTab.serialized}).status,'cleared');
  assert.equal(storage.read().status,'empty');
});

test('recorded walkthroughs do not replace the real saved workspace, including a retained recorded approval',async()=>{
  const state=approvedState();
  assert.equal(await createWorkspaceSnapshot({...state,mode:'recorded'}),null);
  assert.equal(await createWorkspaceSnapshot({...state,approved:{...state.approved,source:'recorded'}}),null);
});

test('approved export keeps night order and makes agreement, discrepancies and missing runtime evidence explicit',()=>{
  const data=clone(base);
  // Invented metadata exercises the genuine-evidence presentation branch only.
  data.dataset.synthetic=false;
  data.dataset.source='Injected fictional export-test evidence';
  const state=approvedState(data);
  const selected=state.approved.selection.map(id=>data.films.find(film=>film.id===id));
  selected[0].runtime=94;selected[0].primaryRuntime=94;
  selected[0].sourceUrl='https://example.invalid/film-facts';
  selected[0].metadataNote='Injected identity check: source lists 2002; Qloo-year fixture lists 2001.';
  selected[0].year=2001;
  selected[1].runtime=96;selected[1].primaryRuntime=97;
  selected[1].metadataNote='Injected source-runtime discrepancy must remain visible.';
  selected[2].runtime=100;selected[2].primaryRuntime=null;
  selected[2].metadataNote='No primary-source runtime recorded for this fixture.';
  const html=makeSheetHtml(state);
  assert.match(html,/94 min · planning and primary source agree/);
  assert.match(html,/96 min planning · 97 min primary source/);
  assert.match(html,/100 min planning · primary-source runtime not recorded/);
  assert.match(html,/2001 \(Qloo year\)/);
  assert.match(html,/source lists 2002; Qloo-year fixture lists 2001/);
  assert.match(html,/Injected source-runtime discrepancy must remain visible/);
  assert.match(html,/href="https:\/\/example\.invalid\/film-facts"/);
  assert.match(html,/aria-label="Approved programme summary"/);
  assert.match(html,/Up to 110 min per film/);
  assert.deepEqual([...html.matchAll(/<h3>([^<]*)<\/h3>/g)].map(match=>match[1]),selected.map(film=>film.name));
  assert.ok(html.indexOf('NIGHT 01')<html.indexOf('NIGHT 02')&&html.indexOf('NIGHT 02')<html.indexOf('NIGHT 03'));
  assert.match(html,/Before screening:/);
  assert.ok(html.includes(data.dataset.eligibility));
  assert.ok(html.includes(data.dataset.runtimePolicy));
});

test('each exported film shows all original ranks, keeping outside-top-five and unknown evidence distinct',()=>{
  const data=clone(base);
  const state=approvedState(data);
  const filmId=state.approved.selection[0];
  data.profiles[0].ranks[filmId]=6;
  delete data.profiles[1].ranks[filmId];
  data.profiles[2].ranks[filmId]=2;
  const html=makeSheetHtml(state);
  const firstEntry=html.match(/<section class="sheet-entry">([\s\S]*?)<\/section>/)[1];
  for(const profile of data.profiles)assert.ok(firstEntry.includes(profile.reference));
  assert.match(firstEntry,/<strong>#6<\/strong><small>Outside top five<\/small>/);
  assert.match(firstEntry,/<strong>Unknown<\/strong><small>No ranking evidence<\/small>/);
  assert.match(firstEntry,/<strong>#2<\/strong><small>Top five<\/small>/);
  assert.equal(data.profiles[0].ranks[filmId],6,'rendering does not promote rank six or mutate the evidence');
  assert.equal(Object.hasOwn(data.profiles[1].ranks,filmId),false);
  assert.match(html,/not a prediction of enjoyment or attendance/);
  assert.ok(html.includes(data.dataset.disclosure));
});

test('export preserves synthetic, example, custom and recorded modes plus per-reference provenance',()=>{
  const synthetic=makeSheetHtml(approvedState());
  assert.match(synthetic,/APPROVED SYNTHETIC SETUP PROGRAMME/);
  assert.match(synthetic,/Invented original ranks/);
  assert.match(synthetic,/invented planning runtime/);
  assert.doesNotMatch(synthetic,/Original Qloo ranks|planning and primary source agree/);
  const data=clone(base);data.dataset.synthetic=false;
  data.dataset.source='Injected fictional export-test evidence';data.dataset.checkedAt=time;
  data.profiles.forEach(profile=>{profile.rankedAt=time;profile.rankSource='cached';});
  const state=approvedState(data);
  const example=makeSheetHtml(state);
  assert.match(example,/APPROVED EXAMPLE PROGRAMME/);
  assert.match(example,/Original Qloo ranks/);
  assert.match(example,/Injected fictional export-test evidence snapshot from 13 October 2026/);
  for(const profile of data.profiles)assert.ok(example.includes(`${profile.reference}: Saved Qloo evidence · 13 October 2026; 20/20 films scored.`));
  assert.match(makeSheetHtml({...state,evidenceId:'rb-taste-'+ '9'.repeat(32)}),/APPROVED CUSTOM TASTE PROGRAMME/);
  const recorded=makeSheetHtml({...state,mode:'recorded',approved:{...state.approved,source:'recorded'}});
  assert.match(recorded,/APPROVED RECORDED DEMO PROGRAMME/);
  assert.match(recorded,/this replay made zero new OpenAI or Qloo API requests/);
  assert.match(recorded,/The organiser explicitly approved these example selections/);
  assert.ok(recorded.includes(state.approved.approvedAt));
});

test('compact export escapes programme, reference, note and source text without silently claiming source verification',()=>{
  const data=clone(base);data.dataset.synthetic=false;
  data.profiles[0].reference='Fictional <reference> & friends';
  const state=approvedState(data);
  state.seasonName='A <season> & "name"';state.organiserNote='<img src="invalid" onerror="unsafe()">';
  const selected=state.approved.selection.map(id=>data.films.find(film=>film.id===id));
  selected[0].metadataNote='Source <note> & discrepancy';
  selected[1].metadataNote='';selected[1].sourceUrl=null;selected[1].primaryRuntime=null;
  const html=makeSheetHtml(state);
  assert.match(html,/A &lt;season&gt; &amp; &quot;name&quot;/);
  assert.match(html,/Fictional &lt;reference&gt; &amp; friends/);
  assert.match(html,/Source &lt;note&gt; &amp; discrepancy/);
  assert.match(html,/&lt;img src=&quot;invalid&quot; onerror=&quot;unsafe\(\)&quot;&gt;/);
  assert.doesNotMatch(html,/<img|<reference>|<season>|<note>/);
  assert.match(html,/No identity or runtime cross-check note recorded/);
  assert.match(html,/Film facts source not recorded/);
});
