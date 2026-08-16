function parseVersion(value) {
  const normalized = String(value ?? "0.0.0").trim().replace(/^v/i, "");
  const withoutBuild = normalized.split("+", 1)[0];
  const separator = withoutBuild.indexOf("-");
  const coreText = separator === -1 ? withoutBuild : withoutBuild.slice(0, separator);
  const prereleaseText = separator === -1 ? "" : withoutBuild.slice(separator + 1);
  return {
    core: coreText.split(".").map((part) =>
      /^\d+$/.test(part) ? Number.parseInt(part, 10) : 0
    ),
    prerelease: prereleaseText ? prereleaseText.split(".") : null
  };
}

function comparePrerelease(left, right) {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;

  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    if (a === b) continue;

    const aNumeric = /^\d+$/.test(a);
    const bNumeric = /^\d+$/.test(b);
    if (aNumeric && bNumeric) return Math.sign(Number(a) - Number(b));
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return a < b ? -1 : 1;
  }
  return 0;
}

/** Compare semantic versions, including prerelease precedence. */
export function compareVersions(left = "0.0.0", right = "0.0.0") {
  const a = parseVersion(left);
  const b = parseVersion(right);
  const length = Math.max(a.core.length, b.core.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (a.core[index] ?? 0) - (b.core[index] ?? 0);
    if (difference) return Math.sign(difference);
  }
  return comparePrerelease(a.prerelease, b.prerelease);
}

export function pendingMigrationVersions(last, current, versions) {
  return versions.filter((version) =>
    compareVersions(version, last || "0.0.0") > 0 && compareVersions(version, current) <= 0
  );
}
