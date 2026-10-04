import fs from 'node:fs';
import { capabilitiesMarkdown } from '../src/shared/capabilities';

fs.mkdirSync('docs', { recursive: true });
fs.writeFileSync('docs/CAPABILITIES.md', capabilitiesMarkdown());
console.log('wrote docs/CAPABILITIES.md');
