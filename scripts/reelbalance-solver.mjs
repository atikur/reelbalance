function combinations(items,k,start=0,prefix=[],out=[]) {
  if (!k) {out.push(prefix);return out;}
  for(let i=start;i<=items.length-k;i++) combinations(items,k-1,i+1,[...prefix,items[i]],out);
  return out;
}
function compare(a,b) {
  for(let i=0;i<Math.max(a.length,b.length);i++) {
    if(a[i]===b[i])continue;
    return a[i]<b[i] ? -1 : 1;
  }
  return 0;
}

// Rank-based support is an explicit app policy, not a satisfaction probability.
export function solveProgramme({films,groups,slots=3,topK=5,maximumRuntime=120,excluded=[],locked=[],current=[]}) {
  if (new Set(films.map(f=>f.id)).size!==films.length || new Set(groups.map(g=>g.id)).size!==groups.length ||
      !groups.length || !Number.isInteger(slots) || slots<1 || !Number.isInteger(topK) || topK<1 ||
      !Number.isFinite(maximumRuntime) || maximumRuntime<=0 || new Set(locked).size!==locked.length) throw Error('Invalid solver input');
  const pool=films.filter(f=>f.eligible===true && Number.isFinite(f.runtime) && f.runtime>0 && f.runtime<=maximumRuntime && !excluded.includes(f.id));
  const invalidLocks=locked.filter(id=>!pool.some(f=>f.id===id));
  if(invalidLocks.length || locked.length>slots) return {status:'hard_conflict',invalid_locks:invalidLocks,selection:null};
  const choices=combinations(pool,slots).filter(set=>locked.every(id=>set.some(f=>f.id===id)));
  if(!choices.length)return {status:'hard_conflict',reason:'Too few eligible films for the slots or conflicting locks',selection:null};
  const assessed=choices.map(set=> {
    const ids=set.map(f=>f.id);
    const evidence=groups.map(g=> {
      const known=ids.flatMap(id=>Number.isInteger(g.ranks[id]) && g.ranks[id]>0 ? [g.ranks[id]] : []);
      const best=known.length ? Math.min(...known) : null;
      return {group:g.id,best_cached_rank:best,known_top_k_support:best!==null && best<=topK,
        scored_eligible:pool.filter(f=>Number.isInteger(g.ranks[f.id])).length,eligible_count:pool.length,
        unscored_selected:ids.filter(id=>!Number.isInteger(g.ranks[id]))};
    });
    const represented=evidence.filter(e=>e.known_top_k_support).length;
    const edits=current.filter(id=>!ids.includes(id)).length;
    const knownBest=evidence.flatMap(e=>e.best_cached_rank===null ? [] : [e.best_cached_rank]);
    return {selection:ids,evidence,represented,edits,
      comparison:[-represented,...(current.length ? [edits] : []),-knownBest.length,...knownBest.sort((a,b)=>b-a)]};
  });
  assessed.sort((a,b)=>compare(a.comparison,b.comparison) || a.selection.join(',').localeCompare(b.selection.join(',')));
  const best=assessed[0];
  const incomplete=best.evidence.some(e=>e.scored_eligible<e.eligible_count);
  return {status:best.represented===groups.length ? 'known_coverage_met' : incomplete ? 'coverage_not_certified' : 'coverage_shortfall',
    ...best,feasible_portfolios:assessed.length,top_k:topK,
    changes:{removed:current.filter(id=>!best.selection.includes(id)),added:best.selection.filter(id=>!current.includes(id))}};
}
