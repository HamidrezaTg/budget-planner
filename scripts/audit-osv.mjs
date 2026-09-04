import fs from 'node:fs/promises';
import path from 'node:path';

const lockfilePath = path.resolve(process.cwd(), 'package-lock.json');
const lockfile = JSON.parse(await fs.readFile(lockfilePath, 'utf8'));
const packages = Object.entries(lockfile.packages ?? {})
  .filter(
    ([packagePath, details]) =>
      packagePath.startsWith('node_modules/') && details.version && !details.dev,
  )
  .map(([packagePath, details]) => {
    const namePart = packagePath.split('node_modules/').at(-1);
    const nameParts = namePart.split('/');
    const name =
      details.name ?? (namePart.startsWith('@') ? nameParts.slice(0, 2).join('/') : nameParts[0]);
    return { name, version: details.version };
  });

const uniquePackages = [
  ...new Map(packages.map((pkg) => [`${pkg.name}@${pkg.version}`, pkg])).values(),
];
const response = await fetch('https://api.osv.dev/v1/querybatch', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    queries: uniquePackages.map((pkg) => ({
      package: { name: pkg.name, ecosystem: 'npm' },
      version: pkg.version,
    })),
  }),
});

if (!response.ok) {
  throw new Error(`OSV query failed with HTTP ${response.status}`);
}

const { results = [] } = await response.json();
const vulnerabilityIds = [
  ...new Set(results.flatMap((result) => (result.vulns ?? []).map((vuln) => vuln.id))),
];
const vulnerabilities = await Promise.all(
  vulnerabilityIds.map(async (id) => {
    const vulnerabilityResponse = await fetch(
      `https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`,
    );
    if (!vulnerabilityResponse.ok) {
      throw new Error(
        `OSV vulnerability lookup failed for ${id} with HTTP ${vulnerabilityResponse.status}`,
      );
    }
    return vulnerabilityResponse.json();
  }),
);

const highSeverity = vulnerabilities.filter((vulnerability) => {
  const severity = vulnerability.database_specific?.severity?.toUpperCase();
  return !severity || severity === 'HIGH' || severity === 'CRITICAL';
});

for (const vulnerability of highSeverity) {
  console.error(
    `${vulnerability.database_specific?.severity ?? 'UNKNOWN'} ${vulnerability.id}: ${vulnerability.summary}`,
  );
}

if (highSeverity.length > 0) {
  process.exitCode = 1;
} else {
  console.log(
    `OSV found no high or critical vulnerabilities in ${uniquePackages.length} production packages.`,
  );
}
