import fs from 'node:fs';
import {hashPassword} from './studio-security.js';

// Read from stdin, never from argv or an environment variable (shell history/process list).
const password = fs.readFileSync(0, 'utf8').replace(/\r?\n$/, '');
process.stdout.write(await hashPassword(password) + '\n');
