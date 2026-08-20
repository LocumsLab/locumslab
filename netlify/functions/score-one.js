const { scoreContract } = require('./score-contract');
const rubric = require('./rubric-v1.json');
const s = scoreContract(require('./' + process.argv[2]), rubric);
console.log('Grade:', s.overall.letter, s.overall.pct + '%', s.overall.provisional ? '(PROVISIONAL)' : '', '| scored ' + s.overall.fieldsScored + '/' + s.overall.fieldsTotal);
console.log('Categories:', Object.entries(s.categories).map(([k,v]) => k + '=' + (v.letter || 'insufficient data')).join('  '));
console.log('\nPriorities:');
s.priorities.forEach(p => console.log(' ' + p.rank + '. ' + p.label + ' [' + p.priority + '] - ' + p.currentTerm));
console.log('\nStrengths:', s.strengths.map(f => f.label).join(', ') || 'none');
console.log('\nClarify (' + s.clarifications.length + '):', s.clarifications.map(c => c.label + (c.unsupportedValue ? '*' : '') + (c.relatedText ? '+' : '')).join(', '));
