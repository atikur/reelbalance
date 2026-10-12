export const escapeHtml=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');

export function createState(data) {
  return {data,exampleData:data,evidenceId:null,taste:{open:false,revision:0,requestNumber:0,queries:['','',''],searches:[null,null,null],selected:[null,null,null],status:null,packet:null,evidenceId:null,pending:null,error:null,needsStatusCheck:false},view:'programme',mode:'live',recordedStage:null,revision:0,slots:3,maximumRuntime:110,excluded:[],locked:[],
    approved:null,proposal:null,receipt:null,trace:[],busy:false,error:null,
    seasonName:'October film club',organiserNote:'',search:'',agentStatus:null,agentStatusBusy:false,
    agentMessage:'',agentResponse:null,agentError:null,agentPending:false,agentVerified:false};
}
export function bindTasteEvidence(state,request) {
  return {...request,...(state.evidenceId?{evidenceId:state.evidenceId}:{})};
}
export function evidenceDate(value) {
  if(!value)return 'Date unavailable';
  const date=new Date(value);
  return Number.isFinite(date.getTime())?new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(date):'Date unavailable';
}
export const tasteSourceLabel=source=>({live:'Qloo lookup',cached:'Saved Qloo evidence',cached_example:'Saved example evidence'})[source]??'Saved Qloo evidence';
export const normalizeArtistQuery=query=>query.trim().replace(/\s+/g,' ');
export function tasteLiveReady(state,now=Date.now()) {
  const taste=state.taste,guard=taste.status?.guard;
  return taste.status?.liveEnabled===true&&!taste.needsStatusCheck&&!guard?.paused&&!guard?.busy&&guard?.remainingRequests!==0&&
    !(guard?.nextAllowedAt&&new Date(guard.nextAllowedAt).getTime()>now);
}
export function openTastePicker(state) {
  if(state.busy)throw Error('Wait for the current request before changing taste profiles.');
  if(state.mode==='recorded')throw Error('Exit the recording before choosing your own artists.');
  return {...state,taste:{...state.taste,open:true,error:null}};
}
function tasteSlot(index) {
  if(!Number.isInteger(index)||index<0||index>2)throw Error('Choose one of the three taste profiles.');
}
export function changeTasteQuery(state,index,query) {
  tasteSlot(index);
  if(state.busy||state.mode==='recorded')throw Error('Wait for the current request before editing an artist.');
  if(typeof query!=='string'||query.length>80)throw Error('Use an artist query of up to 80 characters.');
  const queries=[...state.taste.queries];queries[index]=query;
  const searches=[...state.taste.searches];searches[index]=null;
  const selected=[...state.taste.selected];selected[index]=null;
  return {...state,taste:{...state.taste,revision:state.taste.revision+1,queries,searches,selected,packet:null,evidenceId:null,error:null}};
}
function artistOptions(packet) {
  if(typeof packet?.searchId!=='string'||!packet.searchId||!Array.isArray(packet.options)||
     packet.options.some(artist=>typeof artist.id!=='string'||!artist.id||typeof artist.name!=='string'||!artist.name||artist.type!=='artist')||
     new Set(packet.options.map(artist=>artist.id)).size!==packet.options.length)throw Error('The artist matches could not be verified.');
  return packet;
}
export function confirmTasteArtist(state,index,searchId,artistId) {
  tasteSlot(index);
  if(state.busy||state.mode==='recorded')throw Error('Wait for the current request before confirming an artist.');
  const matches=[state.taste.searches[index],state.taste.status?.knownArtists].find(packet=>packet?.searchId===searchId);
  const artist=artistOptions(matches).options.find(option=>option.id===artistId);
  if(!artist)throw Error('Confirm an artist from the displayed canonical matches.');
  if(state.taste.selected.some((selection,i)=>i!==index&&selection?.artistId===artistId))throw Error('Choose three different artists for these profiles.');
  const selected=[...state.taste.selected];selected[index]={searchId,artistId,name:artist.name,source:matches.source,fetchedAt:matches.fetchedAt};
  return {...state,taste:{...state.taste,revision:state.taste.revision+1,selected,packet:null,evidenceId:null,error:null}};
}
export function tasteSelectionRequest(state) {
  if(state.mode==='recorded'||state.taste.selected.some(selection=>!selection))throw Error('Confirm one artist for each of the three profiles first.');
  return {artists:state.taste.selected.map(({searchId,artistId})=>({searchId,artistId}))};
}
export function beginTasteOperation(state,kind,index=null) {
  if(state.busy||state.mode==='recorded')throw Error('Wait for the current request before using the artist picker.');
  if(!['status','search','select','progress','rank'].includes(kind))throw Error('Unknown taste-profile operation.');
  if(kind==='search') {
    tasteSlot(index);
    if(!state.taste.queries[index].trim())throw Error('Type an artist name, then press Search.');
  }
  if(kind==='select')tasteSelectionRequest(state);
  if(['progress','rank'].includes(kind)&&!state.taste.evidenceId)throw Error('Prepare the three confirmed profiles first.');
  if(kind==='rank'&&state.taste.packet?.status!=='pending')throw Error('There is no pending ranking step.');
  if(kind==='rank') {
    const guard=state.taste.status?.guard;
    if(!state.taste.status?.liveEnabled)throw Error('Live Qloo lookups are disabled on this local server. You can use the saved example artists.');
    if(state.taste.needsStatusCheck)throw Error('Check readiness before making another Qloo request.');
    if(guard?.paused||guard?.busy||guard?.remainingRequests===0)throw Error('Qloo requests are paused. Check readiness for the current status.');
    if(guard?.nextAllowedAt&&new Date(guard.nextAllowedAt).getTime()>Date.now())throw Error('Wait until the next permitted request time, then check readiness.');
  }
  const id=state.taste.requestNumber+1;
  return {...state,busy:true,taste:{...state.taste,requestNumber:id,error:null,pending:{id,kind,index,revision:state.taste.revision,evidenceId:state.taste.evidenceId,programmeRevision:state.revision,datasetEvidenceId:state.evidenceId,live:kind==='rank'||(kind==='search'&&tasteLiveReady(state))}}};
}
function currentTasteOperation(state,token) {
  return state.mode==='live'&&state.taste.pending?.id===token?.id&&state.taste.pending?.kind===token?.kind&&state.taste.revision===token?.revision&&state.revision===token?.programmeRevision&&state.evidenceId===token?.datasetEvidenceId;
}
export function failTasteOperation(state,token,message) {
  if(!currentTasteOperation(state,token))return state;
  return {...state,busy:false,taste:{...state.taste,pending:null,error:message,needsStatusCheck:state.taste.needsStatusCheck||(token.live===true&&['search','rank'].includes(token.kind))}};
}
export function receiveTasteStatus(state,packet,token) {
  if(!currentTasteOperation(state,token))return state;
  if(token.kind!=='status'||packet?.schemaVersion!==1||typeof packet.liveEnabled!=='boolean'||!packet.guard)throw Error('Taste request status could not be verified.');
  artistOptions(packet.knownArtists);
  return {...state,busy:false,taste:{...state.taste,pending:null,status:structuredClone(packet),error:null,needsStatusCheck:false}};
}
export function receiveTasteSearch(state,packet,token) {
  if(!currentTasteOperation(state,token))return state;
  if(token.kind!=='search'||packet?.schemaVersion!==1||packet.query!==normalizeArtistQuery(state.taste.queries[token.index])||![0,1].includes(packet.qlooRequests)||(token.live===false&&packet.qlooRequests!==0))throw Error('These artist results do not match the current query.');
  artistOptions(packet);
  const searches=[...state.taste.searches];searches[token.index]=structuredClone(packet);
  return {...state,busy:false,taste:{...state.taste,pending:null,searches,error:null,needsStatusCheck:token.live?false:state.taste.needsStatusCheck,
    status:state.taste.status?{...state.taste.status,guard:packet.guard??state.taste.status.guard}:null}};
}
function checkedTastePacket(state,packet,token) {
  if(packet?.schemaVersion!==1||typeof packet.evidenceId!=='string'||!packet.evidenceId||
     !['pending','complete','paused'].includes(packet.status)||packet.profileCount!==3||!Array.isArray(packet.artists)||packet.artists.length!==3||
     !Number.isInteger(packet.completedProfiles)||packet.completedProfiles<0||packet.completedProfiles>3||
     packet.artists.some((artist,index)=>artist.id!==state.taste.selected[index]?.artistId)||
     (token.kind!=='select'&&packet.evidenceId!==token.evidenceId))throw Error('The ranking progress does not match the confirmed artists.');
  if(packet.status==='complete') {
    if(packet.completedProfiles!==3||packet.source!=='custom_taste'||packet.dataset?.schemaVersion!==1||packet.dataset.dataset?.id!==packet.evidenceId||
       !Array.isArray(packet.dataset.profiles)||packet.dataset.profiles.length!==3||
       !Array.isArray(packet.dataset.films)||!sameIds(packet.dataset.films.map(film=>film.id),(state.exampleData??state.data).films.map(film=>film.id)))throw Error('The completed taste evidence does not match the vetted film shortlist.');
    const filmIds=packet.dataset.films.map(film=>film.id);
    if(new Set(packet.dataset.profiles.map(profile=>profile.id)).size!==3)throw Error('The three completed profiles must remain distinct.');
    for(const [index,profile] of packet.dataset.profiles.entries()) {
      if(typeof profile.id!=='string'||!profile.id||profile.reference!==packet.artists[index].name||
         (profile.referenceEntityId&&profile.referenceEntityId!==packet.artists[index].id)||!profile.ranks||typeof profile.ranks!=='object'||Array.isArray(profile.ranks)||
         Object.entries(profile.ranks).some(([id,rank])=>!filmIds.includes(id)||!Number.isInteger(rank)||rank<1||rank>filmIds.length))throw Error('The completed original rankings could not be verified.');
    }
  }
  return structuredClone(packet);
}
export function receiveTasteProgress(state,packet,token) {
  if(!currentTasteOperation(state,token))return state;
  if(!['select','progress','rank'].includes(token.kind))throw Error('Unexpected ranking-progress response.');
  const checked=checkedTastePacket(state,packet,token);
  return {...state,busy:false,taste:{...state.taste,pending:null,packet:checked,evidenceId:checked.evidenceId,error:null,needsStatusCheck:false,
    status:state.taste.status?{...state.taste.status,guard:packet.guard??state.taste.status.guard}:null}};
}
export function applyTasteDataset(state) {
  if(state.busy||state.mode==='recorded')throw Error('Wait for the current request before applying taste evidence.');
  const packet=state.taste.packet;
  if(packet?.status!=='complete')throw Error('Complete all three original ranking steps before applying the new profiles.');
  const checked=checkedTastePacket(state,packet,{kind:'progress',evidenceId:state.taste.evidenceId});
  const fresh=createState(checked.dataset);
  return {...fresh,exampleData:state.exampleData??state.data,evidenceId:checked.evidenceId,revision:state.revision+1,
    taste:{...state.taste,open:false,pending:null,error:null}};
}
export function resetExampleState(state) {
  if(state.busy)throw Error('Wait for the current request before resetting the example.');
  return {...createState(state.exampleData??state.data),revision:state.revision+1};
}
export function planningRequest(state) {
  return {slots:state.slots,maximumRuntime:state.maximumRuntime,excluded:[...state.excluded],
    locked:[...state.locked],current:[...(state.approved?.selection??[])]};
}
export function changeConstraints(state,patch) {
  return {...state,...patch,revision:state.revision+1,proposal:null,error:null,agentResponse:null,agentError:null};
}
export function usableFilms(state,ids,maximumRuntime=state.maximumRuntime) {
  return ids.flatMap(id=>{
    const film=state.data.films.find(f=>f.id===id);
    return film?.eligible && !state.excluded.includes(id) && film.runtime<=maximumRuntime ? [film] : [];
  });
}
export function supportRows(state,ids,maximumRuntime=state.maximumRuntime) {
  const usable=usableFilms(state,ids,maximumRuntime);
  const eligible=usableFilms(state,state.data.films.map(f=>f.id),maximumRuntime);
  return state.data.profiles.map(profile=>{
    const ranked=usable.filter(f=>Number.isInteger(profile.ranks[f.id]));
    const best=ranked.length ? Math.min(...ranked.map(f=>profile.ranks[f.id])) : null;
    return {profile,bestRank:best,supported:best!==null && best<=5,
      originalScored:Object.keys(profile.ranks).length,
      eligibleScored:eligible.filter(f=>Number.isInteger(profile.ranks[f.id])).length,
      eligibleCount:eligible.length,unscoredSelected:usable.filter(f=>!Number.isInteger(profile.ranks[f.id])).length};
  });
}
export function selectionProblems(state,ids,maximumRuntime=state.maximumRuntime,slots=state.slots) {
  const issues=[];
  if(ids.length!==slots)issues.push(`The programme needs ${slots} films, but contains ${ids.length}.`);
  if(new Set(ids).size!==ids.length)issues.push('A film occurs more than once.');
  for(const id of ids) {
    const film=state.data.films.find(f=>f.id===id);
    if(!film)issues.push('The programme contains an unknown film.');
    else if(!film.eligible || state.excluded.includes(id))issues.push(`${film.name} is unavailable in this shortlist.`);
    else if(film.runtime>maximumRuntime)issues.push(`${film.name} exceeds the ${maximumRuntime}-minute limit.`);
  }
  if(state.locked.some(id=>!ids.includes(id)))issues.push('The programme does not preserve every locked choice.');
  return issues;
}
export function receiveProposal(state,response,revision) {
  if(revision!==state.revision)return state;
  return {...state,busy:false,error:null,proposal:{revision,request:planningRequest(state),...response},
    trace:response.toolTrace??response.result?.toolTrace??[]};
}
function validateProposalRequest(state,request) {
  if(!request || typeof request!=='object' || Array.isArray(request))throw Error('The agent returned an invalid programme brief. Nothing was changed.');
  const keys=['slots','maximumRuntime','excluded','locked','current'];
  if(Object.keys(request).some(key=>!keys.includes(key)) || keys.some(key=>!(key in request)))throw Error('The agent returned an incomplete programme brief. Nothing was changed.');
  if(![2,3].includes(request.slots) || !Number.isInteger(request.maximumRuntime) || request.maximumRuntime<1 || request.maximumRuntime>240)throw Error('The proposed nights or runtime are invalid. Nothing was changed.');
  for(const key of ['excluded','locked','current']) {
    if(!Array.isArray(request[key]) || new Set(request[key]).size!==request[key].length || request[key].some(id=>typeof id!=='string' || !state.data.films.some(f=>f.id===id)))throw Error('The agent returned an invalid film choice. Nothing was changed.');
  }
  const current=planningRequest(state);
  for(const key of ['locked','current'])if(request[key].length!==current[key].length || request[key].some((id,i)=>id!==current[key][i]))throw Error('The proposal changed a preserved choice. Nothing was changed.');
  if(current.excluded.some(id=>!request.excluded.includes(id)))throw Error('The proposal restored an unavailable film. Nothing was changed.');
  return {slots:request.slots,maximumRuntime:request.maximumRuntime,excluded:[...request.excluded],locked:[...request.locked],current:[...request.current]};
}
export function proposalPlanningState(state) {
  if(!state.proposal)return state;
  const request=validateProposalRequest(state,state.proposal.request);
  return {...state,slots:request.slots,maximumRuntime:request.maximumRuntime,excluded:request.excluded,locked:request.locked};
}
export function receiveAgentResponse(state,response,revision) {
  if(revision!==state.revision)return state;
  const source=response?.source??'live';
  if(!['live','recorded'].includes(source) || (source==='recorded')!==(state.mode==='recorded'))throw Error('This reply belongs to a different assistant mode. Nothing was changed.');
  if(typeof response?.answer!=='string' || response.qlooRequests!==0)throw Error('The agent response could not be verified. Nothing was changed.');
  if(source==='recorded' && (response.llmRequests!==0 || response.usage?.inputTokens!==0 || response.usage?.outputTokens!==0))throw Error('The recorded reply must use zero new API requests. Nothing was changed.');
  let proposal=null;
  if(response.proposal) {
    const request=validateProposalRequest(state,response.proposal.request);
    if(!response.proposal.result || (response.proposal.result.status!=='hard_conflict' && !Array.isArray(response.proposal.result.selection)))throw Error('The agent returned an invalid programme proposal. Nothing was changed.');
    proposal={...response.proposal,request,revision,source:source==='recorded'?'recorded':'agent'};
  }
  return {...state,busy:false,agentPending:false,agentError:null,error:null,proposal,agentVerified:source==='live',
    agentResponse:{revision,source,model:response.model,answer:response.answer,usage:response.usage,llmRequests:response.llmRequests,qlooRequests:0,toolTrace:response.toolTrace??[],recordedUsage:response.recordedUsage,provenance:response.provenance},
    trace:response.toolTrace??response.proposal?.toolTrace??[]};
}
function recordedScenario(packet,id) {
  if(packet?.schemaVersion!==1 || packet.mode!=='recorded' || packet.llmRequests!==0 || packet.qlooRequests!==0 ||
     !Array.isArray(packet.scenarios) || packet.scenarios.length!==2 || new Set(packet.scenarios.map(s=>s.id)).size!==2)throw Error('The recorded example could not be verified.');
  const scenario=packet.scenarios.find(s=>s.id===id);
  if(!scenario?.context || scenario.response?.source!=='recorded' || !scenario.response.proposal)throw Error('The recorded scenario could not be verified.');
  return scenario;
}
const sameIds=(left,right)=>Array.isArray(left)&&Array.isArray(right)&&left.length===right.length&&left.every((id,index)=>id===right[index]);
function applyRecordedScenario(state,scenario) {
  const context=planningRequest(state);
  const request=scenario.response.proposal.request;
  if(context.slots!==scenario.context.slots || context.maximumRuntime!==scenario.context.maximumRuntime ||
     request?.slots!==context.slots || request.maximumRuntime!==context.maximumRuntime ||
     ['current','locked','excluded'].some(key=>!sameIds(context[key],scenario.context[key]) || !sameIds(context[key],request[key])))throw Error('This recording does not match the current brief. Restart the recorded example.');
  return receiveAgentResponse(state,{...scenario.response,provenance:scenario.provenance},state.revision);
}
export function enterRecordedDemo(state,packet) {
  if(state.busy)throw Error('Wait for the current request before opening the recorded example.');
  const scenario=recordedScenario(packet,'initial');
  const fresh={...createState(state.exampleData??state.data),mode:'recorded',recordedStage:'initial',revision:state.revision+1,seasonName:'Recorded film-club example'};
  return applyRecordedScenario(fresh,scenario);
}
export function canStageRecordedCancellation(state,packet) {
  if(state.busy || state.mode!=='recorded' || state.recordedStage!=='initial' || state.approved?.source!=='recorded')return false;
  try {
    const initial=recordedScenario(packet,'initial');
    const cancellation=recordedScenario(packet,'cancellation');
    return state.slots===initial.context.slots && state.maximumRuntime===initial.context.maximumRuntime &&
      sameIds(state.approved.selection,cancellation.context.current) && sameIds(state.excluded,initial.context.excluded) &&
      (sameIds(state.locked,initial.context.locked)||sameIds(state.locked,cancellation.context.locked));
  } catch {return false;}
}
export function stageRecordedCancellation(state,packet) {
  if(!canStageRecordedCancellation(state,packet))throw Error('Approve the original recorded draft at 110 minutes before staging its cancellation. Restart the example if its brief has changed.');
  const scenario=recordedScenario(packet,'cancellation');
  const staged=changeConstraints(state,{slots:scenario.context.slots,maximumRuntime:scenario.context.maximumRuntime,
    locked:[...scenario.context.locked],excluded:[...scenario.context.excluded],recordedStage:'cancellation'});
  return applyRecordedScenario(staged,scenario);
}
export function exitRecordedDemo(state) {
  if(state.busy)throw Error('Wait for the current request before resetting the example.');
  return {...createState(state.exampleData??state.data),revision:state.revision+1};
}
export function approveProposal(state,kind='current') {
  const proposal=state.proposal;
  if(!proposal || proposal.revision!==state.revision)throw Error('This proposal is out of date. Review the current constraints again.');
  const alternative=kind==='runtime' ? proposal.runtimeAlternative : null;
  if(kind==='runtime' && !alternative)throw Error('No runtime alternative is available.');
  const target=proposalPlanningState(state);
  const result=alternative?.result??proposal.result;
  const limit=alternative?.maximumRuntime??target.maximumRuntime;
  if(!Number.isInteger(limit) || limit<1 || limit>240 || (alternative && limit<target.maximumRuntime))throw Error('The proposed runtime alternative is invalid. Nothing was changed.');
  if(!result?.selection || result.status==='hard_conflict')throw Error('Resolve the conflict before approving a programme.');
  const issues=selectionProblems(target,result.selection,limit);
  if(issues.length)throw Error(issues.join(' '));
  const order=result.nightOrder??result.selection;
  if(order.length!==result.selection.length || new Set(order).size!==order.length || order.some(id=>!result.selection.includes(id)))throw Error('The proposed night order is invalid.');
  const previous=state.approved?.selection??[];
  const added=result.selection.filter(id=>!previous.includes(id));
  const expected=previous.length===target.slots?previous.map(id=>result.selection.includes(id)?id:added.shift()):[...previous.filter(id=>result.selection.includes(id)),...added];
  if(order.some((id,i)=>id!==expected[i]))throw Error('The proposed night order changes a preserved night. Nothing was changed.');
  return {...state,revision:state.revision+1,slots:target.slots,excluded:[...target.excluded],maximumRuntime:limit,proposal:null,error:null,
    approved:{selection:[...order],approvedAt:new Date().toISOString(),source:proposal.source==='recorded'?'recorded':proposal.source==='agent'?'live':'manual'},
    receipt:{removed:previous.filter(id=>!order.includes(id)),added:order.filter(id=>!previous.includes(id)),
      preserved:previous.filter(id=>order.includes(id)),lockedPreserved:state.locked.length,
      previousLimit:state.maximumRuntime,maximumRuntime:limit,previousSlots:state.slots,slots:target.slots,
      excludedAdded:target.excluded.filter(id=>!state.excluded.includes(id)),
      support:supportRows(target,order,limit).filter(r=>r.supported).length,
      source:proposal.source==='recorded'?'recorded':proposal.source==='agent'?'live':'manual',initial:!previous.length}};
}
export function makeSheetHtml(state) {
  if(typeof state.seasonName!=='string' || !state.seasonName.trim() || state.seasonName.length>80)throw Error('Add a programme name of up to 80 characters before exporting.');
  if(typeof state.organiserNote!=='string' || state.organiserNote.length>800)throw Error('Keep organiser notes within 800 characters before exporting.');
  const ids=state.approved?.selection??[];
  if(!ids.length)throw Error('Approve a programme before exporting.');
  const issues=selectionProblems(state,ids);
  if(issues.length)throw Error(`Review this programme before exporting: ${issues.join(' ')}`);
  const esc=escapeHtml;
  const recorded=state.approved.source==='recorded';
  const synthetic=state.data.dataset.synthetic===true;
  if(synthetic&&recorded)throw Error('An invented setup example cannot claim a recorded model response.');
  const support=supportRows(state,ids);
  const entries=ids.map((id,index)=>{
    const film=state.data.films.find(f=>f.id===id);
    const references=support.filter(row=>Number.isInteger(row.profile.ranks[id]) && row.profile.ranks[id]<=5).map(row=>`${row.profile.reference} reference: original rank ${row.profile.ranks[id]}`);
    return `<section class="sheet-entry"><small>NIGHT ${String(index+1).padStart(2,'0')}</small><h3>${esc(film.name)}</h3><p>${film.year} (${synthetic?'invented year':'Qloo year'}) · ${film.runtime} minutes (planning runtime)${film.primaryRuntime ? ` · ${film.primaryRuntime} minutes (primary-source runtime)` : ''}</p><p>${references.length ? `Ranking support: ${references.map(esc).join('; ')}.` : 'This title provides no top-five support for these references.'}</p><p>${esc(film.metadataNote||'Primary-source identity and runtime cross-check recorded.')}</p>${film.sourceUrl?`<a href="${esc(film.sourceUrl)}" target="_blank" rel="noreferrer">Film facts source</a>`:'<p>Invented fixture; no film facts source.</p>'}</section>`;
  }).join('');
  const unsupported=support.filter(r=>!r.supported).map(r=>r.profile.reference);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(state.seasonName)} — ReelBalance</title><style>body{font:15px/1.7 system-ui;color:#244638;max-width:740px;margin:40px auto;padding:24px}h1,h2,h3{font-family:Georgia,serif;font-weight:400}h1{font-size:38px}h3{font-size:24px;margin:8px 0}.sheet-entry{border-top:1px solid #d6ddcb;padding:20px 0}small{letter-spacing:1px;color:#879774;font-size:10px}a{color:#426234}p{margin:8px 0}.sheet-note{background:#f2f5eb;padding:16px;white-space:pre-wrap}.sheet-policy{font-size:12px;color:#6d805e;border-top:1px solid #d6ddcb;padding-top:20px}@media print{body{margin:0}section{break-inside:avoid}}</style></head><body><main><div class="sheet-head"><small>REELBALANCE · ${synthetic?'APPROVED SYNTHETIC SETUP':recorded?'APPROVED RECORDED DEMO':state.evidenceId?'APPROVED CUSTOM TASTE':'APPROVED EXAMPLE'} PROGRAMME</small><h1>${esc(state.seasonName)}</h1><p>${ids.length} screenings · up to ${state.maximumRuntime} minutes per film · ${support.filter(r=>r.supported).length}/${support.length} taste profiles with top-five support.</p>${recorded?'<p>Recorded Luna demo: a saved GPT-6 Luna response was replayed; this replay made zero new OpenAI or Qloo API requests. The organiser explicitly approved these example selections.</p>':''}</div>${entries}${state.organiserNote?`<div class="sheet-note">${esc(state.organiserNote)}</div>`:''}<p class="sheet-policy"><strong>Programme evidence:</strong> ${esc(state.data.dataset.source)} snapshot from ${esc(evidenceDate(state.data.dataset.checkedAt))}. ${state.data.profiles.map(profile=>profile.rankedAt?`${esc(profile.reference)}: ${esc(tasteSourceLabel(profile.rankSource??'cached'))} · ${esc(evidenceDate(profile.rankedAt))}; ${Object.keys(profile.ranks).length}/${state.data.films.length} films scored. `:'').join('')}Support means at least one selected film lies in a profile's original top five in this fixed catalogue. ${unsupported.length ? `Profiles without top-five support: ${unsupported.map(esc).join(', ')}. ` : ''}This is a planning policy, not a prediction of enjoyment or attendance. ${esc(state.data.dataset.disclosure)}<br><br><strong>Before screening:</strong> ${esc(state.data.dataset.eligibility)} ${esc(state.data.dataset.runtimePolicy)}<br><br>Programme approved ${esc(new Date(state.approved.approvedAt).toISOString())}. Generated by ReelBalance.</p></main></body></html>`;
}
