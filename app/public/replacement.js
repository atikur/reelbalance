const TOP_K = 5;
const originalRank = (profile, id) => Number.isInteger(profile.ranks[id]) && profile.ranks[id] > 0 ? profile.ranks[id] : null;
const bestRank = (profile, ids) => {
  const ranks = ids.map(id => originalRank(profile, id)).filter(rank => rank !== null);
  return ranks.length ? Math.min(...ranks) : null;
};
const supported = rank => rank !== null && rank <= TOP_K;
const uniqueIds = ids => Array.isArray(ids) && ids.every(id => typeof id === 'string') && new Set(ids).size === ids.length;

// Presentation evidence only: no solver calls, state changes or inferred enjoyment.
// A proposal's reported coverage is deliberately recomputed from original ranks.
export function explainReplacement(data, request, proposal) {
  const result = proposal?.result ?? proposal;
  if (!Array.isArray(data?.films) || !Array.isArray(data?.profiles) || !data.profiles.length ||
      !request || ![2, 3].includes(request.slots) || !Number.isFinite(request.maximumRuntime) || request.maximumRuntime <= 0 ||
      !['current', 'locked', 'excluded'].every(key => uniqueIds(request[key])) || !request.current.length ||
      result?.status === 'hard_conflict' || !uniqueIds(result?.selection) || result.selection.length !== request.slots) return null;
  const films = new Map(data.films.map(film => [film.id, film]));
  if (films.size !== data.films.length || data.films.some(film => typeof film.id !== 'string' || typeof film.name !== 'string' ||
      !Number.isFinite(film.runtime) || film.runtime <= 0) || data.profiles.some(profile => typeof profile.id !== 'string' ||
      !profile.ranks || typeof profile.ranks !== 'object' || Array.isArray(profile.ranks)) ||
      new Set(data.profiles.map(profile => profile.id)).size !== data.profiles.length ||
      [...request.current, ...request.locked, ...request.excluded, ...result.selection].some(id => !films.has(id))) return null;
  const available = film => film.eligible === true && !request.excluded.includes(film.id) && film.runtime <= request.maximumRuntime;
  if (result.selection.some(id => !available(films.get(id))) || request.locked.some(id => !result.selection.includes(id))) return null;
  const addedIds = result.selection.filter(id => !request.current.includes(id));
  const removedIds = request.current.filter(id => !result.selection.includes(id));
  if (!addedIds.length || !removedIds.length) return null;

  const retained = request.current.filter(id => result.selection.includes(id));
  let nightOrder;
  if (result.nightOrder !== undefined) {
    if (!uniqueIds(result.nightOrder) || result.nightOrder.length !== result.selection.length ||
        result.nightOrder.some(id => !result.selection.includes(id))) return null;
    nightOrder = result.nightOrder;
  } else if (request.current.length === request.slots) {
    const additions = [...addedIds];
    nightOrder = request.current.map(id => result.selection.includes(id) ? id : additions.shift());
  } else nightOrder = [...retained, ...addedIds];

  const filmRow = id => ({ id, name: films.get(id).name, runtime: films.get(id).runtime,
    previousNight: request.current.indexOf(id) < 0 ? null : request.current.indexOf(id) + 1,
    night: nightOrder.indexOf(id) < 0 ? null : nightOrder.indexOf(id) + 1 });
  const added = addedIds.map(filmRow);
  const removed = removedIds.map(id => ({ ...filmRow(id), reason: request.excluded.includes(id) ? 'Marked unavailable' :
    films.get(id).eligible !== true ? 'Not eligible in the shortlist' : films.get(id).runtime > request.maximumRuntime ?
      `Exceeds the ${request.maximumRuntime}-minute limit` : 'Replaced in the proposal' }));
  const locks = request.locked.map(id => {
    const row = filmRow(id);
    return { ...row, sameNight: row.previousNight !== null && row.previousNight === row.night };
  });
  const referenceRows = data.profiles.map(profile => {
    const previousBestRank = bestRank(profile, request.current);
    const retainedBestRank = bestRank(profile, retained);
    const proposedBestRank = bestRank(profile, result.selection);
    const candidates = data.films.flatMap(film => {
      const rank = originalRank(profile, film.id);
      if (!supported(rank)) return [];
      const reasons = [];
      if (request.excluded.includes(film.id)) reasons.push({ code: 'excluded', label: 'Marked unavailable' });
      if (film.eligible !== true) reasons.push({ code: 'ineligible', label: 'Not eligible in the shortlist' });
      if (film.runtime > request.maximumRuntime) reasons.push({ code: 'over_runtime', label: `${film.runtime} min exceeds the ${request.maximumRuntime}-minute limit` });
      const status = reasons[0]?.code ?? (addedIds.includes(film.id) ? 'selected' : retained.includes(film.id) ? 'retained' : 'eligible');
      if (!reasons.length) reasons.push({ code: status, label: status === 'selected' ? `Proposed for Night ${nightOrder.indexOf(film.id) + 1}` :
        status === 'retained' ? `Kept on Night ${nightOrder.indexOf(film.id) + 1}` : `Available within the ${request.maximumRuntime}-minute limit` });
      return [{ ...filmRow(film.id), rank, status, available: available(film), reasons, reason: reasons.map(item => item.label).join('; ') }];
    }).sort((left, right) => left.rank - right.rank || left.id.localeCompare(right.id));
    const reference = profile.reference || profile.name || profile.id;
    const restoringFilms = added.filter(film => supported(originalRank(profile, film.id)));
    const regained = !supported(retainedBestRank) && supported(proposedBestRank);
    const eligibleSupportCandidateCount = candidates.filter(film => film.available).length;
    const onlyAvailableSupport = regained && eligibleSupportCandidateCount === 1;
    const change = supported(previousBestRank) ? 'restores' : 'adds';
    const summary = regained ? `${restoringFilms.map(film => film.name).join(' and ')} ${change} original top-five support for ${reference}.` : null;
    return { id: profile.id, reference, previousBestRank, retainedBestRank, proposedBestRank,
      regained, previouslySupported: supported(previousBestRank), supported: supported(proposedBestRank),
      restoringFilmIds: restoringFilms.map(film => film.id), candidates, eligibleSupportCandidateCount, onlyAvailableSupport,
      summary, candidateSummary: onlyAvailableSupport ?
        `This is the only available film with known original top-five support for ${reference} within this ${data.films.length}-film pool and ${request.maximumRuntime}-minute limit.` :
        `${eligibleSupportCandidateCount} original top-five film${eligibleSupportCandidateCount === 1 ? ' is' : 's are'} available for ${reference} within this pool and limit.`,
      hasUnknownEligibleFilms: data.films.some(film => available(film) && originalRank(profile, film.id) === null) };
  });
  const recovered = referenceRows.filter(profile => profile.regained);
  const unresolved = referenceRows.filter(profile => !profile.supported);
  const unknown = data.profiles.flatMap(profile => result.selection.filter(id => originalRank(profile, id) === null)
    .map(id => ({ profileId: profile.id, reference: profile.reference || profile.name || profile.id, filmId: id,
      filmName: films.get(id).name, reason: 'Original rank unknown; no support is inferred.' })));
  return {
    title: 'Why this replacement?', topK: TOP_K, maximumRuntime: request.maximumRuntime,
    summary: recovered.length ? recovered.map(profile => profile.summary).join(' ') :
      `${added.map(film => film.name).join(' and ')} replaces ${removed.map(film => film.name).join(' and ')} within the ${request.maximumRuntime}-minute limit.`,
    added, removed, locks, recovered, unresolved, unknown,
    supportedReferenceCount: referenceRows.filter(profile => profile.supported).length,
    referenceCount: data.profiles.length,
    policy: 'Support means a selected film is in a reference’s original top five within this shortlist. It is not an enjoyment prediction; missing ranks remain unknown.',
  };
}
