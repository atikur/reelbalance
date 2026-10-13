import {createState,selectionProblems} from './state.js';

export const STORAGE_KEY='reelbalance-workspace-v1';
export const SNAPSHOT_VERSION=1;
const MAX_SNAPSHOT_LENGTH=16384;
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const keys=(value,expected)=>record(value)&&Object.keys(value).length===expected.length&&expected.every(key=>Object.hasOwn(value,key));
const text=(value,maximum)=>typeof value==='string'&&value.length<=maximum;
const identifier=value=>text(value,96)&&value.length>0;
const evidenceId=value=>value===null||(typeof value==='string'&&/^[a-zA-Z0-9_-]{16,96}$/.test(value));
const timestamp=value=>typeof value==='string'&&value.length<=32&&Number.isFinite(Date.parse(value));
const signature=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const ids=value=>Array.isArray(value)&&value.length<=40&&value.every(identifier)&&new Set(value).size===value.length;
const copy=value=>structuredClone(value);

function canonicalFilms(data) {
  if(data?.schemaVersion!==1||!record(data.dataset)||!Array.isArray(data.films)||!data.films.length||data.films.length>40)throw Error('The current catalogue cannot be verified.');
  const films=data.films.map(film=>{
    if(!record(film)||!identifier(film.id)||!text(film.name,240)||!film.name||!Number.isInteger(film.year)||
      !Number.isFinite(film.runtime)||film.runtime<=0||typeof film.eligible!=='boolean')throw Error('The current films cannot be verified.');
    return {id:film.id,catalogue_id:String(film.catalogue_id??''),name:film.name,year:film.year,runtime:film.runtime,
      eligible:film.eligible,sourceUrl:film.sourceUrl??null,primaryRuntime:film.primaryRuntime??null,metadataNote:film.metadataNote??''};
  });
  if(new Set(films.map(film=>film.id)).size!==films.length)throw Error('The current catalogue contains duplicate films.');
  return {synthetic:data.dataset.synthetic===true,films};
}
function canonicalDataset(data) {
  const catalogue=canonicalFilms(data);
  if(!identifier(data.dataset.id)||!Array.isArray(data.profiles)||!data.profiles.length||data.profiles.length>10)throw Error('The current taste evidence cannot be verified.');
  const filmIds=catalogue.films.map(film=>film.id);
  const profiles=data.profiles.map(profile=>{
    if(!record(profile)||!identifier(profile.id)||!text(profile.name,240)||!text(profile.reference,240)||!record(profile.ranks)||
      Object.entries(profile.ranks).some(([id,rank])=>!filmIds.includes(id)||!Number.isInteger(rank)||rank<1||rank>filmIds.length))throw Error('The current rankings cannot be verified.');
    return {id:profile.id,name:profile.name,reference:profile.reference,referenceEntityId:profile.referenceEntityId??null,
      rankSource:profile.rankSource??null,rankedAt:profile.rankedAt??null,
      ranks:filmIds.filter(id=>Object.hasOwn(profile.ranks,id)).map(id=>[id,profile.ranks[id]])};
  });
  if(new Set(profiles.map(profile=>profile.id)).size!==profiles.length)throw Error('The current evidence contains duplicate profiles.');
  return {schemaVersion:1,catalogue,dataset:Object.fromEntries(['id','source','checkedAt','disclosure','endpoint','eligibility','runtimePolicy']
    .map(key=>[key,String(data.dataset[key]??'')])),profiles};
}
async function digest(value) {
  const bytes=new TextEncoder().encode(JSON.stringify(value));
  const result=await globalThis.crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(result)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
export const catalogueSignature=data=>digest(canonicalFilms(data));
export const datasetSignature=data=>digest(canonicalDataset(data));

function checkedSnapshot(snapshot) {
  if(!keys(snapshot,['schemaVersion','savedAt','catalogueSignature','activeEvidenceSignature','activeEvidenceId','checkpointEvidenceId','checkpointArtists','programme'])||
    snapshot.schemaVersion!==SNAPSHOT_VERSION||!timestamp(snapshot.savedAt)||!signature(snapshot.catalogueSignature)||!signature(snapshot.activeEvidenceSignature)||
    !evidenceId(snapshot.activeEvidenceId)||!evidenceId(snapshot.checkpointEvidenceId))return false;
  const programme=snapshot.programme;
  if(!keys(programme,['slots','maximumRuntime','excluded','locked','seasonName','organiserNote','approved'])||
    ![2,3].includes(programme.slots)||!Number.isInteger(programme.maximumRuntime)||programme.maximumRuntime<1||programme.maximumRuntime>240||
    !ids(programme.excluded)||!ids(programme.locked)||!text(programme.seasonName,80)||!text(programme.organiserNote,800))return false;
  if(programme.approved!==null&&(!keys(programme.approved,['selection','approvedAt','source'])||!ids(programme.approved.selection)||
    ![2,3].includes(programme.approved.selection.length)||!timestamp(programme.approved.approvedAt)||!['manual','live'].includes(programme.approved.source)))return false;
  if(programme.locked.some(id=>!programme.approved?.selection.includes(id)))return false;
  if(snapshot.checkpointEvidenceId===null)return snapshot.checkpointArtists===null;
  return Array.isArray(snapshot.checkpointArtists)&&snapshot.checkpointArtists.length===3&&
    snapshot.checkpointArtists.every(artist=>keys(artist,['artistId','searchId'])&&identifier(artist.artistId)&&text(artist.searchId,96)&&artist.searchId.length>0)&&
    new Set(snapshot.checkpointArtists.map(artist=>artist.artistId)).size===3;
}

export async function createWorkspaceSnapshot(state,{now=Date.now()}={}) {
  // Opening a recorded walkthrough must not replace the saved real workspace.
  if(state?.mode==='recorded'||state?.approved?.source==='recorded')return null;
  const exampleData=state.exampleData??state.data;
  const checkpointEvidenceId=state.taste?.evidenceId??null;
  const checkpointArtists=checkpointEvidenceId?state.taste.selected.map(artist=>({artistId:artist?.artistId,searchId:artist?.searchId})):null;
  const snapshot={schemaVersion:SNAPSHOT_VERSION,savedAt:new Date(now).toISOString(),
    catalogueSignature:await catalogueSignature(exampleData),activeEvidenceSignature:await datasetSignature(state.data),
    activeEvidenceId:state.evidenceId??null,checkpointEvidenceId,checkpointArtists,
    programme:{slots:state.slots,maximumRuntime:state.maximumRuntime,excluded:[...state.excluded],locked:[...state.locked],
      seasonName:state.seasonName,organiserNote:state.organiserNote,
      approved:state.approved?{selection:[...state.approved.selection],approvedAt:state.approved.approvedAt,source:state.approved.source}:null}};
  if(!checkedSnapshot(snapshot))throw Error('The current programme cannot be saved safely.');
  return snapshot;
}

export function parseWorkspaceSnapshot(serialized) {
  if(serialized===null||serialized===undefined)return {status:'empty',snapshot:null};
  if(typeof serialized!=='string'||serialized.length>MAX_SNAPSHOT_LENGTH)return {status:'invalid',snapshot:null};
  try {
    const snapshot=JSON.parse(serialized);
    if(record(snapshot)&&snapshot.schemaVersion!==SNAPSHOT_VERSION)return {status:'obsolete',snapshot:null};
    return checkedSnapshot(snapshot)?{status:'ready',snapshot}:{status:'invalid',snapshot:null};
  } catch {return {status:'invalid',snapshot:null};}
}

function canonicalEvidence(packet,id,exampleData,{complete=false}={}) {
  if(packet?.schemaVersion!==1||packet.evidenceId!==id||!['complete','pending','paused'].includes(packet.status)||packet.profileCount!==3||
    !Array.isArray(packet.artists)||packet.artists.length!==3||packet.artists.some(artist=>!identifier(artist.id)||!text(artist.name,240)||!artist.name)||
    new Set(packet.artists.map(artist=>artist.id)).size!==3||!Number.isInteger(packet.completedProfiles)||packet.completedProfiles<0||packet.completedProfiles>3)throw Error('The saved artist checkpoint could not be verified.');
  if(complete&&packet.status!=='complete')throw Error('The saved programme evidence is not complete.');
  if(packet.status==='complete') {
    if(packet.completedProfiles!==3||packet.source!=='custom_taste'||packet.dataset?.dataset?.id!==id||packet.dataset.profiles?.length!==3||
      packet.dataset.profiles.some((profile,index)=>profile.reference!==packet.artists[index].name||profile.referenceEntityId!==packet.artists[index].id))throw Error('The saved programme evidence could not be verified.');
    canonicalDataset(packet.dataset);
    if(JSON.stringify(canonicalFilms(packet.dataset))!==JSON.stringify(canonicalFilms(exampleData)))throw Error('The saved artist evidence belongs to another catalogue.');
  }
  return packet;
}

export async function restoreWorkspace(snapshot,{exampleData,activeEvidencePacket=null,checkpointPacket=null}={}) {
  if(!checkedSnapshot(snapshot))return {status:snapshot?.schemaVersion!==SNAPSHOT_VERSION?'obsolete':'invalid',snapshot};
  try {
    if(await catalogueSignature(exampleData)!==snapshot.catalogueSignature)return {status:'obsolete',snapshot,reason:'catalogue_changed'};
    let activeData=exampleData;
    if(snapshot.activeEvidenceId) {
      if(!activeEvidencePacket)return {status:'evidence_unavailable',snapshot,reason:'active_evidence_missing'};
      activeData=canonicalEvidence(activeEvidencePacket,snapshot.activeEvidenceId,exampleData,{complete:true}).dataset;
    }
    if(await datasetSignature(activeData)!==snapshot.activeEvidenceSignature)return {status:'obsolete',snapshot,reason:'evidence_changed'};
    const filmIds=new Set(activeData.films.map(film=>film.id));
    const programme=snapshot.programme;
    if([...programme.excluded,...programme.locked,...(programme.approved?.selection??[])].some(id=>!filmIds.has(id)))return {status:'invalid',snapshot,reason:'unknown_film'};
    // Preserve an unresolved cancellation or edited brief. Do not turn an invalid
    // current programme into an empty or silently newly approved programme.
    let state={...createState(copy(activeData)),exampleData:copy(exampleData),evidenceId:snapshot.activeEvidenceId,
      ...copy(programme),revision:1};
    let checkpointRestored=false;
    let checkpointUnavailable=false;
    if(snapshot.checkpointEvidenceId) {
      const packet=checkpointPacket??(snapshot.checkpointEvidenceId===snapshot.activeEvidenceId?activeEvidencePacket:null);
      if(packet) {
        try {
          canonicalEvidence(packet,snapshot.checkpointEvidenceId,exampleData);
          if(packet.artists.some((artist,index)=>artist.id!==snapshot.checkpointArtists[index].artistId))throw Error('The saved artists changed.');
          const selected=packet.artists.map((artist,index)=>({artistId:artist.id,searchId:snapshot.checkpointArtists[index].searchId,name:artist.name,
            source:artist.rankSource??'cached',fetchedAt:artist.rankedAt??undefined}));
          state={...state,taste:{...state.taste,open:snapshot.checkpointEvidenceId!==snapshot.activeEvidenceId,
            queries:packet.artists.map(artist=>artist.name),selected,evidenceId:packet.evidenceId,packet:copy(packet),needsStatusCheck:true}};
          checkpointRestored=true;
        } catch {checkpointUnavailable=true;}
      } else checkpointUnavailable=true;
    }
    return {status:'restored',state,snapshot,checkpointRestored,checkpointUnavailable,
      issues:programme.approved?selectionProblems(state,programme.approved.selection):[]};
  } catch {return {status:'evidence_unavailable',snapshot,reason:'verification_failed'};}
}

export function createWorkspaceStorage({getStorage=()=>globalThis.localStorage,key=STORAGE_KEY}={}) {
  const unavailable=()=>({status:'unavailable'});
  return {
    read() {
      try {const serialized=getStorage().getItem(key);return {...parseWorkspaceSnapshot(serialized),serialized};}
      catch {return unavailable();}
    },
    write(snapshot,options={}) {
      if(!checkedSnapshot(snapshot))return {status:'invalid'};
      try {
        const storage=getStorage();
        if(Object.hasOwn(options,'expectedSerialized')&&storage.getItem(key)!==options.expectedSerialized)return {status:'conflict'};
        const serialized=JSON.stringify(snapshot);
        if(serialized.length>MAX_SNAPSHOT_LENGTH)return {status:'invalid'};
        storage.setItem(key,serialized);return {status:'saved',serialized};
      } catch {return unavailable();}
    },
    clear(options={}) {
      try {
        const storage=getStorage();
        if(Object.hasOwn(options,'expectedSerialized')&&storage.getItem(key)!==options.expectedSerialized)return {status:'conflict'};
        storage.removeItem(key);return {status:'cleared',serialized:null};
      } catch {return unavailable();}
    },
  };
}
