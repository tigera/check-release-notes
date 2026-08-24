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

// Label gating.
check('label absent skips validation',
    { pull_request: { labels: [{ name: 'other' }], body: '' } },
    { code: 0, contains: 'not present, skipping' });
check('missing labels key does not crash',
    { pull_request: { body: '', labels: undefined } },
    { code: 0, contains: 'not present, skipping' });

// Accepted bodies.
check('real notes pass', pr('```release-note\nFixed a real bug\n```'), PASSED);
check('NONE is still accepted', pr('```release-note\nNONE\n```'), PASSED);

// Placeholders and empty blocks.
check('TBD fails', pr('```release-note\nTBD\n```'), PLACEHOLDER);
check('"TBD." fails', pr('```release-note\nTBD.\n```'), PLACEHOLDER);
check('lowercase "tbd:" fails', pr('```release-note\ntbd:\n```'), PLACEHOLDER);
check('N/A fails', pr('```release-note\nN/A\n```'), PLACEHOLDER);
check('TODO fails', pr('```release-note\nTODO\n```'), PLACEHOLDER);
check('empty block fails', pr('```release-note\n\n```'), { code: 1, contains: 'are empty' });
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

fs.rmSync(tmp, { recursive: true, force: true });

console.log(failures === 0 ? '\nAll tests passed.' : '\n' + failures + ' test(s) failed.');
process.exit(failures === 0 ? 0 : 1);
