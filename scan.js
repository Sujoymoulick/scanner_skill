#!/usr/bin/env node
/**
 * Codebase & File Scanner Skill (Unified Version)
 * 
 * Designed to dynamically detect the requested operation:
 * 1. If Git URL is provided: Clones the repository, isolates setup guidelines,
 *    maps technology tags, filters landing pages, and boots a dynamic local dashboard on Port 3000.
 * 2. If a local directory path is provided: Generates a visual ASCII tree, dynamically
 *    maps routing/styling tokens/dependencies, and compiles a rich scanner-skill.md blueprint.
 * 3. If a local file path is provided: Lexically parses imports/exports/classes/functions,
 *    and calculates line statistics.
 * 
 * Usage:
 *   node scan.js [path-to-file-or-dir | github-repo-url]
 */

import fs from 'fs';
import path from 'path';
import http from 'http';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Exclude specific landing assets from cloner tree & stats to isolate source code
const SPECIFIC_EXCLUDES = new Set(['index.html', 'style.css', 'styles.css']);

// Directory and extension ignore lists
const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.vscode',
  '.gemini',
  '.DS_Store',
  'Socallogos',
  'assets',
  'public',
  'coverage',
  '.next',
  '.nuxt',
  '__pycache__',
  '.pytest_cache',
  '.cargo',
  'target',
  'out',
  'scanner_skill',
  'cloned-repos'
]);

const IGNORE_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.webp', '.mp4', '.webm',
  '.woff', '.woff2', '.eot', '.ttf', '.pdf', '.zip', '.tar', '.gz', '.db', '.sqlite',
  '.map', '.d.ts'
]);

// Language extension mapping
const LANG_MAP = {
  '.js': 'JavaScript',
  '.jsx': 'React JavaScript',
  '.ts': 'TypeScript',
  '.tsx': 'React TypeScript',
  '.py': 'Python',
  '.go': 'Go',
  '.rs': 'Rust',
  '.rb': 'Ruby',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.cpp': 'C++',
  '.c': 'C',
  '.h': 'C/C++ Header',
  '.cs': 'C#',
  '.swift': 'Swift',
  '.php': 'PHP',
  '.sh': 'Shell Script',
  '.bash': 'Shell Script',
  '.css': 'CSS',
  '.scss': 'SCSS',
  '.sass': 'Sass',
  '.less': 'Less',
  '.html': 'HTML',
  '.md': 'Markdown',
  '.json': 'JSON',
  '.yml': 'YAML',
  '.yaml': 'YAML',
  '.toml': 'TOML',
  '.xml': 'XML',
  '.gradle': 'Gradle Build'
};

// Route Detection Patterns
const ROUTE_DETECTION_PATTERNS = [
  { regex: /(?:app|router|route)\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/i, getDetails: m => ({ type: 'Backend API', method: m[1].toUpperCase(), route: m[2] }) },
  { regex: /@(?:[a-zA-Z0-9_]*app|[a-zA-Z0-9_]*router)\.(get|post|put|delete|patch|route)\s*\(\s*['"]([^'"]+)['"]/i, getDetails: m => ({ type: 'Backend API', method: m[1] === 'route' ? 'ANY' : m[1].toUpperCase(), route: m[2] }) },
  { regex: /path\s*\(\s*['"]([^'"]+)['"]/i, getDetails: m => ({ type: 'Backend API', method: 'ANY', route: m[1] }) },
  { regex: /(?:router|r|http)\.(GET|POST|PUT|DELETE|PATCH|HandleFunc)\s*\(\s*['"]([^'"]+)['"]/i, getDetails: m => ({ type: 'Backend API', method: m[1] === 'HandleFunc' ? 'ANY' : m[1].toUpperCase(), route: m[2] }) },
  { regex: /<Route\s+[^>]*path=["']([^"']+)["'][^>]*element=\{<([^ />]+)/i, getDetails: m => ({ type: 'Frontend View', method: 'VIEW', route: m[1], component: m[2] }) },
  { regex: /<Route\s+[^>]*element=\{<([^ />]+)[^>]*path=["']([^"']+)["']/i, getDetails: m => ({ type: 'Frontend View', method: 'VIEW', route: m[2], component: m[1] }) }
];

/**
 * Format bytes to human readable format
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * Parses Python requirements.txt
 */
function parseRequirementsTxt(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const dependencies = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-')) continue;
    const match = trimmed.match(/^([a-zA-Z0-9_.-]+)(?:[>=<~!]+([a-zA-Z0-9_.-]+))?/);
    if (match) {
      dependencies[match[1]] = match[2] || 'any';
    }
  }
  return { name: 'Python Requirements', dependencies };
}

/**
 * Parses Rust Cargo.toml
 */
function parseCargoToml(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  let inDependencies = false;
  const dependencies = {};
  let name = 'Rust Cargo';
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[package]')) {
      inDependencies = false;
    } else if (trimmed.startsWith('[dependencies]')) {
      inDependencies = true;
    } else if (trimmed.startsWith('[')) {
      inDependencies = false;
    } else if (inDependencies) {
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const depName = trimmed.slice(0, eqIdx).trim();
        const depVal = trimmed.slice(eqIdx + 1).trim();
        dependencies[depName] = depVal.replace(/^"|"$/g, '');
      }
    } else if (trimmed.startsWith('name =')) {
      name = trimmed.slice(trimmed.indexOf('=') + 1).trim().replace(/^"|"$/g, '');
    }
  }
  return { name, dependencies };
}

/**
 * Parses Go go.mod
 */
function parseGoMod(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const dependencies = {};
  let moduleName = 'Go Module';
  let inRequire = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('module ')) {
      moduleName = trimmed.slice(7).trim();
    } else if (trimmed.startsWith('require (')) {
      inRequire = true;
    } else if (trimmed.startsWith(')')) {
      inRequire = false;
    } else if (trimmed.startsWith('require ')) {
      const parts = trimmed.slice(8).trim().split(/\s+/);
      if (parts.length >= 2) {
        dependencies[parts[0]] = parts[1];
      }
    } else if (inRequire) {
      if (!trimmed || trimmed.startsWith('//')) continue;
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 2) {
        dependencies[parts[0]] = parts[1];
      }
    }
  }
  return { name: moduleName, dependencies };
}

/**
 * Parses Ruby Gemfile
 */
function parseGemfile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const dependencies = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('gem ')) {
      const parts = trimmed.slice(4).split(',');
      const gemName = parts[0].trim().replace(/^['"]|['"]$/g, '');
      const gemVer = parts[1] ? parts[1].trim().replace(/^['"]|['"]$/g, '') : 'any';
      dependencies[gemName] = gemVer;
    }
  }
  return { name: 'Ruby Gemfile', dependencies };
}

/**
 * Parses Gradle build.gradle
 */
function parseBuildGradle(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const dependencies = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('implementation ') || trimmed.startsWith('compile ') || trimmed.startsWith('api ')) {
      const match = trimmed.match(/(?:implementation|compile|api)\s+['"]([^'"]+)['"]/);
      if (match) {
        const parts = match[1].split(':');
        if (parts.length >= 2) {
          dependencies[parts[0] + ':' + parts[1]] = parts[2] || 'latest';
        } else {
          dependencies[match[1]] = 'latest';
        }
      }
    }
  }
  return { name: 'Gradle Project', dependencies };
}

/**
 * Parses Maven pom.xml
 */
function parsePomXml(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const dependencies = {};
  const depRegex = /<dependency>([\s\S]*?)<\/dependency>/g;
  let match;
  while ((match = depRegex.exec(content)) !== null) {
    const depContent = match[1];
    const groupIdMatch = depContent.match(/<groupId>([^<]+)<\/groupId>/);
    const artifactIdMatch = depContent.match(/<artifactId>([^<]+)<\/artifactId>/);
    const versionMatch = depContent.match(/<version>([^<]+)<\/version>/);
    if (groupIdMatch && artifactIdMatch) {
      dependencies[groupIdMatch[1].trim() + ':' + artifactIdMatch[1].trim()] = versionMatch ? versionMatch[1].trim() : 'latest';
    }
  }
  return { name: 'Maven Project', dependencies };
}

/**
 * Recursively scans a directory to build tree and file list
 */
function scanDirectory(dir, baseDir = dir, isDashboard = false) {
  const tree = [];
  const filesList = [];
  
  let items;
  try {
    items = fs.readdirSync(dir);
  } catch (err) {
    return { tree, filesList };
  }

  items.sort((a, b) => {
    const aPath = path.join(dir, a);
    const bPath = path.join(dir, b);
    let aIsDir = false;
    let bIsDir = false;
    try { aIsDir = fs.statSync(aPath).isDirectory(); } catch(e){}
    try { bIsDir = fs.statSync(bPath).isDirectory(); } catch(e){}
    
    if (aIsDir && !bIsDir) return -1;
    if (!aIsDir && bIsDir) return 1;
    return a.localeCompare(b);
  });

  for (const item of items) {
    if (IGNORE_DIRS.has(item)) continue;
    if (isDashboard && SPECIFIC_EXCLUDES.has(item.toLowerCase())) continue;
    
    const fullPath = path.join(dir, item);
    const relItemPath = path.relative(baseDir, fullPath);
    
    let stats;
    try {
      stats = fs.statSync(fullPath);
    } catch (err) {
      continue;
    }

    if (stats.isDirectory()) {
      const { tree: subTree, filesList: subFiles } = scanDirectory(fullPath, baseDir, isDashboard);
      tree.push({
        name: item,
        type: 'directory',
        path: relItemPath,
        children: subTree
      });
      filesList.push(...subFiles);
    } else {
      const ext = path.extname(item).toLowerCase();
      if (IGNORE_EXTS.has(ext)) continue;

      tree.push({
        name: item,
        type: 'file',
        path: relItemPath,
        size: stats.size
      });
      
      filesList.push({
        name: item,
        path: relItemPath,
        size: stats.size
      });
    }
  }

  return { tree, filesList };
}

/**
 * Format tree list as a Markdown string using Unicode box-drawing characters
 */
function formatTreeMarkdown(nodes, prefix = '') {
  let md = '';
  nodes.forEach((node, index) => {
    const isLast = index === nodes.length - 1;
    const marker = isLast ? '└── ' : '├── ';
    
    if (node.type === 'directory') {
      md += `${prefix}${marker}📂 ${node.name}/\n`;
      const nextPrefix = prefix + (isLast ? '    ' : '│   ');
      md += formatTreeMarkdown(node.children, nextPrefix);
    } else {
      md += `${prefix}${marker}📄 ${node.name} (${formatBytes(node.size)})\n`;
    }
  });
  return md;
}

/**
 * Extract dependencies from active manifest files anywhere in the workspace
 */
function extractDependencies(filesList, baseDir) {
  const allManifests = [];
  
  filesList.forEach(file => {
    const fullPath = path.join(baseDir, file.path);
    const name = path.basename(file.path);
    
    if (name === 'package.json') {
      try {
        const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
        allManifests.push({
          type: 'Node/JS/TS',
          path: file.path,
          name: parsed.name || 'Root Project',
          dependencies: parsed.dependencies || {},
          devDependencies: parsed.devDependencies || {}
        });
      } catch (e) {}
    } else if (name === 'requirements.txt') {
      try {
        const parsed = parseRequirementsTxt(fullPath);
        allManifests.push({
          type: 'Python Requirements',
          path: file.path,
          name: parsed.name,
          dependencies: parsed.dependencies,
          devDependencies: {}
        });
      } catch (e) {}
    } else if (name === 'Cargo.toml') {
      try {
        const parsed = parseCargoToml(fullPath);
        allManifests.push({
          type: 'Rust Cargo',
          path: file.path,
          name: parsed.name,
          dependencies: parsed.dependencies,
          devDependencies: {}
        });
      } catch (e) {}
    } else if (name === 'go.mod') {
      try {
        const parsed = parseGoMod(fullPath);
        allManifests.push({
          type: 'Go Modules',
          path: file.path,
          name: parsed.name,
          dependencies: parsed.dependencies,
          devDependencies: {}
        });
      } catch (e) {}
    } else if (name === 'Gemfile') {
      try {
        const parsed = parseGemfile(fullPath);
        allManifests.push({
          type: 'Ruby Gems',
          path: file.path,
          name: parsed.name,
          dependencies: parsed.dependencies,
          devDependencies: {}
        });
      } catch (e) {}
    } else if (name === 'build.gradle') {
      try {
        const parsed = parseBuildGradle(fullPath);
        allManifests.push({
          type: 'Gradle (Java/Kotlin)',
          path: file.path,
          name: parsed.name,
          dependencies: parsed.dependencies,
          devDependencies: {}
        });
      } catch (e) {}
    } else if (name === 'pom.xml') {
      try {
        const parsed = parsePomXml(fullPath);
        allManifests.push({
          type: 'Maven (Java/XML)',
          path: file.path,
          name: parsed.name,
          dependencies: parsed.dependencies,
          devDependencies: {}
        });
      } catch (e) {}
    }
  });

  return allManifests;
}

/**
 * Scan all text source files for API routes, custom properties, and file stats
 */
function scanDirectoryMetadata(filesList, baseDir) {
  const routes = [];
  const cssVariables = [];
  const stats = {
    totalFiles: filesList.length,
    totalSizeBytes: 0,
    extBreakdown: {},
    largestFiles: []
  };

  filesList.forEach(file => {
    const fullPath = path.join(baseDir, file.path);
    const ext = path.extname(file.name).toLowerCase();
    
    stats.totalSizeBytes += file.size;
    
    if (!stats.extBreakdown[ext]) {
      stats.extBreakdown[ext] = { count: 0, size: 0, lines: 0 };
    }
    stats.extBreakdown[ext].count++;
    stats.extBreakdown[ext].size += file.size;
    
    if (ext && !IGNORE_EXTS.has(ext)) {
      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        const lines = content.split(/\r?\n/);
        stats.extBreakdown[ext].lines += lines.length;

        lines.forEach((line, index) => {
          // Route Scanner
          ROUTE_DETECTION_PATTERNS.forEach(pat => {
            const m = line.match(pat.regex);
            if (m) {
              const details = pat.getDetails(m);
              routes.push({
                file: file.path,
                line: index + 1,
                ...details
              });
            }
          });

          // CSS Variable Scanner
          if (['.css', '.scss', '.sass', '.less'].includes(ext)) {
            const varMatch = line.match(/^\s*--([a-zA-Z0-9_-]+)\s*:\s*([^;}\n]+)/);
            if (varMatch) {
              cssVariables.push({
                file: file.path,
                line: index + 1,
                name: `--${varMatch[1]}`,
                value: varMatch[2].trim()
              });
            }
          }
        });
      } catch (e) {
        // Skip binary or read errors
      }
    }
  });

  stats.largestFiles = [...filesList]
    .sort((a, b) => b.size - a.size)
    .slice(0, 5);

  return { routes, cssVariables, stats };
}

/**
 * Performs high-density parsing on a single source file
 */
function scanSingleFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const ext = path.extname(filePath).toLowerCase();
  const lang = LANG_MAP[ext] || 'Unknown';
  
  let totalLines = lines.length;
  let emptyLines = 0;
  let commentLines = 0;
  let codeLines = 0;
  let inBlockComment = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') {
      emptyLines++;
      continue;
    }
    
    if (['.js', '.jsx', '.ts', '.tsx', '.java', '.kt', '.cpp', '.c', '.h', '.cs', '.swift', '.php', '.go', '.rs'].includes(ext)) {
      if (inBlockComment) {
        commentLines++;
        if (line.includes('*/')) inBlockComment = false;
        continue;
      }
      if (line.startsWith('/*')) {
        commentLines++;
        if (!line.includes('*/')) inBlockComment = true;
        continue;
      }
      if (line.startsWith('//')) {
        commentLines++;
        continue;
      }
    } else if (ext === '.py') {
      if (inBlockComment) {
        commentLines++;
        if (line.includes("'''") || line.includes('"""')) inBlockComment = false;
        continue;
      }
      if (line.startsWith("'''") || line.startsWith('"""')) {
        commentLines++;
        const quoteType = line.startsWith("'''") ? "'''" : '"""';
        if (line.indexOf(quoteType, 3) === -1) inBlockComment = true;
        continue;
      }
      if (line.startsWith('#')) {
        commentLines++;
        continue;
      }
    } else if (['.rb', '.sh', '.bash', '.yml', '.yaml', '.toml'].includes(ext)) {
      if (line.startsWith('#')) {
        commentLines++;
        continue;
      }
    } else if (['.css', '.scss', '.sass', '.less'].includes(ext)) {
      if (inBlockComment) {
        commentLines++;
        if (line.includes('*/')) inBlockComment = false;
        continue;
      }
      if (line.startsWith('/*')) {
        commentLines++;
        if (!line.includes('*/')) inBlockComment = true;
        continue;
      }
      if (line.startsWith('//') && ext !== '.css') {
        commentLines++;
        continue;
      }
    } else if (['.html', '.xml'].includes(ext)) {
      if (inBlockComment) {
        commentLines++;
        if (line.includes('-->')) inBlockComment = false;
        continue;
      }
      if (line.startsWith('<!--')) {
        commentLines++;
        if (!line.includes('-->')) inBlockComment = true;
        continue;
      }
    }
    
    codeLines++;
  }
  
  const findMatches = (regex, text) => {
    const results = [];
    let m;
    regex.lastIndex = 0;
    while ((m = regex.exec(text)) !== null) {
      results.push(m[0].trim());
    }
    return results;
  };
  
  const findFirstCapture = (regex, text) => {
    const results = [];
    let m;
    regex.lastIndex = 0;
    while ((m = regex.exec(text)) !== null) {
      if (m[1]) results.push(m[1].trim());
    }
    return results;
  };

  let importMatches = [];
  let classMatches = [];
  let funcMatches = [];
  let exportsList = [];
  
  if (['.js', '.jsx', '.ts', '.tsx'].includes(ext)) {
    importMatches = findMatches(/^\s*(?:import\s+[\s\S]*?from\s+['"][^'"]+['"]|import\s+['"][^'"]+['"]|const\s+.*=\s*require\s*\(['"][^'"]+['"]\))/gm, content);
    classMatches = findFirstCapture(/^\s*(?:export\s+)?(?:default\s+)?(?:class|interface|enum)\s+([a-zA-Z0-9_]+)/gm, content);
    
    const standardFuncs = findFirstCapture(/^\s*(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z0-9_]+)/gm, content);
    const arrowFuncs = findFirstCapture(/^\s*(?:export\s+)?(?:const|let|var)\s+([a-zA-Z0-9_]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/gm, content);
    funcMatches = [...standardFuncs, ...arrowFuncs];
    
    const namedExports = findFirstCapture(/^\s*export\s+(?:const|let|var|function|class|interface|enum)\s+([a-zA-Z0-9_]+)/gm, content);
    const defaultExportMatch = content.match(/^\s*export\s+default\s+([a-zA-Z0-9_]+)/m);
    if (defaultExportMatch) namedExports.push(`${defaultExportMatch[1]} (default)`);
    exportsList = namedExports;
  } else if (ext === '.py') {
    importMatches = findMatches(/^\s*(?:import\s+[a-zA-Z0-9_, ]+|from\s+[a-zA-Z0-9_.]+\s+import\s+[a-zA-Z0-9_*, ]+)/gm, content);
    classMatches = findFirstCapture(/^\s*class\s+([a-zA-Z0-9_]+)/gm, content);
    funcMatches = findFirstCapture(/^\s*def\s+([a-zA-Z0-9_]+)/gm, content);
  } else if (ext === '.go') {
    const goImportRegex = /import\s*\(([\s\S]*?)\)/g;
    let goImportMatch;
    while ((goImportMatch = goImportRegex.exec(content)) !== null) {
      const items = goImportMatch[1].split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('//'));
      importMatches.push(...items);
    }
    const singleGoImport = findMatches(/^\s*import\s+['"][^'"]+['"]/gm, content);
    importMatches.push(...singleGoImport);
    
    classMatches = findFirstCapture(/^\s*type\s+([a-zA-Z0-9_]+)\s+(?:struct|interface|enum)/gm, content);
    funcMatches = findFirstCapture(/^\s*func\s+(?:\([^)]+\)\s+)?([a-zA-Z0-9_]+)/gm, content);
    
    funcMatches.forEach(f => { if (f && f[0] === f[0].toUpperCase()) exportsList.push(f); });
    classMatches.forEach(c => { if (c && c[0] === c[0].toUpperCase()) exportsList.push(c); });
  } else if (ext === '.rs') {
    importMatches = findMatches(/^\s*(?:use\s+[^;]+;)/gm, content);
    classMatches = findFirstCapture(/^\s*(?:pub\s+)?(?:struct|enum|trait|union)\s+([a-zA-Z0-9_]+)/gm, content);
    funcMatches = findFirstCapture(/^\s*(?:pub\s+)?(?:async\s+)?fn\s+([a-zA-Z0-9_]+)/gm, content);
    
    const pubItems = findFirstCapture(/^\s*pub\s+(?:fn|struct|enum|trait|const|static|type)\s+([a-zA-Z0-9_]+)/gm, content);
    exportsList = pubItems;
  } else if (['.css', '.scss', '.sass', '.less'].includes(ext)) {
    const varRegex = /--([a-zA-Z0-9_-]+)\s*:\s*([^;}\n]+)/g;
    let varMatch;
    while ((varMatch = varRegex.exec(content)) !== null) {
      funcMatches.push(`--${varMatch[1]} (${varMatch[2].trim()})`);
    }
  }

  return {
    filePath,
    lang,
    totalLines,
    emptyLines,
    commentLines,
    codeLines,
    imports: importMatches,
    classes: classMatches,
    functions: funcMatches,
          exports: exportsList
  };
}

/**
 * Generate Markdown for Single File Scan
 */
function generateSingleFileMarkdown(targetPath, analysis) {
  const fileName = path.basename(targetPath);
  
  let md = `# 📄 Source File Analysis Blueprint: **${fileName}**\n\n`;
  md += `This document provides a highly detailed schema mapping of the code definitions, imports, exports, and statistics inside the source file: \`${fileName}\`.\n\n`;
  md += `> [!NOTE]\n`;
  md += `> Generated automatically by the **codebase-scanner-skill**. To rebuild, execute: \`node scan.js ${fileName}\`\n\n`;
  md += `---\n\n`;

  // File Metadata
  md += `## ℹ️ File Specifications\n`;
  md += `*   **File Name**: \`${fileName}\`\n`;
  md += `*   **Absolute Path**: [\`${targetPath}\`](file://${targetPath})\n`;
  md += `*   **Detected Language**: **${analysis.lang}**\n\n`;

  // Line Stats
  md += `### 📊 Line Metrics\n`;
  md += `| Line Category | Count | Percentage |\n`;
  md += `| :--- | :--- | :--- |\n`;
  const pctCode = analysis.totalLines > 0 ? ((analysis.codeLines / analysis.totalLines) * 100).toFixed(1) : 0;
  const pctComment = analysis.totalLines > 0 ? ((analysis.commentLines / analysis.totalLines) * 100).toFixed(1) : 0;
  const pctEmpty = analysis.totalLines > 0 ? ((analysis.emptyLines / analysis.totalLines) * 100).toFixed(1) : 0;
  
  md += `| 💻 **Code Lines (Non-empty, active)** | **${analysis.codeLines}** | ${pctCode}% |\n`;
  md += `| 💬 **Comment Lines** | **${analysis.commentLines}** | ${pctComment}% |\n`;
  md += `| 🫙 **Empty Lines** | **${analysis.emptyLines}** | ${pctEmpty}% |\n`;
  md += `| 📚 **Total Lines** | **${analysis.totalLines}** | 100% |\n\n`;

  md += `---\n\n`;

  // Imports
  md += `## 📥 Imported Dependencies / Libraries\n`;
  if (analysis.imports.length === 0) {
    md += `*No external imports or require statements detected.*\n\n`;
  } else {
    md += `\`\`\`${analysis.lang.toLowerCase().replace(/[^a-z0-9]/g, '') || 'text'}\n`;
    analysis.imports.forEach(imp => {
      md += `${imp}\n`;
    });
    md += `\`\`\`\n\n`;
  }
  md += `---\n\n`;

  // Classes & Interfaces
  md += `## 🏛️ Class & Interface Schema\n`;
  if (analysis.classes.length === 0) {
    md += `*No classes, structs, or interfaces declared in this file.*\n\n`;
  } else {
    md += `Below are the structural declarations found:\n\n`;
    analysis.classes.forEach(c => {
      md += `*   **\`${c}\`**\n`;
    });
    md += `\n`;
  }
  md += `---\n\n`;

  // Functions Outline
  const isStyles = ['.css', '.scss', '.sass', '.less'].includes(path.extname(targetPath).toLowerCase());
  md += `## ⚡ ${isStyles ? 'CSS Custom Variables' : 'Method & Function Outline'}\n`;
  if (analysis.functions.length === 0) {
    md += `*No standard functions, class methods, or properties detected.*\n\n`;
  } else {
    md += `Below is the outline detected:\n\n`;
    analysis.functions.forEach(f => {
      md += `*   📄 **\`${f}\`**\n`;
    });
    md += `\n`;
  }
  md += `---\n\n`;

  // Exports
  md += `## 📤 Exported APIs / Symbols\n`;
  md += `Symbols exposed for external module loading:\n\n`;
  if (analysis.exports.length === 0) {
    md += `*No explicit export declarations detected (or this file acts as a standalone script).*\n\n`;
  } else {
    analysis.exports.forEach(exp => {
      md += `*   🚀 **\`${exp}\`**\n`;
    });
    md += `\n`;
  }

  md += `\n---\n*Created by Codebase Scanner Skill © 2026.*\n`;
  return md;
}

/**
 * Generate a modern, highly professional, structured README-modern.md file
 */
function generateSingleReadme(targetPath, repoName, repoUrl, tree, manifests, routes, cssVariables, stats, instructions) {
  let md = `<p align="center">\n  <img src="assets/scanner_skill%20logo.png" alt="Scanner Skill Logo" width="220">\n</p>\n\n# 🚀 **${repoName}**\n\n`;
  md += `Welcome to the ultimate codebase blueprint for **${repoName}**. This document compiles high-density specifications, dynamic routing schemes, custom styling design tokens, file topologies, repository statistics, and step-by-step extension roadmaps in a single unified entrypoint.\n\n`;
  
  if (repoUrl) {
    md += `*   **Repository Source**: [${repoUrl}](${repoUrl})\n`;
  }
  md += `*   **Primary Ecosystem**: **${stats.ecosystemType || 'General'}**\n`;
  md += `*   **Total Files Count**: ${stats.totalFiles} scanned files\n`;
  md += `*   **Combined Size**: ${formatBytes(stats.totalSizeBytes)}\n\n`;

  md += `---\n\n`;
  md += `## 📦 Installation & Quick Start\n\n`;
  md += `You can run and install **scanner-skill** using \`npx\` or via global/local \`npm\` installations:\n\n`;
  md += `### 1. Run Instantly via \`npx\` (No Installation Needed)\n`;
  md += `To scan your current local directory and initialize the AI agent skill:\n`;
  md += `\`\`\`bash\n`;
  md += `npx @sujoymoulick/scanner-skill\n`;
  md += `\`\`\`\n`;
  md += `To scan a remote GitHub repository and launch the interactive local web dashboard:\n`;
  md += `\`\`\`bash\n`;
  md += `npx @sujoymoulick/scanner-skill <github-repo-url>\n`;
  md += `\`\`\`\n\n`;
  md += `### 2. Global Installation\n`;
  md += `To install the CLI tool globally on your system:\n`;
  md += `\`\`\`bash\n`;
  md += `npm install -g @sujoymoulick/scanner-skill\n`;
  md += `\`\`\`\n`;
  md += `Now you can execute the command from any workspace directory:\n`;
  md += `\`\`\`bash\n`;
  md += `scanner-skill [path-to-file-or-dir | github-repo-url]\n`;
  md += `\`\`\`\n\n`;
  md += `### 3. Local Dev Dependency\n`;
  md += `To integrate it directly inside an existing codebase:\n`;
  md += `\`\`\`bash\n`;
  md += `npm install --save-dev @sujoymoulick/scanner-skill\n`;
  md += `\`\`\`\n`;
  md += `And execute via:\n`;
  md += `\`\`\`bash\n`;
  md += `npx scanner-skill\n`;
  md += `\`\`\`\n\n`;

  md += `---\n\n`;
  md += `## 🌟 Discovered Architecture Layers\n\n`;
  
  let backendRoutes = routes.filter(r => r.type.toLowerCase().includes('api') || r.type.toLowerCase().includes('backend'));
  let clientRoutes = routes.filter(r => r.type.toLowerCase().includes('view') || r.type.toLowerCase().includes('frontend'));
  
  if (clientRoutes.length > 0) {
    md += `*   🌐 **Frontend Client Layer**: Implements dynamic page renders. Detected views: ${clientRoutes.slice(0, 8).map(r => `\`${r.route}\``).join(', ')}.\n`;
  }
  if (backendRoutes.length > 0) {
    md += `*   🔌 **Backend Server API Layer**: Implements endpoints handling routing. Detected handlers: ${backendRoutes.slice(0, 8).map(r => `\`${r.route}\``).join(', ')}.\n`;
  }
  if (cssVariables.length > 0) {
    md += `*   🎨 **Design Tokens System**: Stylesheets are controlled globally via variables (` + cssVariables.slice(0, 5).map(v => `\`${v.name}\``).join(', ') + `, etc.).\n`;
  }
  md += `\n---\n\n`;

  // Dynamic Routing
  if (routes && routes.length > 0) {
    md += `## 🚦 Dynamic Endpoint Routing\n\n`;
    md += `| Route / Endpoint | Type | Method | File Location |\n`;
    md += `| :--- | :--- | :--- | :--- |\n`;
    routes.forEach(r => {
      const compStr = r.component ? ` ➔ Component: \`${r.component}\`` : '';
      md += `| \`${r.route}\`${compStr} | **${r.type}** | \`${r.method}\` | [\`${r.file}:${r.line}\`](file://${path.join(targetPath, r.file)}#L${r.line}) |\n`;
    });
    md += `\n---\n\n`;
  }

  // CSS Variables
  if (cssVariables && cssVariables.length > 0) {
    md += `## 🎨 CSS Style Custom Variables\n\n`;
    md += `| Variable Name | Assigned Value | Source File |\n`;
    md += `| :--- | :--- | :--- |\n`;
    cssVariables.forEach(v => {
      md += `| \`${v.name}\` | \`${v.value}\` | [\`${v.file}:${v.line}\`](file://${path.join(targetPath, v.file)}#L${v.line}) |\n`;
    });
    md += `\n---\n\n`;
  }

  // Dependencies Manifest
  md += `## 📦 Dependencies & Manifest Breakdown\n\n`;
  if (manifests.length === 0) {
    md += `*No dependency manifests detected (e.g. package.json, requirements.txt, Cargo.toml).*`;
  } else {
    manifests.forEach(manifest => {
      md += `### 📄 \`${manifest.path}\` (${manifest.type})\n`;
      md += `**Project/Module Name**: \`${manifest.name}\`\n\n`;
      
      const deps = Object.entries(manifest.dependencies);
      const devDeps = Object.entries(manifest.devDependencies);
      
      if (deps.length === 0 && devDeps.length === 0) {
        md += `*No active dependencies declared in this manifest.*\n\n`;
        return;
      }
      
      if (deps.length > 0) {
        md += `| Dependency Package | Declared Version |\n`;
        md += `| :--- | :--- |\n`;
        deps.forEach(([pkg, ver]) => {
          md += `| \`${pkg}\` | \`${ver}\` |\n`;
        });
        md += `\n`;
      }
      
      if (devDeps.length > 0) {
        md += `| Dev Dependency | Declared Version |\n`;
        md += `| :--- | :--- |\n`;
        devDeps.forEach(([pkg, ver]) => {
          md += `| \`${pkg}\` | \`${ver}\` |\n`;
        });
        md += `\n`;
      }
    });
  }
  md += `\n---\n\n`;

  // Directory Tree
  md += `## 🏗️ Codebase Directory Tree\n`;
  md += `\`\`\`text\n`;
  md += formatTreeMarkdown(tree);
  md += `\`\`\`\n\n`;
  md += `---\n\n`;

  // Core Overview
  md += `## 📊 Repository Metrics & Statistics\n\n`;
  md += `### Language & Extension Breakdown\n`;
  md += `| File Extension | File Count | Combined Size | Total Lines |\n`;
  md += `| :--- | :--- | :--- | :--- |\n`;
  Object.entries(stats.extBreakdown)
    .sort((a, b) => b[1].count - a[1].count)
    .forEach(([ext, stat]) => {
      const langName = LANG_MAP[ext] || ext;
      md += `| \`${ext}\` (${langName}) | ${stat.count} | ${formatBytes(stat.size)} | ${stat.lines || 'N/A'} |\n`;
    });
  md += `\n`;

  md += `### 🔝 Top 5 Largest Files\n`;
  md += `| File Path | Size | File Type |\n`;
  md += `| :--- | :--- | :--- |\n`;
  stats.largestFiles.forEach(f => {
    const ext = path.extname(f.name).toLowerCase();
    md += `| [\`${f.path}\`](file://${path.join(targetPath, f.path)}) | ${formatBytes(f.size)} | \`${LANG_MAP[ext] || ext}\` |\n`;
  });
  md += `\n---\n\n`;

  // Step-by-Step Instructions
  md += `## 🚀 Step-by-Step Development Roadmap\n\n`;
  md += `Follow these steps to safely initialize, develop, and extend this project:\n\n`;
  
  md += `### Phase 1: Environment Setup\n`;
  md += `1.  **Clone / Checkout**: Ensure all workspace files are available locally.\n`;
  const ecoType = (stats.ecosystemType || '').toLowerCase();
  if (ecoType.includes('node') || ecoType.includes('react')) {
    md += `2.  **Node Environment**: Verify Node.js (v16+) is loaded. Install dependencies:\n`;
    md += `    \`\`\`bash\n    npm install\n    \`\`\`\n`;
  } else if (ecoType.includes('python')) {
    md += `2.  **Python Virtualenv**: Initialize a virtual environment and load requirements:\n`;
    md += `    \`\`\`bash\n    python -m venv venv\n    source venv/bin/activate\n    pip install -r requirements.txt\n    \`\`\`\n`;
  } else if (ecoType.includes('go')) {
    md += `2.  **Go Modules**: Run packages check:\n`;
    md += `    \`\`\`bash\n    go mod tidy\n    \`\`\`\n`;
  } else {
    md += `2.  **Standard Environment**: Verify dependencies and package managers corresponding to **${stats.ecosystemType || 'General'}**.\n`;
  }
  md += `3.  **Environment Variables**: Create a \`.env\` file in the root if the project requires credentials or API urls.\n\n`;

  md += `### Phase 2: Codebase Extension & Development Instructions\n\n`;
  md += `When expanding codebase capabilities, respect the following design guidelines:\n\n`;
  
  if (routes.length > 0) {
    md += `#### A. How to Add New Routes / Endpoints\n`;
    md += `1.  Locate the main router definition files shown in the routing map table.\n`;
    md += `2.  Declare the new route endpoint using consistent method signatures:\n`;
    if (backendRoutes.length > 0) {
      md += `    *   *Backend APIs*: Follow REST standards, returning formatted JSON blocks.\n`;
    }
    if (clientRoutes.length > 0) {
      md += `    *   *Frontend Views*: Connect view components to your router paths.\n`;
    }
    md += `3.  Register the handler or element inside the routing configuration.\n\n`;
  }

  if (cssVariables.length > 0) {
    md += `#### B. Working with Styling & Theme Custom Variables\n`;
    md += `1.  Do NOT write duplicate hardcoded hex color values or fonts.\n`;
    md += `2.  Use the registered variables at the top of sheets via: \`color: var(--color-variable-name);\`.\n`;
    md += `3.  If modifying themes, change variables inside the global \`:root\` selector.\n\n`;
  }

  md += `#### C. Managing Ecosystem Dependencies\n`;
  md += `1.  Always register new packages in the primary manifest files (e.g. \`package.json\`, \`requirements.txt\`).\n`;
  md += `2.  Do NOT perform manual direct script loading unless absolutely necessary.\n\n`;

  md += `### Phase 3: Testing & Code Verification\n`;
  md += `1.  **Local Dev Server**: Boot the application locally to test additions.\n`;
  if (ecoType.includes('node') || ecoType.includes('react')) {
    md += `    \`\`\`bash\n    npm run dev\n    \`\`\`\n`;
  } else if (ecoType.includes('python')) {
    md += `    \`\`\`bash\n    python main.py\n    \`\`\`\n`;
  } else if (ecoType.includes('go')) {
    md += `    \`\`\`bash\n    go run main.go\n    \`\`\`\n`;
  } else {
    md += `    Verify startup scripts inside source files.\n`;
  }
  md += `2.  **Linting & Style Checks**: Run code checks to avoid runtime regressions.\n`;
  md += `3.  **Unit Tests**: Build custom unit testing scripts (e.g., Jest, PyTest, go test) in a dedicated \`tests/\` folder.\n\n`;

  md += `---\n\n`;
  md += `## ⚙️ How to Setup & Run (Original Instructions)\n\n`;
  if (instructions && instructions.trim() && !instructions.toLowerCase().includes('no readme.md found')) {
    md += instructions;
  } else {
    md += `No dedicated install instructions detected in the original project readme.\n`;
  }
  md += `\n---\n\n`;

  md += `## 🤖 AI Agent Coding Guidelines (Context Guard)\n\n`;
  md += `> [!IMPORTANT]\n`;
  md += `> When delegating tasks to AI agents, instruct them strictly as follows:\n`;
  md += `> 1.  **Preserve Architecture**: Do not modify routing schemes or file structure layouts without consulting this file tree.\n`;
  md += `> 2.  **Maintain CSS Variables**: Always reuse discovered style variable tokens to preserve theme alignment.\n`;
  md += `> 3.  **Zero Duplication**: Ensure functions are reusable and placed inside appropriate utility classes.\n`;
  md += `> 4.  **No Placeholders**: Never write incomplete placeholder code blocks.\n\n`;

  md += `\n---\n\n`;
  md += `## 💡 **Vibe Coding & AI Agent Token Optimization**\n\n`;
  md += `> [!TIP]\n`;
  md += `> **Token Saver Advantage**: AI agents (like Cursor, Gemini, Tabnine, and Copilot) have limited context window allocations and API limits. Running this scanner compiles your repository into lightweight blueprints. Directing your AI agent to read **only this directory** provides 100% architectural and routing context while **saving up to 90%+ of tokens**!\n\n`;
  md += `### 🚀 Step-by-Step Vibe Coding Walkthrough:\n`;
  md += `1. **Navigate to your target repository**:\n`;
  md += `   \`\`\`bash\n   cd <target-folder-name>\n   \`\`\`\n`;
  md += `2. **Execute the static sweep** via \`npx\`:\n`;
  md += `   \`\`\`bash\n   npx @sujoymoulick/scanner-skill\n   \`\`\`\n`;
  md += `   *(Alternatively, if installed globally, simply run \`scanner-skill\`)*\n`;
  md += `3. **Feed the Blueprints to your AI Agent**: Direct your assistant to read the compiled files under \`scanner_skill/\` to code with absolute architectural clarity at a fraction of the token cost!\n\n`;

  md += `\n---\n\n`;
  md += `## 👤 About the Developer\n\n`;
  md += `This Codebase Scanner Skill Engine was designed and engineered by **[Sujoy Moulick](https://www.sujoymoulick.online/)**.\n\n`;
  md += `*   **Role**: AI/ML & Frontend Architect (B.Tech CSE AI/ML student at UEM Jaipur)\n`;
  md += `*   **Philosophy**: *"Bridging the gap between complex software engineering and intuitive user experiences; viewing coding as an interactive art form."*\n`;
  md += `*   **Portfolio & Projects**: [sujoymoulick.online](https://www.sujoymoulick.online/) (Adhyayan, Meghdoot, Textora)\n`;
  md += `*   **Contact**: [sujoymoulick05@gmail.com](mailto:sujoymoulick05@gmail.com)\n\n`;
  md += `\n---\n*Generated with ❤️ by Sujoy Moulick & Pramaaan Unified Codebase Blueprint Engine.*`;
  return md;
}

/**
 * Automatically sets up the scanning skill in process.cwd()/scanner_skill
 */
function ensureSelfInstallation() {
  const targetDir = path.join(process.cwd(), 'scanner_skill');
  
  // Skip if we are running directly from inside the scanner_skill folder to prevent recursion
  if (__dirname === targetDir) {
    return;
  }
  
  // If the target folder doesn't exist, create it
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
  
  const filesToCopy = ['scan.js', 'index.html', 'styles.css'];
  
  filesToCopy.forEach(fileName => {
    const srcFile = path.join(__dirname, fileName);
    const destFile = path.join(targetDir, fileName);
    if (fs.existsSync(srcFile)) {
      try {
        fs.copyFileSync(srcFile, destFile);
      } catch (err) {
        console.warn(`⚠️ Warning: Failed to copy ${fileName} to scanner_skill:`, err.message);
      }
    }
  });

  // Copy assets folder
  const srcAssets = path.join(__dirname, 'assets');
  const destAssets = path.join(targetDir, 'assets');
  if (fs.existsSync(srcAssets)) {
    if (!fs.existsSync(destAssets)) {
      fs.mkdirSync(destAssets, { recursive: true });
    }
    try {
      const assets = fs.readdirSync(srcAssets);
      assets.forEach(asset => {
        const srcAsset = path.join(srcAssets, asset);
        const destAsset = path.join(destAssets, asset);
        if (fs.statSync(srcAsset).isFile()) {
          fs.copyFileSync(srcAsset, destAsset);
        }
      });
    } catch (err) {
      console.warn('⚠️ Warning: Failed to copy assets folder to scanner_skill:', err.message);
    }
  }

  // Copy templates folder
  const srcTemplates = path.join(__dirname, 'templates');
  const destTemplates = path.join(targetDir, 'templates');
  if (fs.existsSync(srcTemplates)) {
    if (!fs.existsSync(destTemplates)) {
      fs.mkdirSync(destTemplates, { recursive: true });
    }
    try {
      const templates = fs.readdirSync(srcTemplates);
      templates.forEach(tpl => {
        const srcTpl = path.join(srcTemplates, tpl);
        const destTpl = path.join(destTemplates, tpl);
        if (fs.statSync(srcTpl).isFile()) {
          fs.copyFileSync(srcTpl, destTpl);
        }
      });
    } catch (err) {
      console.warn('⚠️ Warning: Failed to copy templates folder to scanner_skill:', err.message);
    }
  }

  // Create .gitignore inside targetDir to prevent Git from tracking the skill's own files
  const gitignorePath = path.join(targetDir, '.gitignore');
  const gitignoreContent = `# Ignore scanner skill's local dashboard assets and temp clones
index.html
styles.css
assets/
cloned-repos/

# Node.js
node_modules/

# Local CLI files (keep the scanner itself for editing)
scanner.js
package.json
package-lock.json
LICENSE
README.md
`;
  try {
    fs.writeFileSync(gitignorePath, gitignoreContent, 'utf8');
  } catch (err) {
    console.warn('⚠️ Warning: Failed to create .gitignore inside scanner_skill:', err.message);
  }

  console.log(`✨ [Scanner Skill] Successfully installed and configured inside: ${targetDir}`);
}

/**
 * Prompt the user for a string input via CLI
 */
function promptUser(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => rl.question(query, (ans) => {
    rl.close();
    resolve(ans.trim());
  }));
}

/**
 * Recursively walks a directory and deletes index.html, style.css, and styles.css
 */
function excludeSpecificFiles(dir) {
  let items;
  try {
    items = fs.readdirSync(dir);
  } catch (err) {
    return;
  }

  for (const item of items) {
    const fullPath = path.join(dir, item);
    let stats;
    try {
      stats = fs.statSync(fullPath);
    } catch (err) {
      continue;
    }

    if (stats.isDirectory()) {
      excludeSpecificFiles(fullPath);
    } else {
      const lowercaseName = item.toLowerCase();
      if (lowercaseName === 'index.html' || lowercaseName === 'style.css' || lowercaseName === 'styles.css') {
        try {
          fs.unlinkSync(fullPath);
          console.log(`🗑️  [Excluded] Deleted file: ${fullPath}`);
        } catch (err) {
          console.warn(`⚠️ Warning: Failed to delete excluded file ${fullPath}:`, err.message);
        }
      }
    }
  }
}

/**
 * Generate README.md containing key project details
 */
function generateReadmeMarkdown(repoName, repoUrl, stats, tree, manifests) {
  let md = `<p align="center">\n  <img src="assets/scanner_skill%20logo.png" alt="Scanner Skill Logo" width="220">\n</p>\n\n`;
  md += `# 🚀 **${repoName}**\n\n`;
  md += `Welcome to the core system blueprint for **${repoName}**. This document compiles high-density specifications, file topologies, repository statistics, and structural manifest details.\n\n`;
  
  if (repoUrl) {
    md += `*   **Repository Source**: [${repoUrl}](${repoUrl})\n`;
  }
  md += `*   **Primary Ecosystem**: **${stats.ecosystemType || 'General'}**\n`;
  md += `*   **Total Files Count**: ${stats.totalFiles} scanned files\n`;
  md += `*   **Combined Size**: ${formatBytes(stats.totalSizeBytes)}\n\n`;

  md += `---\n\n`;
  md += `## 🌟 Discovered Architecture Layers\n\n`;
  
  if (manifests.length > 0) {
    md += `*   🔌 **Ecosystem Manifest Layer**: Detected manifest configurations: ` + manifests.map(m => `\`${m.path}\``).join(', ') + `.\n`;
  }
  
  md += `\n---\n\n`;

  // Dependencies Manifest
  md += `## 📦 Dependencies & Manifest Breakdown\n\n`;
  if (manifests.length === 0) {
    md += `*No dependency manifests detected (e.g. package.json, requirements.txt, Cargo.toml).*`;
  } else {
    manifests.forEach(manifest => {
      md += `### 📄 \`${manifest.path}\` (${manifest.type})\n`;
      md += `**Project/Module Name**: \`${manifest.name}\`\n\n`;
      
      const deps = Object.entries(manifest.dependencies);
      const devDeps = Object.entries(manifest.devDependencies);
      
      if (deps.length === 0 && devDeps.length === 0) {
        md += `*No active dependencies declared in this manifest.*\n\n`;
        return;
      }
      
      if (deps.length > 0) {
        md += `| Dependency Package | Declared Version |\n`;
        md += `| :--- | :--- |\n`;
        deps.forEach(([pkg, ver]) => {
          md += `| \`${pkg}\` | \`${ver}\` |\n`;
        });
        md += `\n`;
      }
    });
  }
  md += `\n---\n\n`;

  // Directory Tree
  md += `## 🏗️ Codebase Directory Tree\n`;
  md += `\`\`\`text\n`;
  md += formatTreeMarkdown(tree);
  md += `\`\`\`\n\n`;
  md += `---\n\n`;

  // Core Overview
  md += `## 📊 Repository Metrics & Statistics\n\n`;
  md += `### Language & Extension Breakdown\n`;
  md += `| File Extension | File Count | Combined Size | Total Lines |\n`;
  md += `| :--- | :--- | :--- | :--- |\n`;
  Object.entries(stats.extBreakdown)
    .sort((a, b) => b[1].count - a[1].count)
    .forEach(([ext, stat]) => {
      const langName = LANG_MAP[ext] || ext;
      md += `| \`${ext}\` (${langName}) | ${stat.count} | ${formatBytes(stat.size)} | ${stat.lines || 'N/A'} |\n`;
    });
  md += `\n`;

  md += `### 🔝 Top 5 Largest Files\n`;
  md += `| File Path | Size | File Type |\n`;
  md += `| :--- | :--- | :--- |\n`;
  stats.largestFiles.forEach(f => {
    const ext = path.extname(f.name).toLowerCase();
    md += `| \`${f.path}\` | ${formatBytes(f.size)} | \`${LANG_MAP[ext] || ext}\` |\n`;
  });
  md += `\n---\n\n`;
  md += `## 🤖 **AI Agent Context Window & Token Optimization**\n\n`;
  md += `> [!IMPORTANT]\n`;
  md += `> **Vibe Coding Token Saver**: AI agents (like Cursor, Gemini, Tabnine, and Copilot) have tight context windows and API token limits. If they scan your entire codebase repeatedly during interactive editing sessions, your token allowance will expire very quickly. By feeding the AI agent **only** the compiled blueprints, you provide 100% architectural and routing context while **saving up to 90%+ of tokens**!\n\n`;
  md += `### 💡 How to use this skill for Vibe Coding:\n`;
  md += `1. **Navigate to your target repository**:\n`;
  md += `   \`\`\`bash\n   cd <target-folder-name>\n   \`\`\`\n`;
  md += `2. **Execute the static sweep** via \`npx\`:\n`;
  md += `   \`\`\`bash\n   npx @sujoymoulick/scanner-skill\n   \`\`\`\n`;
  md += `   *(Alternatively, if installed globally, simply run \`scanner-skill\`)*\n`;
  md += `3. **Direct your AI Assistant** (Cursor, Tabnine, etc.) to read the compiled files under \`scanner_skill/\` to work with full, lightweight project blueprints instantly!\n\n`;
  md += `\n---\n\n`;
  md += `## 👤 About the Developer\n\n`;
  md += `This Codebase Scanner Skill Engine was designed and engineered by **[Sujoy Moulick](https://www.sujoymoulick.online/)**.\n\n`;
  md += `*   **Role**: AI/ML & Frontend Architect (B.Tech CSE AI/ML student at UEM Jaipur)\n`;
  md += `*   **Philosophy**: *"Bridging the gap between complex software engineering and intuitive user experiences; viewing coding as an interactive art form."*\n`;
  md += `*   **Portfolio & Projects**: [sujoymoulick.online](https://www.sujoymoulick.online/) (Adhyayan, Meghdoot, Textora)\n`;
  md += `*   **Contact**: [sujoymoulick05@gmail.com](mailto:sujoymoulick05@gmail.com)\n\n`;
  md += `\n---\n*Generated with ❤️ by Sujoy Moulick & Pramaaan Unified Codebase Blueprint Engine.*`;
  return md;
}

/**
 * Generate instruction.md containing setup and running guidelines
 */
function generateInstructionMarkdown(repoName, stats, instructions, repoUrl = '', tree = []) {
  const defaultTemplate = `# 📖 Setup & Run Instructions: **{{REPO_NAME}}**

This instruction guide provides complete steps to configure, launch, and run this codebase locally.

---

## ℹ️ Project Specifications
*   **Repository Source**: [{{REPO_URL}}]({{REPO_URL}})
*   **Primary Ecosystem**: **{{ECOSYSTEM}}**
*   **Total Files Count**: {{TOTAL_FILES}} scanned files
*   **Combined Size**: {{TOTAL_SIZE}}

---

## 🏗️ Codebase Structure
\`\`\`text
{{TREE}}
\`\`\`

---

## 🚀 Step-by-Step Development Roadmap

### Phase 1: Environment Setup
1.  **Clone / Checkout**: Ensure all workspace files are available locally.
2.  **Ecosystem Dependencies**:
{{ECOSYSTEM_SETUP_STEPS}}
3.  **Environment Variables**: Create a \`.env\` file in the root if the project requires credentials or API urls.

### Phase 2: Local Startup & Execution
1.  **Boot Command**: Run the startup scripts inside the terminal:
{{ECOSYSTEM_STARTUP_STEPS}}
2.  **Verification**: Access the corresponding local port to confirm state.

### Phase 3: Testing & Code Checks
1.  **Linting & Style Checks**: Run code formatting/checks to avoid runtime regressions.
2.  **Unit Tests**: Build custom unit testing scripts in a dedicated \`tests/\` folder.

---

## ⚙️ Heuristically Isolated Setup Guide (Original README)

{{ORIGINAL_SETUP_GUIDE}}

---
*Generated by Codebase Scanner Skill © 2026.*`;

  let template = readTemplateOrDefault('instruction.template.md', defaultTemplate);

  const ecoType = (stats.ecosystemType || '').toLowerCase();
  let setupSteps = '';
  if (ecoType.includes('node') || ecoType.includes('react')) {
    setupSteps = `1. Verify Node.js (v16+) is loaded.\n2. Install dependencies:\n   \`\`\`bash\n   npm install\n   \`\`\``;
  } else if (ecoType.includes('python')) {
    setupSteps = `1. Initialize a virtual environment:\n   \`\`\`bash\n   python -m venv venv\n   source venv/bin/activate\n   \`\`\`\n2. Install requirements:\n   \`\`\`bash\n   pip install -r requirements.txt\n   \`\`\``;
  } else if (ecoType.includes('go')) {
    setupSteps = `1. Run package check:\n   \`\`\`bash\n   go mod tidy\n   \`\`\``;
  } else {
    setupSteps = `1. Verify dependencies and package managers corresponding to **${stats.ecosystemType || 'General'}**.`;
  }

  let startupSteps = '';
  if (ecoType.includes('node') || ecoType.includes('react')) {
    startupSteps = `    \`\`\`bash\n    npm run dev\n    \`\`\``;
  } else if (ecoType.includes('python')) {
    startupSteps = `    \`\`\`bash\n    python main.py\n    \`\`\``;
  } else if (ecoType.includes('go')) {
    startupSteps = `    \`\`\`bash\n    go run main.go\n    \`\`\``;
  } else {
    startupSteps = `    Verify startup command inside source files.`;
  }

  const originalSetup = instructions && instructions.trim() && !instructions.toLowerCase().includes('no readme.md found')
    ? instructions
    : '*No dedicated running instructions were isolated from the original project readme.*';

  template = template
    .replace(/\{\{REPO_NAME\}\}/g, repoName)
    .replace(/\{\{REPO_URL\}\}/g, repoUrl || 'N/A')
    .replace(/\{\{ECOSYSTEM\}\}/g, stats.ecosystemType || 'General')
    .replace(/\{\{TOTAL_FILES\}\}/g, stats.totalFiles || 0)
    .replace(/\{\{TOTAL_SIZE\}\}/g, formatBytes(stats.totalSizeBytes || 0))
    .replace(/\{\{TREE\}\}/g, formatTreeMarkdown(tree))
    .replace(/\{\{ECOSYSTEM_SETUP_STEPS\}\}/g, setupSteps)
    .replace(/\{\{ECOSYSTEM_STARTUP_STEPS\}\}/g, startupSteps)
    .replace(/\{\{ORIGINAL_SETUP_GUIDE\}\}/g, originalSetup);

  return template;
}

/**
 * Generate ui.md containing UI related details
 */
function generateUiMarkdown(repoName, routes, cssVariables, stats = {}) {
  const defaultTemplate = `# 🎨 Interface & UI Blueprint: **{{REPO_NAME}}**

This document details all discovered client routes, component mapping, and global styling custom variable variables.

---

## ℹ️ Project Overview
*   **Ecosystem Type**: **{{ECOSYSTEM}}**
*   **Total Files Scanned**: {{TOTAL_FILES}}
*   **Codebase Volume**: {{TOTAL_SIZE}}

---

## 🚦 Client Views & Routing Outline

{{CLIENT_ROUTES}}

---

## 🔌 Backend/API Endpoint Mapping

{{API_ROUTES}}

---

## 🖌️ Stylesheet Tokens & Design Variables

{{CSS_VARIABLES}}

---
*Generated by Codebase Scanner Skill © 2026.*`;

  let template = readTemplateOrDefault('ui.template.md', defaultTemplate);

  let clientRoutes = routes.filter(r => r.type.toLowerCase().includes('view') || r.type.toLowerCase().includes('frontend'));
  let apiRoutes = routes.filter(r => r.type.toLowerCase().includes('api') || r.type.toLowerCase().includes('backend'));

  let clientStr = '';
  if (clientRoutes.length === 0) {
    clientStr = '*No dedicated client routing views detected in this repository.*';
  } else {
    clientStr = '| Route / Endpoint | Component View | Method | Location |\n| :--- | :--- | :--- | :--- |\n';
    clientRoutes.forEach(r => {
      clientStr += `| \`${r.route}\` | \`${r.component || 'N/A'}\` | \`VIEW\` | \`${r.file}:${r.line}\` |\n`;
    });
  }

  let apiStr = '';
  if (apiRoutes.length === 0) {
    apiStr = '*No dedicated API endpoint mappings detected in this repository.*';
  } else {
    apiStr = '| API Route | Type | Method | Location |\n| :--- | :--- | :--- | :--- |\n';
    apiRoutes.forEach(r => {
      apiStr += `| \`${r.route}\` | **${r.type}** | \`${r.method}\` | \`${r.file}:${r.line}\` |\n`;
    });
  }

  let cssStr = '';
  if (cssVariables && cssVariables.length > 0) {
    cssStr = '| Token Name | Assigned Value | File Location |\n| :--- | :--- | :--- |\n';
    cssVariables.forEach(v => {
      cssStr += `| \`${v.name}\` | \`${v.value}\` | \`${v.file}:${v.line}\` |\n`;
    });
  } else {
    cssStr = '*No global stylesheet custom properties variables detected.*';
  }

  template = template
    .replace(/\{\{REPO_NAME\}\}/g, repoName)
    .replace(/\{\{ECOSYSTEM\}\}/g, stats.ecosystemType || 'General')
    .replace(/\{\{TOTAL_FILES\}\}/g, stats.totalFiles || 0)
    .replace(/\{\{TOTAL_SIZE\}\}/g, formatBytes(stats.totalSizeBytes || 0))
    .replace(/\{\{CLIENT_ROUTES\}\}/g, clientStr)
    .replace(/\{\{API_ROUTES\}\}/g, apiStr)
    .replace(/\{\{CSS_VARIABLES\}\}/g, cssStr);

  return template;
}

/**
 * Helper to read template with absolute path or fall back
 */
function readTemplateOrDefault(templateName, defaultContent) {
  try {
    const templatePath = path.join(__dirname, 'templates', templateName);
    if (fs.existsSync(templatePath)) {
      return fs.readFileSync(templatePath, 'utf8');
    }
  } catch (e) {
    // Suppress warning if not found
  }
  return defaultContent;
}

/**
 * Heuristically parses README.md to extract Setup & Installation guidelines for Dashboard
 */
function extractRunInstructions(clonedDir) {
  let readmeFile;
  try {
    readmeFile = fs.readdirSync(clonedDir).find(f => f.toLowerCase() === 'readme.md');
  } catch (e) {
    return 'Could not read directory files.';
  }

  if (!readmeFile) {
    return '### ⚠️ No README.md Found\nNo explicit setup instructions exist in the repository root. Please review source files directly.';
  }

  const content = fs.readFileSync(path.join(clonedDir, readmeFile), 'utf8');
  const lines = content.split(/\r?\n/);
  
  let currentSection = null;
  const collectedSections = [];
  const sectionRegex = /^(#{1,4})\s+(.*)$/;
  const runKeywords = /\b(run|running|start|starting|launch|install|installation|usage|quickstart|getting started|setup|deploy|execution)\b/i;
  let sectionBuffer = [];
  
  for (const line of lines) {
    const match = line.match(sectionRegex);
    if (match) {
      if (currentSection && sectionBuffer.length > 0) {
        collectedSections.push({
          header: currentSection,
          content: sectionBuffer.join('\n').trim()
        });
      }
      
      const headerText = match[2].trim();
      if (runKeywords.test(headerText)) {
        currentSection = headerText;
        sectionBuffer = [];
      } else {
        currentSection = null;
      }
    } else {
      if (currentSection) {
        sectionBuffer.push(line);
      }
    }
  }
  
  if (currentSection && sectionBuffer.length > 0) {
    collectedSections.push({
      header: currentSection,
      content: sectionBuffer.join('\n').trim()
    });
  }

  if (collectedSections.length === 0) {
    const cleanedText = content.slice(0, 1200);
    return `### 📖 Project Overview & Guidelines\n\n${cleanedText}...\n\n*(Full running details were not isolated into discrete headers in the README. Showing top details.)*`;
  }

  return collectedSections.map(s => `## 🚀 ${s.header}\n${s.content}`).join('\n\n');
}

/**
 * Parses package.json or requirements.txt for dynamic technology tags
 */
function extractTechnologies(filesList, baseDir) {
  const techSet = new Set();
  let mainEcosystem = 'General Project';

  filesList.forEach(file => {
    const fullPath = path.join(baseDir, file.path);
    const name = path.basename(file.path);
    
    if (name === 'package.json') {
      try {
        const pkg = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
        mainEcosystem = 'Node.js (JS/TS)';
        Object.keys(pkg.dependencies || {}).forEach(k => techSet.add(k));
        Object.keys(pkg.devDependencies || {}).forEach(k => techSet.add(k));
      } catch (e) {}
    } else if (name === 'requirements.txt') {
      try {
        mainEcosystem = 'Python';
        const lines = fs.readFileSync(fullPath, 'utf8').split('\n');
        lines.forEach(l => {
          const trimmed = l.trim();
          if (trimmed && !trimmed.startsWith('#')) {
            const m = trimmed.match(/^([a-zA-Z0-9_.-]+)/);
            if (m) techSet.add(m[1]);
          }
        });
      } catch (e) {}
    } else if (name === 'Cargo.toml') {
      try {
        mainEcosystem = 'Rust (Cargo)';
        const lines = fs.readFileSync(fullPath, 'utf8').split('\n');
        let isDep = false;
        lines.forEach(l => {
          const trimmed = l.trim();
          if (trimmed.startsWith('[dependencies]')) isDep = true;
          else if (trimmed.startsWith('[')) isDep = false;
          else if (isDep && trimmed && !trimmed.startsWith('#')) {
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx !== -1) techSet.add(trimmed.slice(0, eqIdx).trim());
          }
        });
      } catch (e) {}
    } else if (name === 'go.mod') {
      try {
        mainEcosystem = 'Go (Modules)';
        const lines = fs.readFileSync(fullPath, 'utf8').split('\n');
        lines.forEach(l => {
          const trimmed = l.trim();
          if (trimmed.startsWith('require ')) {
            const parts = trimmed.slice(8).trim().split(/\s+/);
            if (parts.length > 0) techSet.add(parts[0]);
          }
        });
      } catch (e) {}
    }
  });

  return {
    list: Array.from(techSet).slice(0, 15),
    mainEcosystem
  };
}

/**
 * Checks if a string input is a Git Repository URL
 */
function isGitUrl(str) {
  if (!str) return false;
  return /^(https?:\/\/|git@|github\.com|git:\/\/)/i.test(str) || str.endsWith('.git');
}

/**
 * Main Runner Routine
 */
async function run() {
  // Step 1: Automatically install/setup the scanning skill inside scanner_skill folder of process.cwd()
  ensureSelfInstallation();

  const args = process.argv.slice(2);
  let rawPath = args[0] ? args[0].trim() : '';

  // Step 2: If no argument is provided, prompt user interactively for a Git Repo URL
  if (!rawPath) {
    console.log('\n============================================================');
    console.log('🤖 Welcome to the Codebase Scanner Skill Automator!');
    console.log('============================================================');
    rawPath = await promptUser('🔑 Enter a GitHub Repository URL to scan (or press Enter to scan local project): ');
    console.log();
  }

  // If still empty, default to process.cwd() for a standard local scan
  if (!rawPath) {
    rawPath = process.cwd();
  }

  if (isGitUrl(rawPath)) {
    // Branch A: Dynamic GitHub Repository Cloner, Analyzer, and Dashboard Server
    const repoUrl = rawPath;
    const match = repoUrl.match(/([^/]+)\.git$/) || repoUrl.match(/([^/]+)$/);
    if (!match) {
      console.error('❌ Error: Invalid Git repository URL.');
      process.exit(1);
    }
    const repoName = match[1].replace(/\/$/, '');

    // Setup cloner folder
    const parentClonedDir = path.resolve(__dirname, 'cloned-repos');
    if (!fs.existsSync(parentClonedDir)) {
      fs.mkdirSync(parentClonedDir, { recursive: true });
    }

    const targetClonePath = path.join(parentClonedDir, repoName);
    
    if (fs.existsSync(targetClonePath)) {
      console.log(`🧹 Cleaning previous clone at: ${targetClonePath}`);
      fs.rmSync(targetClonePath, { recursive: true, force: true });
    }

    console.log(`🚀 Unified Git Cloner & Dashboard Booted!`);
    console.log(`📥 Step 1: Cloning repository: ${repoUrl}`);
    try {
      execSync(`git clone ${repoUrl} ${targetClonePath}`, { stdio: 'inherit' });
    } catch (err) {
      console.error('❌ Error: Git clone command failed. Verify URL or internet connectivity.');
      process.exit(1);
    }

    // Step 3: Physically exclude specific files like index.html or style.css by deleting them
    console.log(`🧹 Step 2: Excluding specific files (index.html, style.css, styles.css)...`);
    excludeSpecificFiles(targetClonePath);

    console.log(`🔍 Step 3: Scanning files (excluding index.html/styles.css template assets)...`);
    const { tree, filesList } = scanDirectory(targetClonePath, targetClonePath, true);
    
    console.log(`📦 Step 4: Resolving package managers and dependencies...`);
    const { list: technologies, mainEcosystem: ecosystemType } = extractTechnologies(filesList, targetClonePath);

    console.log(`📝 Step 5: Isolating setup instructions from README.md...`);
    const instructions = extractRunInstructions(targetClonePath);

    // Extract complete directory metadata and write blueprints inside output_scanner folder!
    console.log(`🚦 Step 5.5: Meticulously scanning routes, CSS tokens, and codebase metrics...`);
    const manifests = extractDependencies(filesList, targetClonePath);
    const { routes, cssVariables, stats } = scanDirectoryMetadata(filesList, targetClonePath);
    stats.ecosystemType = ecosystemType;

    // Step 4: Create a dedicated "output_scanner" folder within the cloned repo
    const outputScannerDir = path.join(targetClonePath, 'output_scanner');
    if (!fs.existsSync(outputScannerDir)) {
      fs.mkdirSync(outputScannerDir, { recursive: true });
    }

    // Copy logo.png if it exists so relative paths inside markdown output work nicely
    const srcLogo = path.join(__dirname, 'assets', 'scanner_skill logo.png');
    const destLogoDir = path.join(outputScannerDir, 'assets');
    if (fs.existsSync(srcLogo)) {
      if (!fs.existsSync(destLogoDir)) {
        fs.mkdirSync(destLogoDir, { recursive: true });
      }
      try {
        fs.copyFileSync(srcLogo, path.join(destLogoDir, 'scanner_skill logo.png'));
      } catch (e) {}
    }

    // Step 5: Generate the three markdown files inside output_scanner/
    fs.writeFileSync(
      path.join(outputScannerDir, 'readme.md'),
      generateReadmeMarkdown(repoName, repoUrl, stats, tree, manifests),
      'utf8'
    );
    fs.writeFileSync(
      path.join(outputScannerDir, 'instruction.md'),
      generateInstructionMarkdown(repoName, stats, instructions, repoUrl, tree),
      'utf8'
    );
    fs.writeFileSync(
      path.join(outputScannerDir, 'ui.md'),
      generateUiMarkdown(repoName, routes, cssVariables, stats),
      'utf8'
    );

    // Generate Unified README.md at cloned root
    const singleReadmeMd = generateSingleReadme(targetClonePath, repoName, repoUrl, tree, manifests, routes, cssVariables, stats, instructions);
    const modernReadmePath = path.join(targetClonePath, 'README.md');
    fs.writeFileSync(modernReadmePath, singleReadmeMd, 'utf8');

    console.log(`\n============================================================`);
    console.log(`✅ Success! Extracted project details into output_scanner/!`);
    console.log(`📄 README: ${path.join(outputScannerDir, 'readme.md')}`);
    console.log(`📄 Instructions: ${path.join(outputScannerDir, 'instruction.md')}`);
    console.log(`📄 UI: ${path.join(outputScannerDir, 'ui.md')}`);
    console.log('============================================================\n');

    const dashboardData = {
      repoName,
      repoUrl,
      instructions,
      technologies,
      tree: formatTreeMarkdown(tree),
      stats: {
        filesCount: filesList.length,
        totalWeight: formatBytes(stats.totalSizeBytes),
        ecosystemType
      }
    };

    console.log(`🖥️ Step 6: Initializing web server on port 3000...`);
    
    const templatePath = path.join(__dirname, 'index.html');
    if (!fs.existsSync(templatePath)) {
      console.error(`❌ Error: Consolidated index.html not found at: ${templatePath}`);
      process.exit(1);
    }

    let htmlContent = fs.readFileSync(templatePath, 'utf8');
    htmlContent = htmlContent.replace(
      'let activeScanData = null; // __CLONE_SCAN_INJECT_POINT__',
      `let activeScanData = ${JSON.stringify(dashboardData)}; // __CLONE_SCAN_INJECT_POINT__`
    );

    const server = http.createServer((req, res) => {
      if (req.url === '/styles.css') {
        try {
          const cssPath = path.join(__dirname, 'styles.css');
          const cssContent = fs.readFileSync(cssPath, 'utf8');
          res.writeHead(200, { 'Content-Type': 'text/css' });
          res.end(cssContent);
          return;
        } catch (err) {
          console.error('⚠️ Warning: Failed to serve styles.css:', err.message);
        }
      } else if (req.url.startsWith('/assets/')) {
        try {
          const decodedUrl = decodeURIComponent(req.url);
          const assetPath = path.join(__dirname, decodedUrl);
          if (fs.existsSync(assetPath)) {
            const assetContent = fs.readFileSync(assetPath);
            res.writeHead(200, { 'Content-Type': 'image/png' });
            res.end(assetContent);
            return;
          }
        } catch (err) {
          console.error('⚠️ Warning: Failed to serve asset:', req.url, err.message);
        }
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(htmlContent);
    });

    server.listen(3000, () => {
      console.log(`\n============================================================`);
      console.log(`✅ Success! Local Dashboard Server Booted successfully!`);
      console.log(`🖥️ Access Dashboard: http://localhost:3000`);
      console.log(`============================================================\n`);
      console.log('Press Ctrl+C to terminate the dashboard server and close the session.');
      
      try {
        const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
        execSync(`${openCmd} http://localhost:3000`);
      } catch (e) {
        console.log('💡 Note: Unable to open browser automatically. Please open http://localhost:3000 manually.');
      }
    });

  } else {
    // Branch B: Local Directory or Single-File Analyzer
    const targetPath = path.resolve(rawPath);
    
    if (!fs.existsSync(targetPath)) {
      console.error(`❌ Error: Path does not exist: ${targetPath}`);
      process.exit(1);
    }

    const stat = fs.statSync(targetPath);
    
    if (stat.isDirectory()) {
      console.log(`🔍 Starting generalized local directory scan: ${targetPath}`);
      const { tree, filesList } = scanDirectory(targetPath);
      console.log(`📦 Traversing manifest files for dependencies...`);
      const manifests = extractDependencies(filesList, targetPath);
      console.log(`🚦 Scanning source code for routes and style variables...`);
      const { routes, cssVariables, stats } = scanDirectoryMetadata(filesList, targetPath);
      
      const { list: technologies, mainEcosystem: ecosystemType } = extractTechnologies(filesList, targetPath);
      stats.ecosystemType = ecosystemType;
      
      console.log(`✏️ Compiling Unified Project Blueprint...`);
      const singleReadmeMd = generateSingleReadme(targetPath, path.basename(targetPath), '', tree, manifests, routes, cssVariables, stats, '');
      const modernReadmePath = path.join(targetPath, 'README.md');
      fs.writeFileSync(modernReadmePath, singleReadmeMd, 'utf8');
      console.log(`✅ Success! Unified README.md generated at: ${modernReadmePath}`);
    } else {
      console.log(`🔍 Starting deep single-file lexical scan: ${targetPath}`);
      const analysis = scanSingleFile(targetPath);
      
      console.log(`✏️ Compiling Source File Schema Blueprint...`);
      const md = generateSingleFileMarkdown(targetPath, analysis);
      const outputPath = path.join(path.dirname(targetPath), 'scanner-skill.md');
      fs.writeFileSync(outputPath, md, 'utf8');
      console.log(`✅ Success! Local file blueprint generated at: ${outputPath}`);
    }
  }
}

run();
