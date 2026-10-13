import {createState,planningRequest,changeConstraints,receiveProposal,approveProposal,
  receiveAgentResponse,proposalPlanningState,supportRows,selectionProblems,usableFilms,makeSheetHtml,
  enterRecordedDemo,canStageRecordedCancellation,stageRecordedCancellation,exitRecordedDemo,
  bindTasteEvidence,evidenceDate,tasteSourceLabel,normalizeArtistQuery,tasteLiveReady,openTastePicker,changeTasteQuery,confirmTasteArtist,tasteSelectionRequest,
  beginTasteOperation,failTasteOperation,receiveTasteStatus,receiveTasteSearch,receiveTasteProgress,applyTasteDataset,resetExampleState,escapeHtml as esc} from './state.js';
import {STORAGE_KEY,createWorkspaceSnapshot,createWorkspaceStorage,restoreWorkspace} from './persistence.js';
import {explainReplacement,summarizeRepair} from './replacement.js';

const content=document.querySelector('#app-content');
let state;
let demoPacket;
let toastTimer;
let agentStatusRequest=0;
let accessStatus;
let deferredFocus;
let accessStatusRequest=0;
let readinessTimer;
let workspaceBeforeReplay;
let planningToolsOpen=false;
let lastRenderedProposal;
let lastAnnouncement='';
const workspaceStorage=createWorkspaceStorage({getStorage:()=>window.localStorage});
let persistenceReady=false;
let savedSerialized=null;
let savedSnapshotBody=null;
let saveSequence=0;
let workspaceNotice=null;
let savedWorkspaceBlocked=false;
let savingUnavailable=false;
let workspaceRestoreSequence=0;
function renderSaveNotice() {
  if(workspaceNotice)return `<div class="workspace-save warning"><span>${esc(workspaceNotice)}</span>${savedWorkspaceBlocked?'<button class="text-button" data-action="workspace-retry">Retry saved workspace</button><button class="text-button" data-action="workspace-discard">Start fresh</button>':''}</div>`;
  return '';
}
function updateSaveIndicator() {
  const label=document.querySelector('#workspace-save-label');
  if(!label)return;
  label.textContent=workspaceNotice?'Saving needs attention':state.mode==='recorded'?'Your programme kept':savedSnapshotBody?'Saved here':'Preparing browser saving…';
  label.title=workspaceNotice??'Saved in this browser. Reload restores your brief and approved choices; unapproved proposals stay separate.';
  label.classList.toggle('needs-attention',Boolean(workspaceNotice));
}
async function saveWorkspace() {
  if(!persistenceReady||savedWorkspaceBlocked||savingUnavailable||state.mode==='recorded')return;
  const sequence=++saveSequence;
  const current=structuredClone(state);
  try {
    const snapshot=await createWorkspaceSnapshot(current);
    if(!snapshot||sequence!==saveSequence||savedWorkspaceBlocked)return;
    const body=JSON.stringify({...snapshot,savedAt:null});
    if(body===savedSnapshotBody)return;
    const result=workspaceStorage.write(snapshot,{expectedSerialized:savedSerialized});
    if(result.status==='saved'){savedSerialized=result.serialized;savedSnapshotBody=body;updateSaveIndicator();return;}
    workspaceNotice=result.status==='conflict'?'Another tab changed the saved programme. Reload to use its version, or start fresh here.':'Browser saving is unavailable. Keep this tab open and export your approved programme before leaving.';
    savedWorkspaceBlocked=result.status==='conflict';
    savingUnavailable=!savedWorkspaceBlocked;
  } catch {if(sequence!==saveSequence)return;workspaceNotice='Browser saving is unavailable. Keep this tab open and export your approved programme before leaving.';savingUnavailable=true;}
  render();
  announce(workspaceNotice);
}
async function restoreSavedWorkspace() {
  const restoreSequence=++workspaceRestoreSequence;
  persistenceReady=false;++saveSequence;
  const stored=workspaceStorage.read();
  savedSerialized=stored.serialized??null;
  savedSnapshotBody=null;workspaceNotice=null;savedWorkspaceBlocked=false;savingUnavailable=false;
  if(stored.status==='ready') {
    const packets=new Map();
    for(const id of new Set([stored.snapshot.activeEvidenceId,stored.snapshot.checkpointEvidenceId].filter(Boolean))) {
      try {
        const response=await fetch('/api/tastes/progress?evidenceId='+encodeURIComponent(id),{signal:AbortSignal.timeout(10000)});
        if(response.ok)packets.set(id,await response.json());
      } catch {}
    }
    const restored=await restoreWorkspace(stored.snapshot,{exampleData:state.exampleData??state.data,
      activeEvidencePacket:packets.get(stored.snapshot.activeEvidenceId),checkpointPacket:packets.get(stored.snapshot.checkpointEvidenceId)});
    if(restoreSequence!==workspaceRestoreSequence||workspaceStorage.read().serialized!==stored.serialized) {
      savedWorkspaceBlocked=true;workspaceNotice='Another tab changed the saved programme. Retry to load its version, or start fresh here.';persistenceReady=true;return;
    }
    if(restored.status==='restored') {
      state=restored.state;
      savedSnapshotBody=JSON.stringify({...stored.snapshot,savedAt:null});
      if(restored.checkpointUnavailable){savedWorkspaceBlocked=true;workspaceNotice='Your programme is restored, but the saved artist collection could not be verified. Retry to recover it, or start fresh.';}
      else announce(restored.issues.length?'Your approved programme is restored. Its unresolved changes still need review.':'Your saved programme is restored.');
    } else {savedWorkspaceBlocked=true;workspaceNotice=restored.status==='obsolete'?'The saved programme uses an older catalogue or evidence version. Start fresh to use the current evidence.':'The saved programme evidence could not be verified. Retry to recover it, or start fresh. Your saved version is kept.';}
  } else if(stored.status==='unavailable'){workspaceNotice='Browser saving is unavailable. Keep this tab open and export your approved programme before leaving.';savingUnavailable=true;}
  else if(stored.status!=='empty'){savedWorkspaceBlocked=true;workspaceNotice='The saved programme could not be read safely. Start fresh to save a new programme.';}
  persistenceReady=true;
}
function announce(message) {
  if(!message||message===lastAnnouncement)return;
  lastAnnouncement=message;
  const status=document.querySelector('#operation-status');
  if(status)status.textContent=message;
}
const synthetic=()=>state?.data.dataset.synthetic===true;
const icon=(name)=>({lock:'<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4" y="8" width="12" height="9" rx="2"/><path d="M6.5 8V5a3.5 3.5 0 0 1 7 0v3"/></svg>',unlock:'<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4" y="8" width="12" height="9" rx="2"/><path d="M7 8V5a3.5 3.5 0 0 1 6.7-1.4"/></svg>',check:'<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4 10 4 4 8-8"/></svg>',arrow:'<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 10h13m-5-5 5 5-5 5"/></svg>'}[name]??'');
const film=id=>state.data.films.find(f=>f.id===id);
const name=id=>film(id)?.name??'Unknown film';
let judgeSignInPending=false;
const authenticatedAccess=()=>Boolean(accessStatus?.ownerAuthenticated||accessStatus?.judgeAuthenticated);
const canUseCustomArtists=()=>authenticatedAccess()||accessStatus?.publicCustomAccess===true;
const guestAccess=()=>accessStatus?.mode==='public'&&!authenticatedAccess();
const expiredAccess=error=>['owner_required','custom_access_required','access_session_required','guest_session_required'].includes(error.code);
const expiredAccessMessage=()=>state.sessionAccessExpired?'Your browser session expired. Check availability to continue; your programme is kept.':state.ownerAccessExpired?'Your access expired. Sign in to continue; your programme is kept.':null;
const signInAction=()=>accessStatus?.judgeSignInAvailable?'judge-open':'owner-open';
const disabled=()=>state.busy?'disabled':'';
const editDisabled=()=>state.busy||state.mode==='recorded'?'disabled':'';
const availableIds=()=>usableFilms(state,state.data.films.map(f=>f.id)).map(f=>f.id);
const profileClass=profile=>`profile-${state.data.profiles.findIndex(p=>p.id===profile.id)}`;
function notify(message) {
  const toast=document.querySelector('#toast');
  toast.textContent=message;toast.hidden=false;
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>{toast.hidden=true;},4200);
}
function heading(eyebrow,title,subtitle) {
  return `<div class="page-heading"><div><div class="eyebrow tiny-label"><span></span>${eyebrow}</div><h1>${title}</h1><p class="subtitle">${subtitle}</p></div><div class="edition"><strong>The October edit</strong>THREE TASTES · A SHORT SEASON</div></div>`;
}
function renderRecordedGuide() {
  if(synthetic()||accessStatus?.recordedAvailable===false)return '';
  if(state.mode!=='recorded')return `<section class="demo-entry" aria-label="Optional recorded walkthrough"><div><span class="tiny-label">OPTIONAL WALKTHROUGH</span><p>Explore a cancellation with recorded Luna answers. Your current workspace will be kept.</p></div><button class="text-button" data-action="demo-start" ${disabled()}>Open recorded walkthrough ${icon('arrow')}</button></section>`;
  const initialApproved=!!state.approved;
  const cancelled=state.recordedStage==='cancellation';
  const completed=cancelled && !state.proposal && initialApproved;
  const heading=completed?'Your repair is approved.':cancelled?'Two kept nights. One decision to make.':initialApproved?'The season is approved. Now one film drops out.':'Review the first draft before approving it.';
  return `<section class="demo-guide" aria-label="Recorded Luna demo"><div class="demo-guide-heading"><div><span class="tiny-label">RECORDED WALKTHROUGH</span><h2>${heading}</h2></div><span class="badge neutral">Recorded replay</span></div><p class="demo-disclosure">Luna’s answers were saved on 6 October 2026. Review the proposals and make the final decisions yourself.</p><details class="response-details"><summary>Walkthrough source</summary><p>Genuine saved GPT-6 Luna answers and Qloo rankings, checked against the planning tools. This replay makes no new OpenAI or Qloo requests.</p></details><ol class="demo-steps" aria-label="Demo stages"><li class="${initialApproved?'complete':'current'}">1. Approve the draft</li><li class="${cancelled?'complete':initialApproved?'current':''}">2. Stage a cancellation</li><li class="${completed?'complete':cancelled?'current':''}">3. Approve a repair</li></ol><div class="demo-actions">${!cancelled?`<button class="button primary small" data-action="demo-cancel" ${canStageRecordedCancellation(state,demoPacket)?'':'disabled'}>Stage cancellation · keep Nights 1 & 2${icon('arrow')}</button>`:`<span class="demo-next">${completed?`${state.maximumRuntime}-minute limit approved. Locked nights kept.`:'Compare the 110-minute repair and optional 117-minute limit below. Neither is applied yet.'}</span>`}<button class="text-button" data-action="demo-start" ${disabled()}>Restart walkthrough</button><button class="text-button" data-action="demo-exit" ${disabled()}>Return to my programme</button></div></section>`;
}
function renderProfiles(compact=false) {
  return `<div class="taste-profiles ${compact?'compact-profiles':''}" aria-label="Music references">${state.data.profiles.map((p,i)=>`<div class="profile-card profile-${i}"><div class="profile-art" aria-hidden="true"></div><div><small>Music reference ${String(i+1).padStart(2,'0')}</small><strong>${esc(p.reference)}</strong><div class="reference-label">${synthetic()?'Invented setup reference':'Music taste → film rankings'}</div></div><span class="profile-code">${String(i+1).padStart(2,'0')}</span></div>`).join('')}</div>`;
}
const sourceLabel=tasteSourceLabel;
const profileEvidence=profile=>synthetic()?'Invented ranks · setup example':`${sourceLabel(profile.rankSource??'cached_example')} · ${evidenceDate(profile.rankedAt??state.data.dataset.checkedAt)}`;
function tasteRequestBlocked() {
  return state.busy||state.sessionAccessExpired||!tasteLiveReady(state);
}
function renderTastePicker() {
  if(state.mode==='recorded')return '';
  if(synthetic())return '<div class="recorded-mode-banner"><strong>Synthetic setup example</strong><span>Invented titles, music references and ranks. Manual planning only.</span></div>';
  if(accessStatus?.mode==='public'&&!canUseCustomArtists())return `<div class="taste-entry"><span>Start with the example music references, or sign in to choose your own.</span>${accessStatus.judgeSignInAvailable?'<button class="text-button" data-action="judge-open">Judge sign in</button>':''}${accessStatus.ownerSignInAvailable?'<button class="text-button" data-action="owner-open">Organiser sign in</button>':''}</div>`;
  const taste=state.taste;
  if(!taste.open)return `<div class="taste-entry"><span>${state.evidenceId?'Your artist profiles are applied.':'Make the season personal with your own music references.'}</span><button class="text-button" data-action="taste-open" ${disabled()}>Choose artists ${icon('arrow')}</button></div>`;
  const guard=taste.status?.guard,packet=taste.packet,known=taste.status?.knownArtists?.options?.length?taste.status.knownArtists:null;
  const confirmed=taste.selected.filter(Boolean).length;
  const waiting=guard?.nextAllowedAt&&new Date(guard.nextAllowedAt).getTime()>Date.now();
  const qlooQuota=guestAccess()&&Number.isInteger(guard?.guestRemainingQlooRequests)&&Number.isInteger(guard?.guestMaxQlooRequestsPerDay)?` ${guard.guestRemainingQlooRequests}/${guard.guestMaxQlooRequestsPerDay} live artist requests remain in this browser today.`:Number.isInteger(guard?.remainingRequests)?` ${guard.remainingRequests}/${guard.dailyAttemptLimit} attempts remain this UTC day.`:'';
  const readiness=state.sessionAccessExpired?'Your browser session expired. Check availability to continue.':guard?.busy?'An artist request is in progress. Check saved progress when it finishes.':guard?.paused?'Live artist requests are paused. Check availability for recovery information.':guard?.remainingRequests===0?'Today’s live artist allowance is used.':!taste.status?'Checking artist availability…':!taste.status.liveEnabled?'Live artist requests are unavailable. Your example programme remains available.':waiting?`Your completed work is kept. Next live request in <span class="taste-countdown">${Math.ceil((new Date(guard.nextAllowedAt).getTime()-Date.now())/1000)} seconds</span>.`:'Ready to search or collect one artist’s rankings.';
  const matches=(options,searchId,index,source,date)=>options.map(artist=>{
    const selected=taste.selected[index]?.artistId===artist.id;
    const duplicate=taste.selected.some((pick,i)=>i!==index&&pick?.artistId===artist.id);
    return `<li><div><strong>${esc(artist.name)}</strong><small>${source==='live'?'Qloo artist match':'Saved Qloo artist match'} · ${esc(evidenceDate(date))}</small></div><button class="button secondary small" data-action="taste-confirm" data-index="${index}" data-search-id="${esc(searchId)}" data-artist-id="${esc(artist.id)}" ${state.busy||duplicate?'disabled':''}>${selected?'Confirmed':duplicate?'Already selected':'Choose'}</button></li>`;
  }).join('');
  return `<section class="panel taste-picker" aria-label="Choose three music artists"><div class="taste-picker-heading"><div><span class="tiny-label">MAKE IT YOUR SEASON</span><h2>Choose three music references.</h2></div><button class="text-button" data-action="taste-close" ${disabled()}>Close</button></div><ol class="taste-stages"><li class="${confirmed===3?'complete':'current'}">Choose artists</li><li class="${packet?.status==='complete'?'complete':confirmed===3?'current':''}">Collect film rankings</li><li>Start your programme</li></ol><p class="taste-intro">Each artist is ranked against the same ${state.data.films.length}-film shortlist. Your programme stays in place until you apply the completed profiles.</p><p class="taste-time">New artists take a few minutes: three searches and three rankings, with a 60-second gap between live requests (about five minutes of waiting, plus processing). Saved matches and rankings can be quicker. Close this panel to keep planning while you wait.</p><div class="taste-readiness"><p>${readiness}</p><button class="text-button" data-action="taste-status" ${disabled()}>${taste.pending?.kind==='status'?'Checking…':'Check availability'}</button></div>${taste.needsStatusCheck?'<p class="taste-notice">The last request stopped. Check availability before continuing.</p>':''}${taste.error?`<p class="agent-error" role="alert">${esc(taste.error)}</p>`:''}<div class="artist-pickers">${Array.from({length:3},(_,index)=>{
    const selection=taste.selected[index],search=taste.searches[index];
    return `<section class="artist-picker profile-${index}"><span class="tiny-label">REFERENCE ${String(index+1).padStart(2,'0')}</span><label class="form-label" for="artist-query-${index}">Artist name</label><div class="artist-search"><input class="field" id="artist-query-${index}" type="search" maxlength="80" data-artist-query="${index}" value="${esc(taste.queries[index])}" placeholder="Type an artist name" ${disabled()}><button class="button secondary small" data-action="taste-search" data-index="${index}" ${state.busy||!taste.queries[index].trim()?'disabled':''}>${taste.pending?.kind==='search'&&taste.pending.index===index?'Searching…':tasteRequestBlocked()?'Search saved':'Search'}</button></div>${selection?`<div class="artist-confirmed">${icon('check')}<span><strong>${esc(selection.name)}</strong>Artist confirmed</span></div>`:'<p class="artist-selection-hint">Choose a match below.</p>'}${search?`<ul class="artist-matches" aria-label="Artist search matches">${matches(search.options,search.searchId,index,search.source,search.fetchedAt)||'<li>No matches. Try another artist name.</li>'}</ul>`:''}${known?`<details class="known-artists"><summary>Choose an example artist</summary><ul class="artist-matches">${matches(known.options,known.searchId,index,known.source,known.fetchedAt)}</ul></details>`:''}</section>`;
  }).join('')}</div><div class="taste-prepare"><span>${confirmed} of 3 artists chosen</span><button class="button secondary" data-action="taste-select" ${state.busy||confirmed!==3?'disabled':''}>Prepare film rankings ${icon('arrow')}</button></div>${packet?`<div class="taste-progress"><div class="section-heading"><h3>Your film rankings</h3><span class="badge ${packet.status==='complete'?'':'neutral'}">${packet.completedProfiles}/3 ready</span></div><ol class="taste-rank-steps">${packet.artists.map((artist,index)=>`<li class="${artist.rankSource?'complete':''}"><b>${String(index+1).padStart(2,'0')}</b><div><strong>${esc(artist.name)}</strong><small>${artist.rankSource?`Qloo rankings ready · ${esc(evidenceDate(artist.rankedAt))}${artist.unknownFilmCount?` · ${artist.unknownFilmCount} unknown ranks`:''}`:'Ready to collect film rankings'}</small></div></li>`).join('')}</ol>${packet.status==='complete'?`<div class="taste-apply"><p>Applying these profiles starts a fresh programme and clears your current selections, locks and approvals. Your approved programme and this collection checkpoint are saved in this browser when storage is available.</p><button class="button primary" data-action="taste-apply" ${disabled()}>Start programme with these artists ${icon('arrow')}</button></div>`:`<div class="taste-step-actions"><button class="button primary" data-action="taste-rank" ${tasteRequestBlocked()||packet.status!=='pending'?'disabled':''}>${taste.pending?.kind==='rank'?'Collecting rankings…':`Collect rankings for ${esc(packet.nextProfile?.name??'next artist')}`} ${icon('arrow')}</button><button class="text-button" data-action="taste-progress" ${disabled()}>Check saved progress</button></div>`}</div>`:''}<details class="taste-controls"><summary>Sources & request limits</summary><p>Each explicit search or ranking step makes at most one Qloo request, with at least 60 seconds between live requests. Requests are never retried automatically.${qlooQuota}${guard?.pauseReason?` Pause reason: ${esc(guard.pauseReason)}.`:''}</p><p>Saved artist matches and completed rankings are reused. Only this fixed shortlist is ranked; missing ranks stay unknown and filters never renumber the original ranks.</p>${packet?packet.artists.filter(a=>a.rankSource).map(a=>`<p>${esc(a.name)}: ${esc(sourceLabel(a.rankSource))}, ${a.returnedCount??0}/${state.data.films.length} films scored.</p>`).join(''):''}</details></section>`;
}
function scheduleTasteReadiness() {
  clearTimeout(readinessTimer);
  if(state.mode==='recorded'||!state.taste.open||!state.taste.status?.guard?.nextAllowedAt)return;
  const deadline=new Date(state.taste.status.guard.nextAllowedAt).getTime();
  if(!Number.isFinite(deadline)||deadline<=Date.now())return;
  const tick=()=>{
    if(!state.taste.open||state.mode==='recorded')return;
    const seconds=Math.ceil((deadline-Date.now())/1000);
    if(seconds<=0){render();announce('The waiting interval has ended. You can continue with the next explicit artist request.');return;}
    const label=content.querySelector('.taste-countdown');
    if(label)label.textContent=`${seconds} seconds`;
    readinessTimer=setTimeout(tick,Math.min(1000,deadline-Date.now()));
  };
  readinessTimer=setTimeout(tick,Math.min(1000,deadline-Date.now()));
}
function filmCard(id,index,draft=false,context=state) {
  const f=film(id);
  const excluded=context.excluded.includes(id);
  const over=f.runtime>context.maximumRuntime;
  const locked=state.locked.includes(id);
  const topProfiles=state.data.profiles.filter(p=>Number.isInteger(p.ranks[id]) && p.ranks[id]<=5);
  const palette=(Number(f.catalogue_id.replace('F',''))-1)%6;
  return `<article class="film-card ${excluded?'unavailable':''}" data-film-card="${id}"><div class="night-heading">NIGHT ${String(index+1).padStart(2,'0')}<span>${draft?'Draft':locked?'Kept choice':'Your selection'}</span></div><div class="poster poster-${palette} ${excluded?'poster-cancelled':''}" aria-hidden="true"><span class="poster-masthead">THE OCTOBER EDIT / REELBALANCE</span><span class="poster-number">${String(index+1).padStart(2,'0')}</span><div><div class="poster-title ${f.name.length>23?'long':''}">${esc(f.name)}</div><div class="poster-footer">${f.year} &nbsp; / &nbsp; ${f.runtime} MINUTES</div></div></div><h3 class="film-name">${esc(f.name)}</h3><div class="film-meta"><span>${f.year}</span><span>${f.runtime} min</span><button class="film-fact-button" data-action="facts" data-id="${id}" aria-label="Film facts for ${esc(f.name)}">Facts</button></div><div class="film-support-dots" aria-label="${esc(excluded || over?'No usable support while unavailable or over the runtime limit':topProfiles.map(p=>`${p.reference} top-five ranking support`).join(', ')||'No top-five ranking support')}">${!excluded && !over?topProfiles.map(p=>`<span class="support-dot ${profileClass(p)}" title="${esc(p.reference)} · original rank ${p.ranks[id]}"></span>`).join(''):''}</div>${!draft?`<div class="film-actions"><button class="lock-button" data-action="lock" data-id="${id}" aria-pressed="${locked}" ${editDisabled()}>${icon(locked?'lock':'unlock')}${locked?'Locked':'Lock choice'}</button><button class="cancel-button" data-action="availability" data-id="${id}" ${editDisabled()}>${excluded?'Restore film':'Mark unavailable'}</button></div>`:''}${excluded?'<span class="badge warn">Unavailable</span>':over?'<span class="badge warn">Over runtime limit</span>':''}</article>`;
}
function emptySlot(index) {
  return `<div class="film-card"><div class="night-heading">NIGHT ${String(index+1).padStart(2,'0')}</div><div class="empty-poster"><b>${String(index+1).padStart(2,'0')}</b><span>A PLACE IN YOUR SEASON</span></div><p class="empty-caption">Waiting for a film</p></div>`;
}
function renderSupport(ids,context=state) {
  if(!ids.length)return '<section class="support-panel support-empty"><h3>Music references in your programme</h3><p>Build a programme to see which films match your music references.</p></section>';
  const rows=supportRows(context,ids);
  const count=rows.filter(r=>r.supported).length;
  return `<section class="support-panel" aria-label="Programme ranking support"><div class="support-heading"><h3>Music references represented</h3><span>${count} of ${rows.length} have a top-five film</span></div>${rows.map((row,i)=>{
    const match=usableFilms(context,ids).find(f=>row.profile.ranks[f.id]===row.bestRank);
    return `<div class="support-row profile-${i}"><div class="support-name"><span class="support-dot"></span>${esc(row.profile.reference)}</div><div class="support-match"><strong>${match?esc(match.name):'No ranked film selected'}</strong><small>${row.bestRank===null?'Unknown ranking evidence':`Original rank #${row.bestRank}${row.supported?'':' · outside top five'}`}</small></div><span class="support-check ${row.supported?'':'missing'}">${row.supported?'✓ Top five':row.bestRank===null?'Unknown':'Outside top five'}</span></div>`;
  }).join('')}<details class="response-details"><summary>How this is measured</summary><p>A music reference is represented when at least one available selected film is in its original Qloo top five within this fixed shortlist. This describes ranking evidence, not predicted enjoyment. Missing ranks stay unknown.</p></details></section>`;
}
function renderBrief() {
  const ids=availableIds();
  return `<section class="panel brief-panel" aria-label="Programme brief"><span class="tiny-label">THE PARAMETERS</span><h2>Your season brief</h2><div class="brief-layout"><div class="field-title"><label class="form-label" for="season-name">Programme name</label><input class="field" id="season-name" value="${esc(state.seasonName)}" maxlength="80" ${editDisabled()}></div><div><label class="form-label">Screening nights</label><div class="segmented" role="group" aria-label="Screening nights"><button data-action="slots" data-count="2" aria-pressed="${state.slots===2}" ${editDisabled()}>2 nights</button><button data-action="slots" data-count="3" aria-pressed="${state.slots===3}" ${editDisabled()}>3 nights</button></div></div><div><label class="form-label" for="runtime-limit">Maximum film runtime</label><div class="field-row"><input class="field" id="runtime-limit" type="number" min="1" max="240" step="1" value="${state.maximumRuntime}" ${editDisabled()}><span class="field-unit">minutes</span></div></div></div><details id="brief-notes" class="brief-notes"><summary>Add a note to the programme sheet</summary><label class="form-label" for="organiser-note">Organiser note</label><textarea class="field" id="organiser-note" maxlength="800" rows="3" ${editDisabled()}>${esc(state.organiserNote)}</textarea></details><div class="brief-divider"></div><div class="brief-summary"><span>Within your shortlist & limit</span><strong>${ids.length} films</strong></div><div class="brief-summary"><span>Locked decisions</span><strong>${state.locked.length} ${state.locked.length===1?'film':'films'}</strong></div><button class="button secondary full" data-action="plan" ${editDisabled()}>${state.busy?'Checking the programme…':state.approved?'Review programme manually':'Build draft manually'}${icon('arrow')}</button><p class="brief-hint">${state.mode==='recorded'?'Use the recorded-demo controls above. Return to your programme to edit this brief.':state.approved?'Changes stay proposals until you approve them.':state.evidenceId?'Build a new draft with your confirmed artist references. Every selection still needs approval.':'Start with these example tastes. Review the draft, then make it yours.'}</p></section>`;
}
function renderReceipt() {
  const pending=!!state.approved&&(!!state.proposal||selectionProblems(state,state.approved.selection).length>0);
  if(!state.receipt) {
    if(state.approved)return `<section class="panel receipt ${pending?'previous-approval':''}" aria-label="Approved programme status"><span class="tiny-label">${pending?'PREVIOUSLY APPROVED':'YOUR APPROVED PROGRAMME'}</span><h3>${pending?'A decision is pending.':'Ready for your season.'}</h3><p>${pending?'Your agreed selections are kept while you review the next decision.':'Lock the nights you want to keep. Preview the programme sheet when you are ready to share.'}</p><ul><li>${state.approved.selection.length} agreed nights</li><li>${state.locked.length} locked ${state.locked.length===1?'night':'nights'}</li><li>${state.maximumRuntime}-minute current limit</li></ul></section>`;
    return `<section class="panel receipt"><span class="tiny-label">A SIMPLE WORKFLOW</span><h3>Keep the good decisions.</h3><p>Build a programme. Lock the films you want to keep. If one drops out, review what changes before accepting a replacement.</p><ul><li>${state.data.films.length} films in the vetted shortlist</li><li>Three declared taste profiles</li></ul></section>`;
  }
  const r=state.receipt;
  return `<section class="panel receipt ${pending?'previous-approval':''}" aria-label="Last approved change"><span class="tiny-label">${r.source==='recorded'?'RECORDED DEMO · ':''}${pending?'PREVIOUS DECISION':'LAST APPROVED CHANGE'}</span><h3>${pending?'Previously approved':r.initial?'Programme approved':'Replacement approved'}</h3><p>${r.removed.length?`Removed <strong>${r.removed.map(id=>esc(name(id))).join(', ')}</strong>.<br>`:''}${r.added.length?`${r.initial?'Selected':'Added'} <strong>${r.added.map(id=>esc(name(id))).join(', ')}</strong>.`:''}</p><ul><li>${r.support}/${state.data.profiles.length} profiles supported at approval</li>${!r.initial?`<li>${r.lockedPreserved} locked ${r.lockedPreserved===1?'choice':'choices'} preserved</li>`:''}${r.previousLimit!==r.maximumRuntime?`<li>Runtime approved: ${r.previousLimit} → ${r.maximumRuntime} min</li>`:''}${r.previousSlots!==undefined && r.previousSlots!==r.slots?`<li>Nights approved: ${r.previousSlots} → ${r.slots}</li>`:''}${r.excludedAdded?.length?`<li>Unavailable: ${r.excludedAdded.map(id=>esc(name(id))).join(', ')}</li>`:''}</ul>${pending?'<p class="receipt-pending-note">The next proposal still needs your approval.</p>':''}</section>`;
}
const toolName=tool=>({load_cached_rankings:'Read saved taste rankings',solve_programme:'Check programme constraints',find_repair_options:'Compare permitted repair options',inspect_evidence:'Inspect saved taste evidence',inspect_catalogue:'Read film shortlist',propose_programme:'Prepare a programme proposal',propose_repair:'Prepare repair options'})[tool]??String(tool??'Planning tool').replaceAll('_',' ');
function renderTrace(trace) {
  return `<ol class="trace-list">${trace.map(t=>`<li><b>${esc(toolName(t.tool))}</b><div class="trace-detail">${t.summary?esc(t.summary):''}${t.constraints?` ${t.constraints.slots} nights · ${t.constraints.maximumRuntime} min · ${t.constraints.locked?.length??0} locks.`:''}${t.status?` ${esc(t.status)}.`:''}${t.qlooRequests===0 || t.networkRequests===0?' No Qloo requests.':''}</div></li>`).join('')}</ol>`;
}
function assistantPrompt() {
  const issues=state.approved?selectionProblems(state,state.approved.selection):[];
  return issues.length?'Repair the current programme issue. Preserve my locked choices, keep the current runtime limit first, and explain any alternative.':state.approved?'Review my current programme. Explain which music references have top-five films and preserve my locked choices.':`Plan ${state.slots} nights within the current runtime limit. Explain the ranking evidence and preserve any locked choices.`;
}
function renderAgent() {
  if(synthetic())return '<section class="panel agent-panel"><span class="tiny-label">SYNTHETIC SETUP</span><h2>Manual planning example</h2><p class="agent-intro">This setup uses invented films and ranks. Build and review a programme with the manual tools.</p></section>';
  if(state.mode==='recorded')return renderRecordedAgent();
  const status=state.agentStatus, response=state.agentResponse;
  const guest=guestAccess();
  const guestPaused=guest&&accessStatus.guestRemainingInteractions===0;
  const unavailable=!status?.configured||status?.paused||status?.remainingRequests===0||status?.busy||status?.operatorReviewRequired||status?.providerStatus==='budget_unavailable'||guestPaused||state.ownerAccessExpired||state.sessionAccessExpired;
  const checking=state.agentStatusBusy;
  const label=checking?'Checking assistant availability…':state.ownerAccessExpired?'Sign in to continue with your artists':state.sessionAccessExpired?'Check availability to continue':guestPaused?'Today’s browser messages are used':status?.busy&&!status?.operatorReviewRequired?'Luna is busy. Try again shortly.':unavailable?'Live assistant temporarily unavailable':'Live assistant';
  const issues=state.approved?selectionProblems(state,state.approved.selection):[];
  const action=state.agentMessage.trim()?'Ask Luna':issues.length?'Repair with Luna':state.approved?'Review with Luna':'Plan with Luna';
  const quota=Number.isInteger(status?.remainingRequests)&&Number.isInteger(status?.maxRequestsPerDay)?`${status.remainingRequests}/${status.maxRequestsPerDay} OpenAI attempts remain this UTC day.`:'Shared assistant allowance unavailable.';
  return `<section class="panel agent-panel" aria-label="Ask ReelBalance"><div class="agent-heading"><div><span class="tiny-label">YOUR PLANNING ASSISTANT</span><h2>${issues.length?'Repair with Luna':state.approved?'Review with Luna':'Plan with Luna'}</h2></div></div><div class="agent-status assistant-availability"><span class="status-dot ${checking?'pending':unavailable?'unavailable':'ready'}"></span><span>${esc(label)}</span>${unavailable&&!checking?`<button class="text-button" data-action="${state.ownerAccessExpired?signInAction():'agent-status'}">${state.ownerAccessExpired?'Sign in':'Check availability'}</button>`:''}</div><p class="agent-intro">Luna plans with your Qloo taste rankings. Review its proposal before anything changes.</p><label class="form-label" for="agent-message">What would you like to plan?</label><textarea class="field agent-message" id="agent-message" maxlength="800" rows="2" placeholder="${state.approved?'Describe a change, or ask why these films fit.':'For example: plan a short season and explain the film choices.'}" ${disabled()}>${esc(state.agentMessage)}</textarea><details id="luna-suggestions" class="prompt-suggestions"><summary>Suggested requests</summary><div class="agent-examples" aria-label="Example assistant requests"><button data-action="agent-example" data-prompt="${esc(assistantPrompt())}" ${disabled()}>${issues.length?'Repair this night':state.approved?'Review these choices':'Plan this season'}</button><button data-action="agent-example" data-prompt="Explain the original Qloo ranking evidence for the current programme. Which music references have top-five films?" ${disabled()}>Explain the choices</button><button data-action="agent-example" data-prompt="Propose a two-night season, keep all locked choices, and disclose any taste support shortfall." ${disabled()}>Consider two nights</button></div></details><div class="agent-send-row"><small id="agent-character-count">${state.agentMessage.length}/800</small><button class="button primary" data-action="agent-send" ${state.busy||checking||unavailable?'disabled':''}>${state.agentPending?'Preparing your proposal…':action}${icon('arrow')}</button></div>${state.agentError?`<p class="agent-error" role="alert">${esc(state.agentError)}</p>`:''}${response?`<div class="agent-response" aria-label="Luna response"><span class="badge neutral">Live Luna response</span><p class="agent-answer">${esc(response.answer)}</p>${response.revision!==state.revision?'<p class="agent-grounding">This answer describes the earlier brief. Your approved programme shows the latest decision.</p>':''}${state.proposal?'<button class="button secondary small" data-action="review-proposal">Review proposed programme</button>':''}</div>`:''}<div class="agent-footer">${guest?`<span>${Number.isInteger(accessStatus.guestRemainingInteractions)?`${accessStatus.guestRemainingInteractions} Luna messages left in this browser today`:'Browser messages temporarily unavailable'}</span>`:''}<button class="text-button" data-action="view-evidence">Taste evidence & sources ↗</button></div><details id="luna-details" class="response-details"><summary>${response?'Response details':'Assistant details'}</summary><p>${esc(status?.model??'gpt-6-luna')} · Qloo rankings collected ${esc(evidenceDate(state.data.dataset.checkedAt))} and reused for planning.</p><p>${esc(quota)} Each interaction can use several OpenAI attempts; the allowance is shared.</p>${response?`<dl class="request-detail-list"><dt>OpenAI attempts</dt><dd>${Number.isInteger(response.llmRequests)?response.llmRequests:'Unavailable'}</dd><dt>Tokens</dt><dd>${Number.isInteger(response.usage?.inputTokens)?response.usage.inputTokens:'—'} input · ${Number.isInteger(response.usage?.outputTokens)?response.usage.outputTokens:'—'} output</dd><dt>New Qloo retrieval</dt><dd>None for this response; the displayed rankings were reused.</dd></dl>${response.toolTrace?.length?renderTrace(response.toolTrace):''}`:''}${state.agentErrorDetails?`<p>${esc(state.agentErrorDetails)}</p>`:''}${status?.operatorReviewRequired?'<p>The organiser must review an unfinished assistant operation before requests resume.</p>':''}</details></section>`;
}
function renderRecordedAgent() {
  const response=state.agentResponse;
  if(!response)return '';
  const historical=response.recordedUsage;
  return `<section class="panel agent-panel recorded-agent" aria-label="Recorded Luna explanation"><div class="agent-heading"><div><span class="tiny-label">RECORDED WALKTHROUGH</span><h2>Luna’s explanation</h2></div><span class="badge neutral">Recorded replay</span></div><p class="agent-intro">A genuine Luna answer saved on 6 October 2026. Review the checked proposal and approve your choice.</p><details class="recorded-answer"><summary>Read the recorded answer</summary><p class="agent-answer">${esc(response.answer)}</p></details><details class="response-details"><summary>Response details</summary><p>${esc(response.model)} · This replay makes no new OpenAI or Qloo requests.${Number.isInteger(historical?.llmRequests)?` Original generation used ${historical.llmRequests} OpenAI attempts.`:''}</p>${response.toolTrace?.length?renderTrace(response.toolTrace):''}</details></section>`;
}
function renderOptionEvidence(result,context=state) {
  return `<ul class="option-evidence" aria-label="Original ranking evidence">${state.data.profiles.map(profile=>{
    const row=result.evidence.find(e=>e.group===profile.id);
    const rank=Number.isInteger(row?.best_cached_rank)?row.best_cached_rank:null;
    const match=usableFilms(context,result.selection??result.nightOrder??[]).find(f=>profile.ranks[f.id]===rank);
    return `<li class="${row?.known_top_k_support?'':'missing'}"><span>${esc(profile.reference)}</span><strong>${match?esc(match.name):'No ranked film'}</strong><small>${rank===null?'Unknown rank':`Original rank #${rank}`} · ${row?.known_top_k_support?'Top-five support':rank===null?'Unknown evidence':'Outside top five'}</small></li>`;
  }).join('')}</ul>`;
}
function renderBriefChanges(target) {
  const changes=[];
  if(target.slots!==state.slots)changes.push(`<div><span>Screening nights</span><strong>${state.slots} → ${target.slots}</strong></div>`);
  if(target.maximumRuntime!==state.maximumRuntime)changes.push(`<div><span>Runtime limit</span><strong>${state.maximumRuntime} → ${target.maximumRuntime} min</strong></div>`);
  const added=target.excluded.filter(id=>!state.excluded.includes(id));
  if(added.length)changes.push(`<div><span>Mark unavailable</span><strong>${added.map(id=>esc(name(id))).join(', ')}</strong></div>`);
  return changes.length?`<div class="proposed-brief"><span class="tiny-label">BRIEF CHANGES · NOT YET APPLIED</span>${changes.join('')}<p>These changes and the film selections are approved together.</p></div>`:'';
}
function renderRepairSummary(result,target) {
  const summary=summarizeRepair(state.data,planningRequest(state),planningRequest(target),result);
  if(!summary)return '';
  return `<dl class="repair-summary" aria-label="Pending repair summary"><div><dt>Proposed ${synthetic()?'fixture':'ranking'} support</dt><dd>${summary.beforeSupport}/${summary.referenceCount} → ${summary.afterSupport}/${summary.referenceCount}</dd></div><div><dt>Locked nights kept</dt><dd>${summary.keptLockedNightCount}</dd></div><div><dt>Runtime limit</dt><dd>${summary.limitUnchanged?`${summary.currentLimit} min unchanged`:`${summary.currentLimit} → ${summary.proposedLimit} min proposed`}</dd></div></dl>`;
}
function renderProposal() {
  const p=state.proposal;
  if(!p)return '';
  const r=p.result;
  const target=proposalPlanningState(state);
  const briefChanges=renderBriefChanges(target);
  const initial=!state.approved;
  const proposalSource=synthetic()?'Manual setup proposal':p.source==='agent'?'Live Luna proposal':p.source==='recorded'?'Recorded replay':'Manual proposal';
  if(r.status==='hard_conflict') {
    const longest=state.locked.length?Math.max(...state.locked.map(id=>film(id).runtime)):null;
    return `<section class="proposal-panel warning motion-in" aria-label="Constraint conflict"><div class="proposal-top"><div><span class="tiny-label">A DECISION NEEDS YOUR ATTENTION</span><h2>These choices cannot fit together.</h2></div><span class="badge warn">Conflict</span></div><span class="badge neutral">${proposalSource}</span><p class="proposal-intro">${esc(r.explanation)}</p>${briefChanges}<ul class="conflict-list">${state.locked.map(id=>`<li>${esc(name(id))} is locked${target.excluded.includes(id)?' and unavailable':film(id).runtime>target.maximumRuntime?` and runs ${film(id).runtime} minutes`:''}.</li>`).join('')}</ul><div class="conflict-actions">${state.locked.map(id=>`<button class="button secondary small" data-action="unlock" data-id="${id}" ${disabled()}>Unlock ${esc(name(id))}</button>`).join('')}${longest && longest>target.maximumRuntime?`<button class="button secondary small" data-action="set-runtime" data-limit="${longest}" ${disabled()}>Review at ${longest} minutes</button>`:''}<button class="button secondary small" data-action="view-catalogue">Review shortlist</button></div></section>`;
  }
  const supported=r.evidence.filter(e=>e.known_top_k_support).length;
  const missing=state.data.profiles.filter(profile=>!r.evidence.find(e=>e.group===profile.id)?.known_top_k_support);
  const alternative=p.runtimeAlternative;
  const warning=supported<state.data.profiles.length;
  const separateSupport=target.slots===2&&target.data.profiles.length>2&&target.data.films
    .filter(film=>film.eligible&&!target.excluded.includes(film.id)&&film.runtime<=240)
    .every(film=>target.data.profiles.filter(profile=>Number.isInteger(profile.ranks[film.id])&&profile.ranks[film.id]<=5).length<=1);
  const removed=r.changes.removed.map(id=>name(id));
  const added=r.changes.added.map(id=>name(id));
  const change=initial ? r.nightOrder.map(name).join(' · ') : removed.length ? `${removed.join(', ')} → ${added.join(', ')||'remove this night'}` : added.length?`Keep the current films; add ${added.join(', ')}.`:'Keep the current films.';
  const currentButton=initial?(warning?'Approve with this shortfall':'Approve this programme'):warning?'Accept the disclosed shortfall':'Approve this change';
  return `<section class="proposal-panel ${warning?'warning':''} motion-in" aria-label="Proposed programme changes"><div class="proposal-top"><div><span class="tiny-label">${initial?'YOUR DRAFT IS READY':'REVIEW BEFORE APPROVING'}</span><h2>${initial?(warning?'A season with a trade-off.':'A place for each taste.'):warning?'A replacement has a trade-off.':'Keep the choices. Restore the season.'}</h2></div><span class="badge ${warning?'warn':''}">${supported}/${state.data.profiles.length} supported</span></div><div class="proposal-labels"><span class="badge pending-approval">Pending approval</span><span class="badge neutral">${proposalSource}</span></div><p class="proposal-intro">${warning?`The proposed programme leaves ${missing.map(p=>esc(p.reference)).join(' and ')} without a selected top-five film. ${separateSupport?'Each available film supports at most one profile under the original top-five policy, so two films cannot give all three known support. You can accept a disclosed shortfall or return to three nights.':'Choose whether to accept that shortfall or adjust a constraint.'}`:initial?(synthetic()?'The draft uses invented fixture ranks within your shortlist and runtime limit. Nothing is approved yet.':'The draft uses your Qloo rankings within the shortlist and runtime limit. Nothing is approved yet.'):'This proposal keeps every locked choice and respects your current shortlist. The programme changes only when you approve.'}</p>${briefChanges}<div class="proposal-options ${alternative?'':'single'}"><article class="proposal-option"><span class="option-kicker">${initial?'PROPOSED PROGRAMME':target.maximumRuntime===state.maximumRuntime?'KEEP YOUR CURRENT LIMIT':'PROPOSED BRIEF'} · ${target.maximumRuntime} MIN</span><h3>${initial?`Review your ${target.slots} nights`:added.length?esc(added.join(', ')):'Keep the programme'}</h3><p class="change-line">${esc(change)}</p><p class="status-line ${warning?'warn':''}">${warning?`${missing.map(p=>esc(p.reference)).join(', ')}: no selected top-five film.`:`${supported}/${state.data.profiles.length} references have top-five films.`}</p>${renderRepairSummary(r,target)}${renderOptionEvidence(r,target)}${renderReplacement(r,target)}<button class="button ${warning?'secondary':'primary'}" data-action="approve" data-kind="current" ${disabled()}>${currentButton}${icon('check')}</button></article>${alternative?`<article class="proposal-option alt"><span class="option-kicker">RAISE LIMIT TO ${alternative.maximumRuntime} MIN · +${alternative.maximumRuntime-target.maximumRuntime}</span><h3>${esc(alternative.result.changes.added.map(name).join(', '))}</h3><p class="change-line">${esc(alternative.result.changes.removed.map(name).join(', '))} → ${esc(alternative.result.changes.added.map(name).join(', '))}</p>${renderRepairSummary(alternative.result,{...target,maximumRuntime:alternative.maximumRuntime})}${renderOptionEvidence(alternative.result,{...target,maximumRuntime:alternative.maximumRuntime})}${renderReplacement(alternative.result,{...target,maximumRuntime:alternative.maximumRuntime},'runtime')}<button class="button primary" data-action="approve" data-kind="runtime" ${disabled()}>Allow ${alternative.maximumRuntime} min & approve${icon('check')}</button></article>`:''}</div>${warning && target.slots===2 && !alternative?'<div class="conflict-actions"><button class="button secondary small" data-action="slots-review" data-count="3">Review with three nights</button></div>':''}</section>`;
}
function renderReplacement(result,target,kind='current') {
  const explanation=explainReplacement(state.data,planningRequest(target),result);
  if(!explanation)return '';
  const statusLabel=candidate=>({selected:'Fits brief · proposed',retained:'Kept night',eligible:'Fits brief',over_runtime:'Over limit',excluded:'Unavailable',ineligible:'Outside shortlist'})[candidate.status]??'Review';
  return `<details id="replacement-${kind}" class="replacement-reasons"><summary>${esc(explanation.title)}</summary><p>${esc(explanation.summary)}</p>${[...explanation.recovered,...explanation.unresolved].map(reference=>`<h4>${esc(reference.reference)} · original top-five candidates</h4><p>${esc(reference.candidateSummary)}</p><div class="table-wrap" role="region" aria-label="${esc(reference.reference)} candidate evidence"><table class="candidate-evidence"><thead><tr><th scope="col">Original rank</th><th scope="col">Film</th><th scope="col">Planning runtime</th><th scope="col">Decision evidence</th></tr></thead><tbody>${reference.candidates.map(candidate=>`<tr class="candidate-${candidate.status}" data-candidate-status="${candidate.status}"><td data-label="Original rank"><span class="candidate-rank">#${candidate.rank}</span></td><td data-label="Film"><strong>${esc(candidate.name)}</strong></td><td data-label="Planning runtime">${candidate.runtime} min</td><td data-label="Decision evidence"><span class="candidate-status">${statusLabel(candidate)}</span><span class="candidate-reason">${esc(candidate.reason)}</span></td></tr>`).join('')}</tbody></table></div>${reference.hasUnknownEligibleFilms?'<p>Other eligible films have unknown ranks. No top-five support is inferred for them.</p>':''}`).join('')}${explanation.locks.length?`<p>${explanation.locks.map(lock=>`${esc(lock.name)} stays on Night ${lock.night}.`).join(' ')}</p>`:''}${explanation.unresolved.length?`<p>${explanation.unresolved.map(reference=>esc(reference.reference)).join(', ')} still has no selected film with known original top-five support.</p>`:''}${explanation.unknown.length?'<p>Some proposed film/reference ranks are unknown and contribute no assumed support.</p>':''}<p>${esc(explanation.policy)}</p></details>`;
}
function renderProgramme() {
  const draft=!state.approved&&state.proposal?.result?.selection;
  const draftContext=draft?proposalPlanningState(state):state;
  const ids=state.approved?.selection??(draft?state.proposal.result.nightOrder:[]);
  const issues=state.approved?selectionProblems(state,ids):[];
  const canExport=!!state.approved&&!issues.length;
  const slotsCount=Math.max(draftContext.slots,ids.length);
  const started=!!state.approved||!!draft;
  const tastePicker=renderTastePicker();
  const references=`${renderProfiles(true)}<div class="evidence-link"><span>${synthetic()?'Invented setup rankings':'Qloo taste rankings'} · ${esc(evidenceDate(state.data.dataset.checkedAt))}</span><button class="text-button" data-action="view-evidence">Explore taste evidence ↗</button></div>`;
  const tools=`<div class="planning-setup ${started?'':'initial-setup'}">${renderAgent()}${renderBrief()}</div>`;
  const stage=`<div class="programme-stage"><div class="programme-decisions"><section class="panel programme-panel"><div class="section-heading"><h2>${state.approved?'Your approved programme':draft?'Your draft programme':`Your season, in ${state.slots===2?'two':'three'} acts.`}</h2><span class="badge ${issues.length?'warn':draft?'neutral':''}">${state.approved?issues.length?'Needs a review':'Approved':draft?'Draft':'Not started'}</span></div>${started&&state.mode!=='recorded'?`<div class="programme-toolbar">${!synthetic()?`<button class="button primary small" data-action="compose-agent" ${disabled()}>${issues.length?'Repair with Luna':state.approved?'Review with Luna':'Ask Luna about this draft'}${icon('arrow')}</button>`:''}<button class="text-button" data-action="plan" ${editDisabled()}>${state.busy?'Checking…':state.approved?'Review manually':'Rebuild draft manually'}</button></div>`:''}<div class="programme-slots ${slotsCount===2?'two-slots':''}">${Array.from({length:slotsCount},(_,i)=>ids[i]?filmCard(ids[i],i,!!draft,draftContext):emptySlot(i)).join('')}</div><div class="programme-callout ${issues.length?'warn':''}">${icon(issues.length?'arrow':'check')}<span>${issues.length?esc(issues[0]):state.approved?'Lock the nights you want to keep if your plans change.':draft?'Review the selections below, then approve your programme.':'Set your brief and plan with Luna, or build a draft with the manual tools.'}</span></div>${renderSupport(ids,draftContext)}<div class="programme-actions"><small>${canExport?'Ready to share. Confirm screening rights and the exact film-copy runtimes before screening.':state.approved?'Resolve the programme issue before exporting.':'Approve a valid programme to export its sheet.'}</small><button class="button ${canExport?'primary':'secondary'}" data-action="export" ${canExport?'':'disabled'}>Preview programme sheet <span>↗</span></button></div></section>${renderProposal()}</div><aside class="decision-sidebar">${renderReceipt()}</aside></div>`;
  return `${heading('YOUR PROGRAMME','Keep the agreed nights.',synthetic()?'Plan and repair a short film-club programme with invented setup rankings.':'Plan and repair a short film-club programme with Qloo ranking evidence.')}${state.mode==='recorded'?renderRecordedGuide():''}${started?references+stage+`<details id="programme-tools" class="programme-tools" ${planningToolsOpen||state.agentError?'open':''}><summary>${state.mode==='recorded'?'Read recorded Luna answer':synthetic()?'Edit brief or review manually':'Edit brief or ask Luna'}<span>${state.mode==='recorded'?'Your own programme is kept.':'Your choices stay in place until approval.'}</span></summary>${tools}</details>`+tastePicker:`${!state.proposal?`<section class="start-guide" aria-label="Start planning"><strong>${state.evidenceId?'Your references are ready.':'A ready example is waiting.'}</strong><span>${synthetic()?'Explore the manual tools with invented setup evidence.':state.evidenceId?'Build a draft, then review and approve it.':'Ask Luna for a draft, or build one manually. Choose your own artists whenever you are ready.'}</span></section>`:''}${tools}${references}${tastePicker}${stage}`}${state.mode!=='recorded'?renderRecordedGuide():''}`;
}
function renderCatalogue() {
  const all=state.data.films;
  const selected=all.filter(f=>f.name.toLocaleLowerCase().includes(state.search.toLocaleLowerCase()));
  return `${heading('THE FILM SHORTLIST','Twenty films. Your boundaries.','Keep only the titles you can consider. The original taste rankings stay unchanged when you filter the shortlist.')}<section class="panel catalogue-panel"><div class="catalogue-toolbar"><span class="catalogue-count">${all.length-state.excluded.length} in the vetted shortlist · ${availableIds().length} within ${state.maximumRuntime} minutes</span><input id="catalogue-search" class="field" type="search" placeholder="Find a film in the shortlist" aria-label="Search film shortlist" value="${esc(state.search)}"></div><div class="table-wrap"><table class="catalogue-table"><thead><tr><th>IN SHORTLIST</th><th>${synthetic()?'INVENTED FILM / YEAR':'FILM / QLOO YEAR'}</th><th>PLANNING RUNTIME</th>${state.data.profiles.map(p=>`<th>${esc(p.reference.toUpperCase())}<br>ORIGINAL RANK</th>`).join('')}<th>FILM FACTS</th></tr></thead><tbody>${selected.map(f=>`<tr class="${state.excluded.includes(f.id)?'excluded-row':''}"><td><input type="checkbox" data-available="${f.id}" ${state.excluded.includes(f.id)?'':'checked'} aria-label="Include ${esc(f.name)} in shortlist" ${editDisabled()}></td><td><span class="catalogue-title">${esc(f.name)}<small>${f.year}${state.locked.includes(f.id)?' · Locked in programme':''}</small></span></td><td>${f.runtime} min ${f.runtime>state.maximumRuntime?'<span class="badge neutral">Over limit</span>':''}</td>${state.data.profiles.map((p,i)=>`<td><span class="rank-pill profile-${i} ${p.ranks[f.id]<=5?'top':''}">${p.ranks[f.id]??'?'}</span></td>`).join('')}<td><div class="catalogue-source"><button data-action="facts" data-id="${f.id}">View source</button></div></td></tr>`).join('')}</tbody></table>${!selected.length?'<p class="empty-state">No titles match that search.</p>':''}</div><p class="catalogue-note">${esc(state.data.dataset.eligibility)} Runtime and release-year differences are recorded in each film’s facts. Removing a locked film creates a conflict; its lock stays in place until you choose to change it.</p></section>`;
}
function renderEvidence() {
  return `${heading('THE CULTURAL EVIDENCE','Taste is a reference, not a promise.','The same vetted films, ranked separately against three declared music interests. Here is what the saved evidence can tell you.')}<div class="evidence-grid">${state.data.profiles.map((p,i)=>`<section class="panel evidence-card profile-${i}"><div class="profile-art" aria-hidden="true"></div><span class="tiny-label">PROFILE ${String(i+1).padStart(2,'0')} · MUSIC → FILM</span><h2>${esc(p.reference)}</h2><p>${Object.keys(p.ranks).length}/${state.data.films.length} films scored in the original catalogue.</p><p class="evidence-source">${esc(profileEvidence(p))}</p><ol class="rank-list">${state.data.films.filter(f=>p.ranks[f.id]<=5).sort((a,b)=>p.ranks[a.id]-p.ranks[b.id]).map(f=>`<li><b>${p.ranks[f.id]}</b><span>${esc(f.name)}</span></li>`).join('')}</ol></section>`).join('')}</div><section class="panel evidence-notes"><div><span class="tiny-label">WHAT THE EVIDENCE ESTABLISHES</span><h2>Different references.<br>Different film rankings.</h2><p>${synthetic()?'These ranks are invented fixtures.':'Qloo supplies the film rankings.'} The local planning tools enforce your runtime limit, shortlist and locked choices. A profile is supported when at least one usable selection is in its original top five.</p><p>${esc(state.data.dataset.disclosure)} Missing scores mean unknown evidence, rather than a low preference.</p><div class="evidence-metrics"><div><strong>${state.data.films.length}</strong><small>Vetted film catalogue</small></div><div><strong>${state.data.profiles.length}</strong><small>Confirmed references</small></div><div><strong>Top 5</strong><small>Original ranking support policy</small></div></div></div><div><span class="tiny-label">DECISION TRAIL</span><h2>Inspectable planning.</h2><p>${esc(state.data.dataset.source)} · ${esc(evidenceDate(state.data.dataset.checkedAt))}. Constraint edits and repairs are calculated locally. Manual programme checks use deterministic tools. ${synthetic()?'This setup example contains no provider response data and disables all provider-backed features.':state.mode==='recorded'?'This example replays saved GPT-6 Luna responses and makes zero new OpenAI requests.':state.agentStatus?.configured ? 'GPT-6 Luna can interpret requests and call those same tools when you ask the assistant.' : 'GPT-6 Luna is available after an OpenAI key is configured.'} Planning uses the displayed original ranks. ${synthetic()?'No external retrieval is enabled.':'New artist lookup and ranking requests happen only when you explicitly search for artists or collect rankings.'}</p><details class="response-details"><summary>Planning tools & retrieval details</summary><p>Planning reuses these original rankings; it makes no new Qloo retrieval. Live Luna requests use OpenAI; recorded replays make no new provider requests.</p>${state.trace.length?renderTrace(state.trace):'<p class="empty-state">Build a draft or ask the assistant to see its planning trail here.</p>'}</details><p>Individual enjoyment, screening availability and attendance are not established by this evidence. Choose titles from a shortlist you can actually screen.</p></div></section>`;
}
function render() {
  const openToolDetails=['brief-notes','luna-suggestions','luna-details'].filter(id=>document.getElementById(id)?.open);
  const openEvidence=state.proposal&&state.proposal===lastRenderedProposal?['replacement-current','replacement-runtime'].filter(id=>document.getElementById(id)?.open):[];
  const currentTools=content.querySelector('#programme-tools');
  if(currentTools)planningToolsOpen=currentTools.open===true;
  updateSaveIndicator();
  const evidenceSource=document.querySelector('#workspace-evidence-source');
  if(evidenceSource)evidenceSource.textContent=synthetic()?'Invented setup rankings':`Qloo rankings · ${evidenceDate(state.data.dataset.checkedAt)}`;
  document.querySelector('#workspace-mode').textContent=synthetic()?'Synthetic setup':accessStatus?.judgeAuthenticated?'Judge workspace':accessStatus?.mode==='public'?'Public demo':'Local prototype';
  document.querySelector('#workspace-source-note').textContent=synthetic()?'Invented fixtures for setup checks. You make the final call.':'Qloo supplies taste evidence. You make the final call.';
  const active=document.activeElement;
  const inContent=!!active&&content.contains(active);
  const focus=deferredFocus&&active===deferredFocus.fallback?deferredFocus:{
    id:active?.id,caret:active?.selectionStart,tag:active?.tagName,text:active?.textContent,
    attributes:inContent?Object.entries(active.dataset??{}):[],
  };
  const matches=node=>node.tagName===focus.tag&&focus.attributes.every(([key,value])=>node.dataset[key]===value)&&
    (focus.attributes.length>0||node.textContent===focus.text);
  const controls='button, input, select, textarea, summary, a';
  const position=focus.position??(inContent?[...content.querySelectorAll(controls)].filter(matches).indexOf(active):-1);
  deferredFocus=null;
  content.innerHTML=(state.error?`<div class="error-banner" role="alert">${esc(state.error)}</div>`:'')+
    renderSaveNotice()+
    (state.mode==='recorded'&&state.view!=='programme'?'<div class="recorded-mode-banner"><strong>Recorded Luna walkthrough</strong><button class="text-button" data-action="demo-programme">Return to the demo</button><button class="text-button" data-action="demo-exit">Return to my programme</button></div>':'')+
    (state.view==='catalogue'?renderCatalogue():state.view==='evidence'?renderEvidence():renderProgramme());
  for(const id of [...openToolDetails,...openEvidence]){const detail=document.getElementById(id);if(detail)detail.open=true;}
  lastRenderedProposal=state.proposal;
  document.querySelectorAll('[data-view]').forEach(button=>{
    const current=button.dataset.view===state.view;
    button.classList.toggle('active',current);
    if(current)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
  });
  if(focus.id||inContent) {
    const restored=(focus.id?document.getElementById(focus.id):null)??
      (inContent?[...content.querySelectorAll(controls)].filter(matches)[Math.max(0,position)]:null);
    restored?.focus({preventScroll:true});
    if(focus.caret!==null && focus.caret!==undefined && (['text','search'].includes(restored?.type) || restored?.tagName==='TEXTAREA'))restored.setSelectionRange(focus.caret,focus.caret);
    if(inContent&&(!restored||restored.disabled)){
      const fallback=focusHeading(state.view==='programme'?'.programme-panel h2':'.page-heading h1',true);
      if(restored?.disabled&&fallback)deferredFocus={...focus,position,fallback};
    }
  }
  scheduleTasteReadiness();
  void saveWorkspace();
}
function focusHeading(selector,preventScroll=false) {
  const target=content.querySelector(selector);
  if(target){target.tabIndex=-1;target.focus({preventScroll});}
  return target;
}
async function requestPlan() {
  if(state.busy || state.mode==='recorded')return;
  const limit=Number(document.querySelector('#runtime-limit')?.value??state.maximumRuntime);
  if(!Number.isInteger(limit)||limit<1||limit>240) {
    state.error='Use a whole-minute runtime limit between 1 and 240.';render();return;
  }
  if(limit!==state.maximumRuntime)state=changeConstraints(state,{maximumRuntime:limit});
  const revision=state.revision;
  const payload=bindTasteEvidence(state,planningRequest(state));
  const repair=!!state.approved;
  state={...state,busy:true,error:null,proposal:null,agentResponse:null};render();announce('Checking your programme against the brief. Nothing changes until approval.');
  try {
    const response=await fetch(repair?'/api/repair-options':'/api/programme',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(10000)});
    const body=await response.json();
    if(!response.ok){const error=Error(body.error||'The planning tool could not complete the request.');error.code=body.code;throw error;}
    state=receiveProposal(state,repair?body:{result:body,toolTrace:body.toolTrace},revision);
    if(revision===state.revision && state.proposal)notify(state.proposal.result.status==='hard_conflict'?'A constraint conflict needs your decision.':'Your proposal is ready to review.');
  } catch(error) {
    if(revision===state.revision){if(expiredAccess(error))markOwnerExpired(error);state={...state,busy:false,error:expiredAccessMessage()??(error.name==='TimeoutError'?'The local planning tool took too long. Please try again.':error.message)};}
  }
  render();announce(state.error??(state.proposal?'Your programme proposal is ready to review.':'Programme check finished.'));
  if(revision===state.revision&&state.proposal)focusHeading('.proposal-panel h2');
}
async function refreshAgentStatus({refreshAccess=false}={}) {
  if(state.agentStatusBusy || state.mode==='recorded')return;
  const revision=state.revision,evidenceId=state.evidenceId,requestId=++agentStatusRequest;
  const path='/api/agent-status'+(evidenceId?'?evidenceId='+encodeURIComponent(evidenceId):'');
  state={...state,agentStatusBusy:true};render();
  try {
    if(refreshAccess)await refreshAccessStatus();
    const response=await fetch(path,{signal:AbortSignal.timeout(10000)});
    const body=await response.json();
    if(!response.ok){const error=Error(body.error||'Assistant status could not be read.');error.code=body.code;throw error;}
    if(requestId!==agentStatusRequest)return;
    if(state.mode==='recorded'||state.revision!==revision||state.evidenceId!==evidenceId){state={...state,agentStatusBusy:false};render();return;}
    state={...state,agentStatus:body,agentStatusBusy:false};
  } catch(error) {
    if(requestId!==agentStatusRequest)return;
    if(state.mode==='recorded'||state.revision!==revision||state.evidenceId!==evidenceId){state={...state,agentStatusBusy:false};render();return;}
    if(expiredAccess(error))markOwnerExpired(error);
    state={...state,agentStatus:null,agentStatusBusy:false,agentError:expiredAccessMessage()??'Assistant availability could not be checked. Try again shortly.',agentErrorDetails:error.message};
  }
  render();
}
async function readAccessStatus() {
  const requestId=++accessStatusRequest;
  const response=await fetch('/api/access/status',{signal:AbortSignal.timeout(10000)});
  const packet=await response.json();
  if(!response.ok) {
    const error=Error(packet.error||'Access status could not be read.');
    const issuanceLimited=(response.status===429&&packet.code==='access_session_rate_limit')||(response.status===503&&packet.code==='access_session_limit');
    const validDailyLimit=value=>Number.isInteger(value)&&value>=1&&value<=60;
    const validRemaining=(value,maximum)=>value===null||(Number.isInteger(value)&&value>=0&&value<=maximum);
    const validOptionalMetadata=(packet.publicCustomAccess===undefined||typeof packet.publicCustomAccess==='boolean')&&
      (packet.guestMaxQlooRequestsPerDay===undefined&&packet.guestRemainingQlooRequests===undefined||
        validDailyLimit(packet.guestMaxQlooRequestsPerDay)&&validRemaining(packet.guestRemainingQlooRequests,packet.guestMaxQlooRequestsPerDay))&&
      (packet.judgeAuthenticated===undefined||packet.judgeAuthenticated===false)&&
      (packet.judgeSignInAvailable===undefined||typeof packet.judgeSignInAvailable==='boolean');
    if(issuanceLimited&&packet.mode==='public'&&packet.ownerAuthenticated===false&&typeof packet.ownerSignInAvailable==='boolean'&&
      validDailyLimit(packet.guestMaxInteractionsPerDay)&&validRemaining(packet.guestRemainingInteractions,packet.guestMaxInteractionsPerDay)&&validOptionalMetadata&&
      typeof packet.synthetic==='boolean'&&typeof packet.recordedAvailable==='boolean') {
      error.accessStatus={mode:packet.mode,ownerAuthenticated:false,ownerSignInAvailable:packet.ownerSignInAvailable,
        judgeAuthenticated:false,judgeSignInAvailable:packet.judgeSignInAvailable===true,
        guestMaxInteractionsPerDay:packet.guestMaxInteractionsPerDay,guestRemainingInteractions:packet.guestRemainingInteractions,
        ...(packet.publicCustomAccess!==undefined?{publicCustomAccess:packet.publicCustomAccess}:{}),
        ...(packet.guestMaxQlooRequestsPerDay!==undefined?{guestMaxQlooRequestsPerDay:packet.guestMaxQlooRequestsPerDay,guestRemainingQlooRequests:0}:{}),
        synthetic:packet.synthetic,recordedAvailable:packet.recordedAvailable};
    }
    throw error;
  }
  return {packet,requestId};
}
function applyAccessStatus({packet,requestId}) {
  if(requestId!==accessStatusRequest)return;
  accessStatus=packet;
  if(state.sessionAccessExpired)state={...state,sessionAccessExpired:false};
  document.querySelector('#owner-logout').hidden=!(packet.mode==='public'&&authenticatedAccess());
  document.querySelector('#owner-logout').textContent=packet.judgeAuthenticated&&!packet.ownerAuthenticated?'Sign out judge':'Sign out organiser';
  document.querySelector('#judge-login-button').hidden=!(packet.mode==='public'&&packet.judgeSignInAvailable&&!authenticatedAccess());
}
async function refreshAccessStatus() {
  applyAccessStatus(await readAccessStatus());
}
async function signInOwner() {
  const input=document.querySelector('#owner-token');
  const error=document.querySelector('#owner-error');
  const token=input.value;
  input.value='';error.hidden=true;
  try {
    const response=await fetch('/api/access/owner',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token}),signal:AbortSignal.timeout(10000)});
    const packet=await response.json();
    if(!response.ok)throw Error(packet.error||'Organiser access could not be verified.');
    await refreshAccessStatus();state={...state,ownerAccessExpired:false,agentError:null,agentErrorDetails:null};document.querySelector('#owner-dialog').close();render();await refreshAgentStatus();if((state.taste.open||state.taste.status)&&!state.taste.pending)await requestTaste('status');notify('Organiser access enabled. Your programme is kept.');
  } catch(failure) {error.textContent=failure.message;error.hidden=false;}
}
async function signInJudge() {
  if(judgeSignInPending)return;
  const button=document.querySelector('[data-action="judge-signin"]');
  const username=document.querySelector('#judge-username').value;
  const input=document.querySelector('#judge-password');
  const error=document.querySelector('#judge-error');
  const password=input.value;
  if(!username||!password){error.textContent='Enter the supplied judge username and password.';error.hidden=false;return;}
  judgeSignInPending=true;button.disabled=true;input.value='';error.hidden=true;
  try {
    const response=await fetch('/api/access/judge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password}),signal:AbortSignal.timeout(10000)});
    const packet=await response.json();
    if(!response.ok)throw Error(packet.error||'Judge access could not be verified.');
    await refreshAccessStatus();state={...state,ownerAccessExpired:false,agentError:null,agentErrorDetails:null};document.querySelector('#judge-dialog').close();render();await refreshAgentStatus();if((state.taste.open||state.taste.status)&&!state.taste.pending)await requestTaste('status');notify('Judge access enabled. Your programme is kept.');
  } catch(failure) {error.textContent=failure.message;error.hidden=false;}
  finally {judgeSignInPending=false;button.disabled=false;}
}
function markOwnerExpired(error) {
  const publicContinuation=accessStatus?.publicCustomAccess===true||['access_session_required','guest_session_required'].includes(error?.code);
  state={...state,ownerAccessExpired:!publicContinuation,sessionAccessExpired:publicContinuation};
  accessStatus={...accessStatus,ownerAuthenticated:false,judgeAuthenticated:false};
  document.querySelector('#owner-logout').hidden=true;
  document.querySelector('#judge-login-button').hidden=!accessStatus.judgeSignInAvailable;
}
async function requestAgent() {
  planningToolsOpen=true;
  if(state.busy||state.agentStatusBusy||state.mode==='recorded')return;
  const message=state.agentMessage.trim()||assistantPrompt();
  if(message.length>800){state.agentError='Keep your request within 800 characters.';render();return;}
  const status=state.agentStatus;
  if(!status?.configured||status.paused||status.busy||status.operatorReviewRequired||status.remainingRequests===0||status.providerStatus==='budget_unavailable'||state.ownerAccessExpired||state.sessionAccessExpired||(guestAccess()&&accessStatus.guestRemainingInteractions===0)){state.agentError='Luna is temporarily unavailable. Check availability before trying again.';render();return;}
  const revision=state.revision;
  const payload=bindTasteEvidence(state,{message,context:planningRequest(state)});
  state={...state,agentMessage:message,busy:true,agentPending:true,agentError:null,agentErrorDetails:null,error:null,proposal:null,agentResponse:null};render();announce('Luna is preparing your response. Your approved programme stays in place.');
  try {
    const response=await fetch('/api/agent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(100000)});
    const body=await response.json();
    if(!response.ok) {
      const error=Error(`HTTP ${response.status}${body.code?` · ${body.code}`:''}: ${body.error||'The assistant could not complete this request.'}`);
      error.code=body.code;throw error;
    }
    state=receiveAgentResponse(state,body,revision);
    if(revision===state.revision)notify(state.proposal?.result.status==='hard_conflict'?'Luna found a constraint conflict. Review your locked choices and brief.':state.proposal?'Luna’s proposal is ready for your review.':'Luna has explained your planning evidence.');
  } catch(error) {
    if(revision===state.revision) {
      if(expiredAccess(error))markOwnerExpired(error);
      state={...state,busy:false,agentPending:false,agentError:expiredAccessMessage()??(error.name==='TimeoutError'?'Luna took too long to respond. Nothing was approved. Check availability before trying again.':'Luna could not finish this request. Nothing was approved. Check availability before trying again.'),agentErrorDetails:error.message};
    }
  }
  try {await refreshAccessStatus();} catch {}
  render();announce(state.agentError??(state.proposal?'Luna’s proposal is ready to review.':'Luna’s response is ready.'));await refreshAgentStatus();
  if(revision===state.revision)focusHeading(state.proposal?'.proposal-panel h2':state.agentResponse?'.agent-response':'.agent-panel h2');
}
async function reset() {
  if(state.busy)return;
  if(state.mode==='recorded') {
    state=workspaceBeforeReplay?{...workspaceBeforeReplay,busy:false,agentPending:false,agentStatusBusy:false}:exitRecordedDemo(state);
    workspaceBeforeReplay=null;render();focusHeading('.page-heading h1');notify('Your programme is restored.');await refreshAgentStatus();await saveWorkspace();return;
  }
  ++saveSequence;const cleared=workspaceStorage.clear();savedSerialized=null;savedSnapshotBody=null;savedWorkspaceBlocked=false;savingUnavailable=cleared.status!=='cleared';workspaceNotice=savingUnavailable?'The programme was reset in this tab, but browser storage could not be cleared. An older saved version may return on reload.':null;
  state=resetExampleState(state);render();notify(workspaceNotice??'The example programme is reset.');await refreshAgentStatus();await saveWorkspace();
}
async function requestTaste(kind,index=null) {
  let token;
  try {
    state=beginTasteOperation(state,kind,index);token=state.taste.pending;render();announce(kind==='search'?'Searching for the artist.':kind==='rank'?`Collecting film rankings for ${state.taste.packet?.nextProfile?.name??'the next artist'}. Completed rankings are kept.`:kind==='select'?'Preparing your confirmed artist references.':'Checking saved artist availability and progress.');
    let path,body;
    if(kind==='status')path='/api/tastes/status';
    if(kind==='search'){path='/api/tastes/search';body={query:normalizeArtistQuery(state.taste.queries[index]),live:token.live};}
    if(kind==='select'){path='/api/tastes/select';body=tasteSelectionRequest(state);}
    if(kind==='progress')path='/api/tastes/progress?evidenceId='+encodeURIComponent(state.taste.evidenceId);
    if(kind==='rank'){path='/api/tastes/rank';body={evidenceId:state.taste.evidenceId,live:true};}
    const response=await fetch(path,{...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(45000)});
    const packet=await response.json();
    if(!response.ok){const error=Error(packet.error||'The artist request stopped. Check availability before another request.');error.code=packet.code;throw error;}
    state=kind==='status'?receiveTasteStatus(state,packet,token):kind==='search'?receiveTasteSearch(state,packet,token):receiveTasteProgress(state,packet,token);
    if(state.taste.packet?.status==='complete'&&kind!=='status')notify('All three original rankings are ready. Apply them explicitly to start a fresh programme.');
  } catch(error) {
    if(expiredAccess(error))markOwnerExpired(error);
    if(token)state=failTasteOperation(state,token,expiredAccessMessage()??(error.name==='TimeoutError'?'The taste request timed out. Nothing is retried; check saved progress and readiness.':error.message));
    else state={...state,taste:{...state.taste,error:error.message}};
  }
  render();announce(state.taste.error??(kind==='search'?`${state.taste.searches[index]?.options?.length??0} artist matches ready. Choose a match to confirm.`:state.taste.packet?.status==='complete'?'All three rankings are ready. Apply them to start your programme.':state.taste.packet?`${state.taste.packet.completedProfiles} of three artist rankings are ready.`:'Artist availability checked.'));
}
async function openRecordedDemo() {
  if(state.busy)return;
  const revision=state.revision;
  try {
    if(!demoPacket) {
      state={...state,busy:true,error:null};render();
      const response=await fetch('/api/demo-scenarios',{signal:AbortSignal.timeout(10000)});
      const body=await response.json();
      if(!response.ok)throw Error(body.error||'The recorded example could not be loaded.');
      if(revision!==state.revision)return;
      demoPacket=body;
      state={...state,busy:false};
    }
    if(state.mode!=='recorded')workspaceBeforeReplay=structuredClone(state);
    state=enterRecordedDemo(state,demoPacket);render();focusHeading('.proposal-panel h2');notify('Recorded walkthrough opened. Review the draft before approving.');
  } catch(error) {
    if(revision===state.revision)state={...state,busy:false,error:error.name==='TimeoutError'?'The local recording took too long to open. No API call was made.':error.message};
    render();
  }
}
function showFilm(id) {
  const f=film(id);
  const dialog=document.querySelector('#film-dialog');
  document.querySelector('#film-dialog-content').innerHTML=`<div class="dialog-heading"><div><span class="tiny-label">CATALOGUE ${esc(f.catalogue_id)}</span><h2 id="film-dialog-title">${esc(f.name)}</h2></div><button class="icon-button" data-close-dialog="film-dialog" aria-label="Close film facts">×</button></div><div class="fact-grid"><div class="fact-item">${synthetic()?'Invented year':'Qloo release year'}<strong>${f.year}</strong></div><div class="fact-item">Listed planning runtime<strong>${f.runtime} minutes</strong></div><div class="fact-item">Primary-source runtime<strong>${f.primaryRuntime??'Not recorded'}${f.primaryRuntime?' minutes':''}</strong></div><div class="fact-item">Identity check<strong>${synthetic()?'Invented fixture':'Primary source recorded'}</strong></div></div><p class="fact-note">${esc(f.metadataNote||'The primary-source identity and runtime check matches the catalogue record.')}</p>${f.sourceUrl?`<a class="source-link" href="${esc(f.sourceUrl)}" target="_blank" rel="noreferrer">Open the film facts source ↗</a>`:'<p class="fact-note">Invented fixture: no real film or external facts source.</p>'}<p class="fact-note">Verify the exact screening copy’s runtime before confirming a programme. ${esc(state.data.dataset.eligibility)}</p><div class="dialog-actions"><button class="button secondary" data-close-dialog="film-dialog">Close film facts</button></div>`;
  dialog.showModal();
}
function openSheet() {
  try {
    const html=makeSheetHtml(state);
    const parsed=new DOMParser().parseFromString(html,'text/html');
    document.querySelector('#sheet-preview').innerHTML=parsed.querySelector('main').innerHTML;
    document.querySelector('#download-sheet').href='/api/programme-sheet?payload='+encodeURIComponent(JSON.stringify(bindTasteEvidence(state,{...planningRequest(state),seasonName:state.seasonName,organiserNote:state.organiserNote,approvedAt:state.approved.approvedAt,...(state.approved.source==='recorded'?{source:'recorded'}:{})})));
    document.querySelector('#sheet-dialog').showModal();
  } catch(error) {notify(error.message);}
}
document.addEventListener('click',async event=>{
  const close=event.target.closest('[data-close-dialog]');
  if(close){document.getElementById(close.dataset.closeDialog).close();return;}
  if(!state)return;
  const nav=event.target.closest('[data-view]');
  if(nav){state.view=nav.dataset.view;render();focusHeading('.page-heading h1');return;}
  if(event.target.closest('#reset-button')){await reset();return;}
  if(event.target.closest('#download-sheet')){try{makeSheetHtml(state);}catch(error){event.preventDefault();notify(error.message);}return;}
  const button=event.target.closest('[data-action]');
  if(!button||button.disabled)return;
  const {action,id}=button.dataset;
  if(action==='judge-open'){document.querySelector('#judge-password').value='';document.querySelector('#judge-error').hidden=true;document.querySelector('#judge-dialog').showModal();document.querySelector('#judge-password').focus();return;}
  if(action==='judge-signin'){await signInJudge();return;}
  if(action==='owner-open'){document.querySelector('#owner-token').value='';document.querySelector('#owner-error').hidden=true;document.querySelector('#owner-dialog').showModal();return;}
  if(action==='owner-signin'){await signInOwner();return;}
  if(action==='owner-logout'){
    if(state.busy)return;
    try {
      const response=await fetch('/api/access/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(10000)});
      if(!response.ok)throw Error('Organiser sign out could not complete.');
      const keepProgramme=accessStatus?.publicCustomAccess===true;
      if(!keepProgramme)state=createState(state.exampleData??state.data);
      await refreshAccessStatus();state={...state,ownerAccessExpired:false,sessionAccessExpired:false};render();await refreshAgentStatus();
      if(keepProgramme&&(state.taste.open||state.taste.status)&&!state.taste.pending)await requestTaste('status');
      notify(keepProgramme?'Signed out. Your programme is kept; public allowance is active.':'Signed out. The saved example is ready.');
    }catch(error){notify(error.message);}return;
  }
  if(action==='workspace-retry'){
    if(state.busy)return;state={...state,busy:true};render();announce('Checking your saved programme. Editing is paused until it finishes.');
    try {await refreshAccessStatus().catch(()=>{});await restoreSavedWorkspace();}
    finally {state={...state,busy:false};render();}
    await refreshAgentStatus();return;
  }
  if(action==='workspace-discard'){await reset();return;}
  if(action==='facts'){showFilm(id);return;}
  if(action==='export'){openSheet();return;}
  if(action==='view-catalogue'||action==='view-evidence'){state.view=action==='view-catalogue'?'catalogue':'evidence';render();focusHeading('.page-heading h1');return;}
  if(action==='review-proposal'){focusHeading('.proposal-panel h2');return;}
  if(action==='demo-start'){await openRecordedDemo();return;}
  if(action==='demo-programme'){state.view='programme';render();focusHeading('.page-heading h1');return;}
  if(action==='demo-exit'){await reset();return;}
  if(action==='taste-open') {
    try {state=openTastePicker(state);render();if(!state.taste.status)await requestTaste('status');focusHeading('.taste-picker h2');}
    catch(error){notify(error.message);}return;
  }
  if(action==='taste-close'){if(!state.busy)state={...state,taste:{...state.taste,open:false}};render();return;}
  if(action==='taste-status'){
    try {if(state.sessionAccessExpired)await refreshAccessStatus();await requestTaste('status');if(state.taste.evidenceId&&!state.taste.error)await requestTaste('progress');}
    catch(error){state={...state,taste:{...state.taste,error:error.message}};render();}return;
  }
  if(action==='taste-search'){await requestTaste('search',Number(button.dataset.index));return;}
  if(action==='taste-select'){await requestTaste('select');return;}
  if(action==='taste-progress'){await requestTaste('progress');return;}
  if(action==='taste-rank'){await requestTaste('rank');return;}
  if(action==='taste-confirm') {
    try {state=confirmTasteArtist(state,Number(button.dataset.index),button.dataset.searchId,button.dataset.artistId);render();}
    catch(error){state={...state,taste:{...state.taste,error:error.message}};render();}return;
  }
  if(action==='taste-apply') {
    try {state=applyTasteDataset(state);render();notify('Your artists are applied. Plan your season with Luna.');await refreshAgentStatus();focusHeading('.agent-panel h2');}
    catch(error){state={...state,taste:{...state.taste,error:error.message}};render();}return;
  }
  if(action==='demo-cancel') {
    try {state=stageRecordedCancellation(state,demoPacket);render();focusHeading('.proposal-panel h2');notify('The example cancellation is staged. Locked nights stay; review the two unapproved repairs.');}
    catch(error){state.error=error.message;render();}
    return;
  }
  if(action==='compose-agent'){const currentTools=document.querySelector('#programme-tools');if(currentTools)currentTools.open=true;planningToolsOpen=true;if(!state.agentMessage.trim())state.agentMessage=assistantPrompt();render();const tools=document.querySelector('#programme-tools');if(tools)tools.open=true;document.querySelector('#agent-message')?.focus();return;}
  if(action==='agent-status'){await refreshAgentStatus({refreshAccess:true});return;}
  if(action==='agent-send'){await requestAgent();return;}
  if(action==='agent-example'){state.agentMessage=button.dataset.prompt;state.agentError=null;render();document.querySelector('#agent-message')?.focus({preventScroll:true});return;}
  if(action==='plan'){await requestPlan();return;}
  if(action==='approve') {
    try {
      state=approveProposal(state,button.dataset.kind);render();focusHeading('.programme-panel h2');notify('Programme approved. Your preserved choices are still in place.');
    } catch(error) {state.error=error.message;render();}
    return;
  }
  if(action==='slots'||action==='slots-review') {
    const count=Number(button.dataset.count);
    if(count!==state.slots)state=changeConstraints(state,{slots:count});
    render();if(action==='slots-review')await requestPlan();return;
  }
  if(action==='set-runtime') {
    state=changeConstraints(state,{maximumRuntime:Number(button.dataset.limit)});render();await requestPlan();return;
  }
  if(action==='lock'||action==='unlock') {
    state=changeConstraints(state,{locked:action==='unlock'||state.locked.includes(id)?state.locked.filter(f=>f!==id):[...state.locked,id]});
    render();notify(state.locked.includes(id)?`${name(id)} will stay in the programme.`:`${name(id)} is unlocked.`);
    if(action==='unlock')await requestPlan();return;
  }
  if(action==='availability') {
    state=changeConstraints(state,{excluded:state.excluded.includes(id)?state.excluded.filter(f=>f!==id):[...state.excluded,id]});
    render();await requestPlan();
  }
});
document.addEventListener('change',async event=>{
  if(!state)return;
  if(event.target.id==='runtime-limit') {
    const maximumRuntime=Number(event.target.value);
    if(!Number.isInteger(maximumRuntime)||maximumRuntime<1||maximumRuntime>240){state.error='Use a whole-minute runtime limit between 1 and 240.';render();return;}
    if(maximumRuntime!==state.maximumRuntime)state=changeConstraints(state,{maximumRuntime});
    render();return;
  }
  if(event.target.dataset.available) {
    const id=event.target.dataset.available;
    state=changeConstraints(state,{excluded:event.target.checked?state.excluded.filter(f=>f!==id):[...state.excluded,id]});
    render();
    if(state.approved){await requestPlan();}
  }
});
document.addEventListener('input',event=>{
  if(!state||state.busy)return;
  if(event.target.id==='season-name')state.seasonName=event.target.value;
  if(event.target.id==='organiser-note')state.organiserNote=event.target.value;
  if(['season-name','organiser-note'].includes(event.target.id))void saveWorkspace();
  if(event.target.id==='agent-message') {
    state.agentMessage=event.target.value;
    const counter=document.querySelector('#agent-character-count');
    if(counter)counter.textContent=`${state.agentMessage.length}/800`;
  }
  if(event.target.id==='catalogue-search'){state.search=event.target.value;render();}
  if(event.target.dataset.artistQuery!==undefined) {
    try {state=changeTasteQuery(state,Number(event.target.dataset.artistQuery),event.target.value);render();}
    catch(error){state={...state,taste:{...state.taste,error:error.message}};render();}
  }
});
document.addEventListener('keydown',async event=>{if(event.key==='Enter'&&['judge-username','judge-password'].includes(event.target.id)){event.preventDefault();await signInJudge();}});
for(const dialog of document.querySelectorAll('dialog'))dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
window.addEventListener?.('storage',event=>{
  if(event.key!==STORAGE_KEY||event.newValue===savedSerialized)return;
  ++saveSequence;++workspaceRestoreSequence;savedWorkspaceBlocked=true;workspaceNotice='Another tab changed the saved programme. Reload to use its version, or start fresh here.';render();announce(workspaceNotice);
});

try {
  const response=await fetch('/api/bootstrap',{signal:AbortSignal.timeout(10000)});
  const data=await response.json();
  if(!response.ok)throw Error(data.error||'The saved catalogue could not be loaded.');
  state=createState(data);
  try {await refreshAccessStatus();}
  catch(error) {
    applyAccessStatus({packet:{...(error.accessStatus??{mode:'public',ownerAuthenticated:false,ownerSignInAvailable:false,recordedAvailable:false}),guestRemainingInteractions:0},requestId:accessStatusRequest});
    state.agentError=error.message+' Manual planning remains available.';
  }
  await restoreSavedWorkspace();
  render();await refreshAgentStatus();
} catch(error) {
  document.querySelector('#workspace-evidence-source').textContent='Catalogue unavailable';
  content.innerHTML=`<div class="loading-state" role="alert"><span class="tiny-label">THE SEASON DESK</span><h1>The catalogue could not open.</h1><p>The saved film catalogue is temporarily unavailable. Reload to try again.</p><button class="button primary" id="reload-catalogue" type="button">Reload catalogue</button><details><summary>Technical details</summary><p>${esc(error.name==='TimeoutError'?'The catalogue request timed out.':error.message)}</p></details></div>`;
  document.querySelector('#reload-catalogue')?.addEventListener('click',()=>window.location.reload());
}
