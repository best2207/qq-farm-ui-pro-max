#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const files = [
  'logs/development/Update.log',
  'CHANGELOG.md',
  'CHANGELOG.DEVELOPMENT.md',
];

let errorCount = 0;
let warnCount = 0;
const fileContents = {};

function print(level, file, message) {
  const tag = level === 'error' ? 'ERROR' : 'WARN';
  console.log(`[${tag}] ${file}: ${message}`);
}

function checkNulBytes(file, content) {
  if (content.includes('\u0000')) {
    errorCount += 1;
    print('error', file, 'contains NUL bytes');
  }
}

function checkUpdateLog(file, content) {
  const lines = content.split(/\r?\n/);

  const headers = [];
  for (const line of lines) {
    if (/^\d{4}-\d{2}-\d{2}\s+/.test(line)) headers.push(line);
  }

  const headerCount = new Map();
  for (const header of headers) {
    headerCount.set(header, (headerCount.get(header) || 0) + 1);
  }
  for (const [header, count] of headerCount.entries()) {
    if (count > 1) {
      errorCount += 1;
      print('error', file, `duplicate title "${header}" (${count} times)`);
    }
  }

  lines.forEach((line, idx) => {
    const lineNo = idx + 1;
    if (/^\s*-\S/.test(line)) {
      errorCount += 1;
      print('error', file, `malformed bullet at line ${lineNo}: "${line}"`);
    }
    if (/^##\s+\[\d{4}-\d{2}-\d{2}\]/.test(line)) {
      errorCount += 1;
      print('error', file, `markdown date title style is not allowed at line ${lineNo}`);
    }
  });

  const longBullets = lines.filter((line) => /^\s*-\s/.test(line) && line.length > 120).length;
  if (longBullets > 0) {
    warnCount += 1;
    print('warn', file, `${longBullets} bullet lines are longer than 120 chars`);
  }
}

function parseChangelogQuickIndex(content) {
  const quickIndexMatch = content.match(/## 快速索引（精简版）([\s\S]*?)(?:\n> 说明|\n## )/);
  const quickIndexBlock = quickIndexMatch?.[1] || '';

  return quickIndexBlock
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^- `([^`]+) \((\d{4}-\d{2}-\d{2})\)` /);
      if (!match) return null;
      return {
        version: match[1],
        date: match[2],
      };
    })
    .filter(Boolean);
}

function parseUpdateLogEntries(content) {
  const lines = content.split(/\r?\n/);
  const entries = [];
  const dateRe = /^(\d{4}-\d{2}-\d{2})(?:\s+|$)/;
  const versionRe = /前端[：:]\s*(v[\d.]+)/;
  let current = null;

  const pushCurrent = () => {
    if (!current) return;
    const blockText = [current.header, ...current.contentLines].join('\n');
    const versionMatch = blockText.match(versionRe);
    if (versionMatch) {
      entries.push({
        date: current.date,
        version: versionMatch[1],
      });
    }
    current = null;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const dateMatch = trimmed.match(dateRe);
    if (dateMatch) {
      pushCurrent();
      current = {
        date: dateMatch[1],
        header: trimmed,
        contentLines: [],
      };
      continue;
    }
    if (current) {
      current.contentLines.push(line);
    }
  }

  pushCurrent();
  return entries;
}

function checkAnnouncementConsistency() {
  const changelog = fileContents['CHANGELOG.md'];
  const updateLog = fileContents['logs/development/Update.log'];

  if (!changelog || !updateLog) {
    return;
  }

  const changelogEntries = parseChangelogQuickIndex(changelog);
  const updateLogEntries = parseUpdateLogEntries(updateLog);

  if (changelogEntries.length === 0 || updateLogEntries.length === 0) {
    warnCount += 1;
    print('warn', 'announcement-consistency', 'unable to parse latest entries from CHANGELOG.md or Update.log');
    return;
  }

  const latestChangelog = changelogEntries[0];
  const latestUpdateLog = updateLogEntries[0];

  if (latestChangelog.version !== latestUpdateLog.version || latestChangelog.date !== latestUpdateLog.date) {
    errorCount += 1;
    print(
      'error',
      'announcement-consistency',
      `latest entry mismatch: CHANGELOG.md has ${latestChangelog.version} (${latestChangelog.date}), Update.log has ${latestUpdateLog.version} (${latestUpdateLog.date})`,
    );
  }

  const updateLogVersionMap = new Map(updateLogEntries.map(entry => [entry.version, entry.date]));
  for (const entry of changelogEntries) {
    if (!updateLogVersionMap.has(entry.version)) {
      errorCount += 1;
      print('error', 'announcement-consistency', `${entry.version} exists in CHANGELOG.md quick index but is missing from Update.log`);
      continue;
    }
    const updateDate = updateLogVersionMap.get(entry.version);
    if (updateDate !== entry.date) {
      errorCount += 1;
      print(
        'error',
        'announcement-consistency',
        `${entry.version} date mismatch: CHANGELOG.md uses ${entry.date}, Update.log uses ${updateDate}`,
      );
    }
  }
}

function main() {
  for (const relPath of files) {
    const fullPath = path.join(root, relPath);
    if (!fs.existsSync(fullPath)) {
      warnCount += 1;
      print('warn', relPath, 'file not found, skipped');
      continue;
    }

    const content = fs.readFileSync(fullPath, 'utf8');
    fileContents[relPath] = content;
    checkNulBytes(relPath, content);
    if (relPath === 'logs/development/Update.log') {
      checkUpdateLog(relPath, content);
    }
  }

  checkAnnouncementConsistency();

  console.log(`\nAnnouncement check finished: ${errorCount} error(s), ${warnCount} warning(s).`);
  process.exitCode = errorCount > 0 ? 1 : 0;
}

main();
