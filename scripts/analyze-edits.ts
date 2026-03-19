#!/usr/bin/env bun
import { runWeeklyAnalysis } from '../skills/pipeline/edit-analyzer.js';

const result = await runWeeklyAnalysis();

console.log('\nAnalysis complete:');
console.log(`  Total edits analyzed: ${result.totalEdits}`);
console.log(`  New proposed rules: ${result.newProposedRules.length}`);
console.log(`  Active confirmed rules: ${result.existingConfirmedRules.length}`);
if (result.recapMarkdownPath) {
  console.log(`  Recap saved to: ${result.recapMarkdownPath}`);
}
