import fs from 'node:fs';
import path from 'node:path';
import { ScriptedProvider, makeApp, createProject, runTask, tempDir, removeDir } from '../apps/server/dist/tests/helpers.js';

console.log('Testing execution path directly...');
