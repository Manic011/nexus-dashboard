import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Check only versioned release inputs. Operator data and deployment workspaces
// must remain outside Git and outside the release packaging allowlist.
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const problems = [];
const patterns = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{24,}\b/],
  ['personal Windows path', /[A-Z]:[\\/]Users[\\/](?!Public\b|USERNAME\b)[^\s<>"'`\\/]+/i],
  ['personal Unix home path', /\/home\/(?!USER\b|USERNAME\b)[a-z_][a-z0-9_-]*\//i],
];
for (const file of files) {
  if (/(?:^|\/)(?:\.env(?:\..*)?|[^/]+\.(?:sqlite(?:-wal|-shm)?|pem|key|log)|id_(?:rsa|ed25519))$/.test(file)) {
    problems.push(file + ': private state or credential filename');
  }
  const bytes = readFileSync(file);
  if (bytes.includes(0)) continue;
  const text = bytes.toString('utf8');
  for (const [label, pattern] of patterns) if (pattern.test(text)) problems.push(file + ': ' + label);
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exitCode = 1;
} else console.log('Release-input privacy checks passed. Review Git history and packaged artifacts separately.');
