export class ProcessIdentitySnapshotError extends Error {
  constructor(message, diagnostics) {
    super(message);
    this.name = "ProcessIdentitySnapshotError";
    this.diagnostics = diagnostics;
  }
}

export function reconcileOwnedWorkerProcessSnapshots({
  first,
  second,
  workerPath,
  desktopPid,
  readyPid = null,
  normalizePath,
  firstCapturedAtUtc = null,
  secondCapturedAtUtc = null,
  allowNoWorkers = false,
}) {
  const diagnostics = {
    schemaVersion: 1,
    firstCapturedAtUtc,
    secondCapturedAtUtc,
    firstProcessCount: first.length,
    secondProcessCount: second.length,
    workerRootPids: [],
    firstWorkerRootPids: [],
    secondWorkerRootPids: [],
    weakFirstDescendantsExited: [],
    weakFirstDescendantsResolved: [],
    strongFirstDescendantsRetained: [],
    strongSecondDescendantsAdded: [],
    incompleteSecondRowsCoveredByFirstIdentity: [],
  };
  const fail = (message, details = null) => {
    throw new ProcessIdentitySnapshotError(message, { ...diagnostics, failure: details ?? message });
  };
  const firstByPid = uniqueProcessMap(first, "first", fail);
  const secondByPid = uniqueProcessMap(second, "second", fail);
  const expectedPath = normalizePath(workerPath);
  const strong = (entry) => Boolean(
    entry
    && Number.isInteger(entry.pid)
    && Number.isInteger(entry.parentPid)
    && typeof entry.creationDate === "string"
    && entry.creationDate.length > 0
    && typeof entry.executablePath === "string"
    && entry.executablePath.length > 0
  );
  const sameIdentity = (left, right) => strong(left)
    && strong(right)
    && left.pid === right.pid
    && left.creationDate === right.creationDate
    && normalizePath(left.executablePath) === normalizePath(right.executablePath);
  const hasAncestor = (entry, ancestorPids, byPid) => {
    const seen = new Set();
    let current = entry;
    while (current && !seen.has(current.pid)) {
      if (ancestorPids.has(current.pid) || ancestorPids.has(current.parentPid)) return true;
      seen.add(current.pid);
      current = byPid.get(current.parentPid);
    }
    return false;
  };

  if (readyPid !== null) {
    const ready = firstByPid.get(readyPid);
    if (!strong(ready) || normalizePath(ready.executablePath) !== expectedPath) {
      fail(`Ready worker ${readyPid} has no strong executable-path and creation-time identity`, {
        phase: "first-ready",
        pid: readyPid,
        observed: summarize(ready),
      });
    }
  }

  const desktopAncestors = new Set([desktopPid]);
  const firstDesktopWorkers = first.filter((entry) => (
    normalizePath(entry.executablePath) === expectedPath
    && hasAncestor(entry, desktopAncestors, firstByPid)
  ));
  const secondDesktopWorkers = second.filter((entry) => (
    normalizePath(entry.executablePath) === expectedPath
    && hasAncestor(entry, desktopAncestors, secondByPid)
  ));
  const firstDesktopWorkerPids = new Set(firstDesktopWorkers.map((entry) => entry.pid));
  const secondDesktopWorkerPids = new Set(secondDesktopWorkers.map((entry) => entry.pid));
  const firstRoots = firstDesktopWorkers.filter((entry) => !firstDesktopWorkerPids.has(entry.parentPid));
  const secondRoots = secondDesktopWorkers.filter((entry) => !secondDesktopWorkerPids.has(entry.parentPid));
  diagnostics.firstWorkerRootPids = firstRoots.map((entry) => entry.pid).sort((left, right) => left - right);
  diagnostics.secondWorkerRootPids = secondRoots.map((entry) => entry.pid).sort((left, right) => left - right);
  if (readyPid !== null && firstRoots.length === 0) {
    fail("No identity-bound desktop worker root was present in the first process snapshot", {
      phase: "first-roots",
      desktopPid,
      readyPid,
    });
  }
  const roots = [...firstRoots, ...secondRoots];
  if (roots.length === 0 && allowNoWorkers) {
    return { processTree: [], diagnostics };
  }
  if (roots.length === 0) {
    fail("No identity-bound desktop worker root was present in either process snapshot", {
      phase: "worker-roots",
      desktopPid,
      readyPid,
    });
  }
  for (const root of roots) {
    if (!strong(root)) {
      fail(`Desktop worker root ${root.pid} has no strong executable-path and creation-time identity`, {
        phase: "worker-roots",
        observed: summarize(root),
      });
    }
  }
  const rootPids = new Set(roots.map((entry) => entry.pid));
  diagnostics.workerRootPids = [...rootPids].sort((left, right) => left - right);

  const firstOwned = first.filter((entry) => hasAncestor(entry, rootPids, firstByPid));
  if (readyPid !== null && !firstOwned.some((entry) => entry.pid === readyPid)) {
    fail(`Ready worker ${readyPid} is not a descendant of an identity-bound desktop worker root`, {
      phase: "first-ancestry",
      readyPid,
      workerRootPids: diagnostics.workerRootPids,
    });
  }

  const firstStrong = new Map();
  const firstWeak = [];
  for (const entry of firstOwned) {
    if (strong(entry)) firstStrong.set(entry.pid, entry);
    else firstWeak.push(entry);
  }

  // Known descendants are included as ancestry anchors for children created
  // between snapshots, even when their original worker root exits meanwhile.
  const secondAnchors = new Set([...rootPids, ...firstStrong.keys()]);
  const secondOwned = second.filter((entry) => hasAncestor(entry, secondAnchors, secondByPid));
  const secondOwnedPids = new Set(secondOwned.map((entry) => entry.pid));
  const reconciled = new Map();

  for (const entry of firstStrong.values()) {
    const current = secondByPid.get(entry.pid);
    if (current && strong(current) && !sameIdentity(entry, current)) {
      fail(`Owned PID ${entry.pid} changed strong process identity between snapshots`, {
        phase: "strong-identity-conflict",
        first: summarize(entry),
        second: summarize(current),
      });
    }
    reconciled.set(entry.pid, entry);
    diagnostics.strongFirstDescendantsRetained.push(entry.pid);
    if (current && !strong(current)) {
      const conflict = partialIdentityConflict(entry, current, normalizePath);
      if (conflict) {
        fail(`Owned PID ${entry.pid} had conflicting partial identity data in the second snapshot`, {
          phase: "strong-first-partial-conflict",
          conflict,
          first: summarize(entry),
          second: summarize(current),
        });
      }
      diagnostics.incompleteSecondRowsCoveredByFirstIdentity.push({
        pid: entry.pid,
        parentPid: current.parentPid,
        missing: missingIdentityFields(current),
      });
    }
  }

  for (const entry of firstWeak) {
    const current = secondByPid.get(entry.pid);
    if (!current) {
      diagnostics.weakFirstDescendantsExited.push({
        pid: entry.pid,
        parentPid: entry.parentPid,
        missing: missingIdentityFields(entry),
      });
      continue;
    }
    if (!secondOwnedPids.has(entry.pid)) {
      fail(`Weak owned PID ${entry.pid} was still present but no longer had verified worker ancestry`, {
        phase: "weak-first-ancestry",
        first: summarize(entry),
        second: summarize(current),
      });
    }
    if (!strong(current)) {
      fail(`Owned worker descendant ${entry.pid} remained without a strong executable-path and creation-time identity in the second snapshot`, {
        phase: "weak-first-unresolved",
        first: summarize(entry),
        second: summarize(current),
        missing: missingIdentityFields(current),
      });
    }
    const conflict = partialIdentityConflict(entry, current, normalizePath);
    if (conflict) {
      fail(`Weak owned PID ${entry.pid} conflicted with the strong identity in the second snapshot`, {
        phase: "weak-first-partial-conflict",
        conflict,
        first: summarize(entry),
        second: summarize(current),
      });
    }
    reconciled.set(current.pid, current);
    diagnostics.weakFirstDescendantsResolved.push({
      pid: current.pid,
      parentPid: current.parentPid,
      missingInFirst: missingIdentityFields(entry),
    });
  }

  for (const entry of secondOwned) {
    if (reconciled.has(entry.pid)) continue;
    if (!strong(entry)) {
      fail(`New owned worker descendant ${entry.pid} lacked a strong executable-path and creation-time identity in the second snapshot`, {
        phase: "new-second-incomplete",
        second: summarize(entry),
        missing: missingIdentityFields(entry),
      });
    }
    reconciled.set(entry.pid, entry);
    diagnostics.strongSecondDescendantsAdded.push(entry.pid);
  }

  return {
    processTree: [...reconciled.values()]
      .map((entry) => ({
        pid: entry.pid,
        parentPid: entry.parentPid,
        creationDate: entry.creationDate,
        executablePath: entry.executablePath,
      }))
      .sort((left, right) => left.pid - right.pid),
    diagnostics,
  };
}

function partialIdentityConflict(first, second, normalizePath) {
  if (typeof first?.creationDate === "string" && first.creationDate
    && typeof second?.creationDate === "string" && second.creationDate
    && first.creationDate !== second.creationDate) {
    return "creationDate";
  }
  if (typeof first?.executablePath === "string" && first.executablePath
    && typeof second?.executablePath === "string" && second.executablePath
    && normalizePath(first.executablePath) !== normalizePath(second.executablePath)) {
    return "executablePath";
  }
  return null;
}

function uniqueProcessMap(entries, label, fail) {
  const result = new Map();
  for (const entry of entries) {
    if (!Number.isInteger(entry?.pid) || !Number.isInteger(entry?.parentPid)) {
      fail(`${label} process snapshot contained an invalid PID or parent PID`, {
        phase: `${label}-shape`,
        observed: summarize(entry),
      });
    }
    if (result.has(entry.pid)) {
      fail(`${label} process snapshot contained duplicate PID ${entry.pid}`, {
        phase: `${label}-duplicate-pid`,
        pid: entry.pid,
      });
    }
    result.set(entry.pid, entry);
  }
  return result;
}

function missingIdentityFields(entry) {
  const missing = [];
  if (typeof entry?.creationDate !== "string" || !entry.creationDate) missing.push("creationDate");
  if (typeof entry?.executablePath !== "string" || !entry.executablePath) missing.push("executablePath");
  return missing;
}

function summarize(entry) {
  if (!entry) return null;
  return {
    pid: entry.pid ?? null,
    parentPid: entry.parentPid ?? null,
    creationDate: entry.creationDate ?? null,
    executablePath: entry.executablePath ?? null,
  };
}
