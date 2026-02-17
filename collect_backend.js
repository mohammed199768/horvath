const fs = require('fs');
const path = require('path');

const IGNORE_DIRS = [
    'node_modules',
    'dist',
    '.git',
    '.idea',
    '.vscode',
    'coverage',
    'build',
    'logs',
    '.next'
];

const IGNORE_FILES = [
    '.env',
    '.env.local',
    '.env.development',
    '.env.test',
    '.env.production',
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    '.DS_Store',
    'backend_code.txt',
    'backend_tree.txt',
    'collect_backend.js',
    'LICENSE',
    'README.md'
];

const EXTENSIONS_TO_COLLECT = [
    '.ts',
    '.js',
    '.json',
    '.sql',
    '.yml',
    '.yaml'
];

let projectTree = '';
let projectCode = '';

function shouldIgnore(name, isDir) {
    if (isDir) {
        return IGNORE_DIRS.includes(name);
    }
    return IGNORE_FILES.includes(name);
}

function scanDirectory(currentPath, depth = 0, prefix = '') {
    let items;
    try {
        items = fs.readdirSync(currentPath);
    } catch (e) {
        console.error(`Failed to read directory ${currentPath}: ${e.message}`);
        return;
    }

    // Sort items: directories first, then files, both alphabetically
    items.sort((a, b) => {
        const aPath = path.join(currentPath, a);
        const bPath = path.join(currentPath, b);
        let aStat, bStat;
        try {
            aStat = fs.statSync(aPath);
            bStat = fs.statSync(bPath);
        } catch (e) {
            return 0; // Treat as equal if stat fails
        }

        if (aStat.isDirectory() && !bStat.isDirectory()) return -1;
        if (!aStat.isDirectory() && bStat.isDirectory()) return 1;
        return a.localeCompare(b);
    });

    // Filter out ignored items before processing to calculate 'isLast' correctly
    const filteredItems = items.filter(item => {
        const itemPath = path.join(currentPath, item);
        let stats;
        try {
            stats = fs.statSync(itemPath);
        } catch (e) {
            return false;
        }
        return !shouldIgnore(item, stats.isDirectory());
    });

    filteredItems.forEach((item, index) => {
        const itemPath = path.join(currentPath, item);
        let stats;
        try {
            stats = fs.statSync(itemPath);
        } catch (e) { return; }

        const isLast = index === filteredItems.length - 1;
        
        // Add to tree
        const connector = isLast ? '└── ' : '├── ';
        projectTree += `${prefix}${connector}${item}\n`;

        if (stats.isDirectory()) {
            const newPrefix = prefix + (isLast ? '    ' : '│   ');
            scanDirectory(itemPath, depth + 1, newPrefix);
        } else {
            // Collect code if extension matches
            const ext = path.extname(item).toLowerCase();
            if (EXTENSIONS_TO_COLLECT.includes(ext) || item === 'Dockerfile') {
                try {
                    const content = fs.readFileSync(itemPath, 'utf8');
                    projectCode += `\n\n${'='.repeat(50)}\n`;
                    projectCode += `FILE: ${path.relative(process.cwd(), itemPath).replace(/\\/g, '/')}\n`;
                    projectCode += `${'='.repeat(50)}\n\n`;
                    projectCode += content;
                } catch (err) {
                    console.error(`Error reading ${itemPath}: ${err.message}`);
                }
            }
        }
    });
}

console.log('Scanning backend directory...');
// Start scanning from the current working directory
scanDirectory(process.cwd());

fs.writeFileSync('backend_tree.txt', projectTree);
fs.writeFileSync('backend_code.txt', projectCode);

console.log('Done! Created backend_tree.txt and backend_code.txt');
