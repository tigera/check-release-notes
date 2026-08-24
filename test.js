// Runs dist/index.js the way the runner does: a real child process with
// GITHUB_EVENT_PATH pointing at an event payload and the input passed as
// INPUT_LABEL-NAME. Testing the bundle rather than the source means these
// cases also prove the committed dist behaves correctly.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const TARGET = process.argv[2] || path.join(__dirname, 'dist', 'index.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-release-notes-'));
const eventPath = path.join(tmp, 'event.json');

let failures = 0;

function run(payload, { label = 'release-note-required' } = {}) {
    fs.writeFileSync(eventPath, JSON.stringify(payload));
    const start = process.hrtime.bigint();
    let code = 0;
    let out = '';
    try {
        out = execFileSync('node', [TARGET], {
            env: { ...process.env, GITHUB_EVENT_PATH: eventPath, 'INPUT_LABEL-NAME': label },
            encoding: 'utf8',
            timeout: 60000,
        });
    } catch (error) {
        code = error.status === undefined ? 'TIMEOUT' : error.status;
        out = (error.stdout || '') + (error.stderr || '');
    }
    return { code, out: out.trim(), ms: Number(process.hrtime.bigint() - start) / 1e6 };
}

function check(name, payload, expected, options = {}) {
    const result = run(payload, options);
    const maxMs = options.maxMs || 10000;
    const ok = result.code === expected.code &&
        result.out.includes(expected.contains) &&
        result.ms <= maxMs;

    if (!ok) {
        failures++;
    }
    console.log(
        (ok ? 'PASS  ' : 'FAIL  ') + name +
        '  [exit=' + result.code + ' ' + result.ms.toFixed(0) + 'ms]' +
        (ok ? '' : '\n      expected exit=' + expected.code + ' containing ' +
            JSON.stringify(expected.contains) + ', got: ' + JSON.stringify(result.out.slice(0, 200)))
    );
}

const pr = (body, extra = {}) => ({
    pull_request: { labels: [{ name: 'release-note-required' }], body, draft: false, ...extra },
});

const PASSED = { code: 0, contains: 'No errors detected' };
const MISSING = { code: 1, contains: 'No release notes found' };
const PLACEHOLDER = { code: 1, contains: 'still a placeholder' };
const NEGATION = { code: 1, contains: 'not a release note' };

// Label gating.
check('label absent skips validation',
    { pull_request: { labels: [{ name: 'other' }], body: '' } },
    { code: 0, contains: 'not present, skipping' });
check('missing labels key does not crash',
    { pull_request: { body: '', labels: undefined } },
    { code: 0, contains: 'not present, skipping' });

// Only an actual release note is accepted.
check('real notes pass', pr('```release-note\nFixed a real bug\n```'), PASSED);
check('multi-line notes pass',
    pr('```release-note\nFixed a real bug.\n\nAlso fixed a second one.\n```'), PASSED);

// Placeholders and empty blocks.
check('TBD fails', pr('```release-note\nTBD\n```'), PLACEHOLDER);
check('"TBD." fails', pr('```release-note\nTBD.\n```'), PLACEHOLDER);
check('lowercase "tbd:" fails', pr('```release-note\ntbd:\n```'), PLACEHOLDER);
check('TODO fails', pr('```release-note\nTODO\n```'), PLACEHOLDER);
check('WIP fails', pr('```release-note\nWIP\n```'), PLACEHOLDER);
check('empty block fails', pr('```release-note\n\n```'), { code: 1, contains: 'are empty' });

// Saying "no note needed" is a statement about the label, not a release note.
check('NONE fails', pr('```release-note\nNONE\n```'), NEGATION);
check('lowercase "none." fails', pr('```release-note\nnone.\n```'), NEGATION);
check('"- none -" fails', pr('```release-note\n- none -\n```'), NEGATION);
check('N/A fails', pr('```release-note\nN/A\n```'), NEGATION);
check('NA fails', pr('```release-note\nNA\n```'), NEGATION);
check('NIL fails', pr('```release-note\nnil\n```'), NEGATION);
check('"No release note needed" fails',
    pr('```release-note\nNo release note needed\n```'), NEGATION);
check('"not required" fails', pr('```release-note\nNot required.\n```'), NEGATION);
check('negation message names the label',
    pr('```release-note\nNONE\n```'),
    { code: 1, contains: 'remove the release-note-required label' });
check('negation message names a custom label',
    { pull_request: { labels: [{ name: 'needs-note' }], body: '```release-note\nNONE\n```', draft: false } },
    { code: 1, contains: 'remove the needs-note label' }, { label: 'needs-note' });

// Matching is on the whole entry, so a real note that merely starts with a
// negative word must still pass.
check('"None of the defaults change" passes',
    pr('```release-note\nNone of the defaults change when upgrading.\n```'), PASSED);
check('"No longer panics" passes',
    pr('```release-note\nNo longer panics on an empty config.\n```'), PASSED);
check('"NA" inside a real note passes',
    pr('```release-note\nAdded NA region support.\n```'), PASSED);

// A real note anywhere in the body wins over a stale non-note block.
check('NONE above real notes passes',
    pr('```release-note\nNONE\n```\n\n```release-note\nReal note\n```'), PASSED);
check('no block fails', pr('Just a description'), MISSING);
check('null body fails', pr(null), MISSING);
check('unclosed fence fails', pr('```release-note\nnotes but no closing fence'), MISSING);

// HTML comments must not satisfy the check: a PR template's commented-out
// block used to be read as if the author had written it.
check('commented-out template alone fails', pr('<!--\n```release-note\nNONE\n```\n-->'), MISSING);
check('commented TBD plus real notes passes',
    pr('<!-- ```release-note\nTBD\n``` -->\n```release-note\nReal note\n```'), PASSED);

// Every block is considered, not just the first.
check('stale TBD above real notes passes',
    pr('```release-note\nTBD\n```\n\n```release-note\nReal note\n```'), PASSED);
check('real notes above stale TBD passes',
    pr('```release-note\nReal note\n```\n\n```release-note\nTBD\n```'), PASSED);

// Draft PRs report but do not fail.
check('draft PR logs instead of failing',
    pr('```release-note\nTBD\n```', { draft: true }), { code: 0, contains: '[draft]' });

// Linear-time parsing. The previous regex backtracked cubically here: an
// unclosed fence followed by 65536 whitespace characters (GitHub's maximum
// body length) took an extrapolated 7.5 hours, hanging the job.
check('unclosed fence with 65536 whitespace chars',
    pr('```release-note' + '\n'.repeat(65536)), MISSING, { maxMs: 2000 });
check('unterminated HTML comment with 65536 whitespace chars',
    pr('<!--' + ' '.repeat(65536)), MISSING, { maxMs: 2000 });
check('many unterminated comment openers',
    pr('<!--'.repeat(16384)), MISSING, { maxMs: 2000 });
check('large body with valid notes',
    pr('x'.repeat(60000) + '\n```release-note\nok\n```'), PASSED, { maxMs: 2000 });

// Event guards.
check('non-pull_request event reports clearly',
    { push: {} }, { code: 1, contains: 'requires a pull_request event' });

// Annotation titles. These head the message in the Checks tab, and ':' and ','
// inside a property value have to arrive percent-encoded or the runner reads
// the command as truncated.
check('missing notes annotation carries a title',
    pr('Just a description'),
    { code: 1, contains: '::error title=No release notes::' });
check('placeholder annotation carries a title',
    pr('```release-note\nTBD\n```'),
    { code: 1, contains: '::error title=Release notes are still a placeholder::' });
check('negation annotation carries a title',
    pr('```release-note\nNONE\n```'),
    { code: 1, contains: '::error title=Release notes say no note is needed::' });
check('empty-block annotation carries a title',
    pr('```release-note\n\n```'),
    { code: 1, contains: '::error title=Release notes are empty::' });
check('event-guard annotation carries a title',
    { push: {} },
    { code: 1, contains: '::error title=Release notes check could not run::' });

fs.rmSync(tmp, { recursive: true, force: true });

console.log(failures === 0 ? '\nAll tests passed.' : '\n' + failures + ' test(s) failed.');
process.exit(failures === 0 ? 0 : 1);
