/** Compare the numeric parts of two dotted version strings. */
export function compareVersions(left = "0.0.0", right = "0.0.0") {
  const a = String(left).split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const b = String(right).split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

export function pendingMigrationVersions(last, current, versions) {
  return versions.filter((version) =>
    compareVersions(version, last || "0.0.0") > 0 && compareVersions(version, current) <= 0
  );
}
